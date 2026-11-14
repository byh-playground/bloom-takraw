/**
 * AI 지상 발차기(서브·받기·토스·세트)의 조향. 사람과 같은 조작(서는 자리·누르는 때·떼는 때·조준)만 고른다.
 *
 * 물리 규칙(simulation/physics.js _kickCommand)은 누르는 동안 공이 다리 범위(_strikeRange) 밖이거나 엉덩이보다 높으면 발을 엉덩이 아래
 * 대기점(groundToss.wait)에 두고, 범위 안·엉덩이 아래로 들어오면 발등을 지금 공 쪽으로 다리 힘 한계(groundKickForce, maxFootSpeed) 안에서 휘두른다.
 * 공의 세기·방향은 닿는 순간 발→공 방향을 조준이 기울인 면(aimedContact)과 접촉 물리가 정한다.
 *
 * AI는 휘두르기 시작보다 충분히 일찍 눌러(ai.groundKick.pressLeadMs) 발을 대기점에 세워 둔다. 그래서 휘두르기는 늘 대기점에서 시작한다.
 * 이 모듈은 그 규칙을 결정론으로 앞질러 계산한다:
 * 1. 공 궤적: 물리 한 걸음(1/(tickRate·substeps))마다 중력·감쇠를 Rapier와 같은 순서로 적분한다(판단 1회에 한 번, 선수끼리 공유).
 * 2. 서는 자리 후보마다: 그 자리 엉덩이 기준으로 공이 범위 안·엉덩이 아래에 드는 걸음(휘두르기 시작), 대기점에서
 *    출발한 발등이 공을 쫓아 가속(힘 상한/다리 질량 × 힘-속도 한계)하다 공에 닿는 걸음, 그때 발→공 방향과 발 속도를 낸다.
 *    접촉 전에 공이 몸통이나 대기 중인 다리(엉덩이→발등 선)를 지나는 자리는 버린다.
 * 3. 조준 후보마다: aimedContact와 같은 식으로 접촉면 법선을 내고 반발 충격(1+반발계수)·발+정강이 질량비로 나가는 공 속도를 내어,
 *    그 포물선이 목표(상대 코트 / 동료 머리 위)에 얼마나 맞는지 점수를 매긴다.
 * 자리 흔들림을 막으려고 지난 계획의 자리에서 벗어나는 만큼 비용을 더하고, 지난 계획의 접촉이 lockMs 안이면 지금 자리만 본다.
 * 누른 뒤에는 다시 고르지 않는다(game.js decideAI가 누를 때의 자리·조준을 유지한다).
 * 결과는 사람 입력과 같은 통로로만 쓰인다. 공·발에 힘이나 속도를 직접 쓰지 않는다. 물리 상태와 설정만 읽으므로 같은 상태에서 같은 답이 나온다.
 * 후보 계산은 스칼라로 하고(가비지 없음), 고른 계획 하나만 객체로 돌려준다.
 */

const AIMS = [-1, -0.5, 0, 0.5, 1];
// 서는 자리 후보: 기준점(공이 엉덩이 아래 접촉 높이를 지날 자리)에서 엉덩이를 둘 상대 위치(m). 앞뒤는 팀 방향(네트 쪽 +), 옆은 z.
const BACK = [-0.95, -0.75, -0.55, -0.35, -0.15];
const SIDE = [-0.45, -0.25, 0, 0.25, 0.45];
// 몸통: 접촉 전 공이 이 높이 범위(m)에서 몸 중심 수평 BODY_RADIUS 안으로 들어오면 발보다 먼저 맞는다.
const BODY_RADIUS = 0.35;
const BODY_LOW = 0.4;
const BODY_HIGH = 1.8;
// 다리: 엉덩이→발등 선의 엉덩이 쪽 LEG_SPAN 비율 구간에서 공 중심이 공 반지름 + LEG_RADIUS 안이면 허벅지·정강이에 먼저 맞는다.
const LEG_SPAN = 0.75;
const LEG_RADIUS = 0.08;
// 지난 계획 자리에서 벗어나는 1 m당 비용과, 이동 1 m당 비용, 닿지 못할 거리 1 m당 비용(점수와 같은 m 단위).
const KEEP_COST = 1.2;
const TRAVEL_COST = 0.2;
const LATE_COST = 5;
// 발등 기준점에서 공 겉면까지 닿는 거리(m): 발은 길이 0.28 m 상자라 기준점보다 넓게 닿는다(접촉 순간 공 중심-발등 거리 약 0.06~0.19 m).
const FOOT_REACH = 0.04;
// decideAI가 이 거리(m) 안에서는 움직이지 않는다(목표 자리 0.12 m 안 정지 + 여유).
const STAY = 0.15;

class TakrawGroundKickPlanner {
    /** physics: TakrawPhysics(읽기만), config: TAKRAW_CONFIG. */
    constructor(physics, config) {
        this.physics = physics;
        this.config = config;
        this.dt = 1 / (config.simulation.tickRate * config.simulation.substeps);
        this.capacity = Math.ceil(physics.settings.receive.horizon / this.dt);
        // 걸음마다 [x, y, z, vx, vy, vz].
        this.path = new Float64Array(this.capacity * 6);
        this.count = 0;
        this.strike = {
            index: 0,
            swing: 0,
            dx: 0,
            dy: 0,
            dz: 0,
            vx: 0,
            vy: 0,
            vz: 0,
        };
    }

    /** 지금 공에서 horizon까지 물리 한 걸음마다의 공 위치·속도를 채운다. 바닥에 닿으면 멈춘다. */
    prepare() {
        const s = this.physics.settings,
            dt = this.dt,
            damping = 1 / (1 + dt * s.ballDamping),
            path = this.path;
        const p = this.physics.ball.translation(),
            v = this.physics.ball.linvel();
        this.startX = p.x;
        this.startY = p.y;
        this.startZ = p.z;
        let x = p.x,
            y = p.y,
            z = p.z,
            vx = v.x,
            vy = v.y,
            vz = v.z,
            count = 0;
        while (count < this.capacity) {
            vy -= s.gravity * dt;
            vx *= damping;
            vy *= damping;
            vz *= damping;
            x += vx * dt;
            y += vy * dt;
            z += vz * dt;
            const k = count * 6;
            path[k] = x;
            path[k + 1] = y;
            path[k + 2] = z;
            path[k + 3] = vx;
            path[k + 4] = vy;
            path[k + 5] = vz;
            count++;
            if (y <= s.ballRadius) break;
        }
        this.count = count;
    }

    /**
     * 한 선수의 계획. goal: { over: true, x, z }(네트를 넘겨 상대 코트 x·z에 떨어뜨림) 또는 { over: false, x, z, height, apex }
     * (우리 코트 x·z 위를 height 높이로 내려오고 꼭짓점 apex). previous: 지난 계획 { x, z, contactAt } 또는 null. now: 물리 시각(초).
     * 돌려주는 값: { stance: {x, z}, swingIn, contactIn, aim: {x, y}, score } 또는 닿는 자리가 없으면 null.
     */
    plan(player, goal, previous, now, lockMs) {
        if (!goal) return null;
        const reach = this.physics.groundKickReach(player),
            root = player.root.translation();
        const locked = previous !== null && previous.contactAt - now <= lockMs / 1000;
        if (locked) {
            const here = this._search(player, goal, reach, root, previous, true);
            if (here) return here;
        }
        return this._search(player, goal, reach, root, previous, false);
    }

    _search(player, goal, reach, root, previous, here) {
        const s = this.physics.settings,
            toward = player.toward,
            court = this.config.court,
            path = this.path;
        const hipY = root.y + reach[this.physics.settings.dominantFoot.side].hip.y;
        const baseHeight = hipY - s.groundToss.wait.below * 0.5;
        let base = -1;
        for (let i = 0; i < this.count; i++)
            if (path[i * 6 + 4] < 0 && path[i * 6 + 1] <= baseHeight) {
                base = i;
                break;
            }
        if (base < 0) return null;
        let best = null,
            bestScore = Infinity,
            bestX = 0,
            bestZ = 0,
            bestAimX = 0,
            bestAimY = 0,
            bestSwing = 0,
            bestContact = 0;
        // 후보 -1은 지금 자리, 나머지는 기준점 둘레 격자다. 이동은 STAY 안에서는 멈추므로(decideAI) 그보다 가까운 격자 자리는 지금 자리와 같다.
        const candidates = here ? 0 : BACK.length * SIDE.length;
        for (let n = -1; n < candidates; n++) {
            // 서는 자리(root)와 차는 발. 엉덩이를 기준점 둘레에 두려면 몸이 엉덩이 위치만큼 비켜 선다(몸 방향은 지금 그대로).
            let standX = root.x,
                standZ = root.z,
                side = this.physics.settings.dominantFoot.side;
            const baseX = path[base * 6],
                baseZ = path[base * 6 + 2];
            if (n >= 0) {
                // 엉덩이를 기준점 둘레에 두는 자리. 발은 그 자리에서 본 공으로 정해지므로 주발로 한 번 세운 뒤 발이 바뀌면 다시 세운다.
                const hipX = baseX + toward * BACK[Math.floor(n / SIDE.length)],
                    hipZ = baseZ + SIDE[n % SIDE.length];
                side = this.physics.settings.dominantFoot.side;
                standX = hipX - reach[side].hip.x;
                standZ = hipZ - reach[side].hip.z;
                const chosen = this._side(reach, baseX - standX, baseZ - standZ);
                if (chosen !== side) {
                    side = chosen;
                    standX = hipX - reach[side].hip.x;
                    standZ = hipZ - reach[side].hip.z;
                }
            }
            side = this._side(reach, baseX - standX, baseZ - standZ);
            if (n >= 0 && Math.hypot(standX - root.x, standZ - root.z) < STAY) continue;
            if (
                standX * toward > -0.4 ||
                Math.abs(standZ) > court.halfWidth + 1 ||
                standX * toward < -court.halfLength - 1.5
            )
                continue;
            const leg = reach[side];
            if (
                !this._strike(
                    player,
                    standX + leg.hip.x,
                    root.y + leg.hip.y,
                    standZ + leg.hip.z,
                    standX,
                    standZ,
                    leg.range,
                    leg.legMass,
                )
            )
                continue;
            const strike = this.strike;
            const contactT = (strike.index + 1) * this.dt;
            const travel = Math.hypot(standX - root.x, standZ - root.z);
            const reachable = player.settings.movementSpeed * Math.max(0, contactT - 0.7) + 0.1;
            const cost =
                LATE_COST * Math.max(0, travel - reachable) +
                TRAVEL_COST * travel +
                (previous ? KEEP_COST * Math.hypot(standX - previous.x, standZ - previous.z) : 0);
            if (cost >= bestScore) continue;
            for (const ax of AIMS)
                for (const ay of AIMS) {
                    const score = this._shot(player, strike, ax, ay, leg.mass, goal, toward) + cost;
                    if (score < bestScore) {
                        bestScore = score;
                        bestX = standX;
                        bestZ = standZ;
                        bestAimX = ax;
                        bestAimY = ay;
                        bestSwing = strike.swing;
                        bestContact = contactT;
                        best = true;
                    }
                }
        }
        if (!best) return null;
        return {
            stance: { x: bestX, z: bestZ },
            swingIn: bestSwing,
            contactIn: bestContact,
            aim: { x: bestAimX, y: bestAimY },
            score: bestScore,
        };
    }

    /** 공이 몸 기준 (dx, dz)에 있을 때 누르면 고르는 발(물리 _groundSide와 같은 규칙). */
    _side(reach, dx, dz) {
        const { side, groundOffset } = this.physics.settings.dominantFoot;
        const localX = dx * reach.right.x + dz * reach.right.z;
        return localX * (side === 'R' ? 1 : -1) < -groundOffset ? (side === 'R' ? 'L' : 'R') : side;
    }

    /**
     * 그 자리에서 미리 눌러 둔 발이 공에 닿는 걸음을 this.strike에 쓴다(index, 휘두르기 시작까지 시간 swing, 발→공 방향 d, 발 속도).
     * 발은 휘두르기 시작 걸음의 대기점에서 출발한다. 닿지 않거나 몸·다리에 먼저 맞으면 false.
     */
    _strike(player, hx, hy, hz, standX, standZ, range, legMass) {
        const s = this.physics.settings,
            toss = s.groundToss,
            path = this.path,
            dt = this.dt,
            radius = s.ballRadius;
        const accel = player.settings.groundKickForce / legMass,
            maxSpeed = toss.maxFootSpeed,
            contact = radius + FOOT_REACH,
            legHit = radius + LEG_RADIUS;
        let fx = 0,
            fy = 0,
            fz = 0,
            swinging = false,
            speed = 0,
            swing = 0;
        for (let i = 0; i < this.count; i++) {
            const k = i * 6,
                bx = path[k],
                by = path[k + 1],
                bz = path[k + 2];
            if (
                by > BODY_LOW &&
                by < BODY_HIGH &&
                Math.hypot(bx - standX, bz - standZ) < BODY_RADIUS
            )
                return false;
            const rx = bx - hx,
                ry = by - hy,
                rz = bz - hz;
            const horizontal = Math.hypot(rx, rz);
            if (!swinging) {
                // 대기 중인 발등: 엉덩이 아래 below, 공 쪽 수평 ahead(물리 _groundKickWait와 같은 점).
                const ux = horizontal > 1e-9 ? rx / horizontal : player.toward,
                    uz = horizontal > 1e-9 ? rz / horizontal : 0;
                const wx = hx + ux * toss.wait.ahead,
                    wy = hy - toss.wait.below,
                    wz = hz + uz * toss.wait.ahead;
                if (this._nearLeg(hx, hy, hz, wx, wy, wz, bx, by, bz, legHit)) return false;
                if (!(Math.sqrt(rx * rx + ry * ry + rz * rz) <= range && by <= hy)) continue;
                swinging = true;
                swing = i * dt;
                fx = wx;
                fy = wy;
                fz = wz;
            }
            // 힘-속도 한계: 그 방향으로 미는 힘이 (1 − 속도/maxFootSpeed)배.
            speed = Math.min(maxSpeed, speed + accel * Math.max(0, 1 - speed / maxSpeed) * dt);
            // 발은 걸음 시작의 공(앞 걸음 끝)을 향해 움직인다(물리 _kickCommand가 걸음마다 지금 공을 읽는 것과 같다).
            const qx = i > 0 ? path[k - 6] : this.startX,
                qy = i > 0 ? path[k - 5] : this.startY,
                qz = i > 0 ? path[k - 4] : this.startZ;
            let mx = qx - fx,
                my = qy - fy,
                mz = qz - fz;
            const size = Math.sqrt(mx * mx + my * my + mz * mz);
            if (size < 1e-9) {
                mx = 0;
                my = 1;
                mz = 0;
            } else {
                mx /= size;
                my /= size;
                mz /= size;
            }
            // 걸음 안 상대 위치를 직선으로 이어 처음 닿는 순간 u(0..1)를 찾는다(물리의 예측 접촉처럼 걸음 사이를 건너뛰지 않는다).
            const ax0 = qx - fx,
                ay0 = qy - fy,
                az0 = qz - fz;
            fx += mx * speed * dt;
            fy += my * speed * dt;
            fz += mz * speed * dt;
            if (this._nearLeg(hx, hy, hz, fx, fy, fz, bx, by, bz, legHit)) return false;
            const ex = bx - fx - ax0,
                ey = by - fy - ay0,
                ez = bz - fz - az0;
            const qa = ex * ex + ey * ey + ez * ez,
                qb = 2 * (ax0 * ex + ay0 * ey + az0 * ez),
                qc = ax0 * ax0 + ay0 * ay0 + az0 * az0 - contact * contact;
            let u = -1;
            if (qc <= 0) u = 0;
            else if (qa > 1e-12) {
                const disc = qb * qb - 4 * qa * qc;
                if (disc >= 0) {
                    const root = (-qb - Math.sqrt(disc)) / (2 * qa);
                    if (root >= 0 && root <= 1) u = root;
                }
            }
            if (u >= 0) {
                let cx = ax0 + ex * u,
                    cy = ay0 + ey * u,
                    cz = az0 + ez * u;
                const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
                if (cl < 1e-9) {
                    cx = mx;
                    cy = my;
                    cz = mz;
                } else {
                    cx /= cl;
                    cy /= cl;
                    cz /= cl;
                }
                const strike = this.strike;
                strike.index = i;
                strike.swing = swing;
                strike.dx = cx;
                strike.dy = cy;
                strike.dz = cz;
                strike.vx = mx * speed;
                strike.vy = my * speed;
                strike.vz = mz * speed;
                return true;
            }
        }
        return false;
    }

    /** 공 중심이 엉덩이→발등 선의 엉덩이 쪽 구간에서 distance 안인지. */
    _nearLeg(hx, hy, hz, fx, fy, fz, bx, by, bz, distance) {
        const lx = fx - hx,
            ly = fy - hy,
            lz = fz - hz;
        const length2 = lx * lx + ly * ly + lz * lz;
        if (length2 < 1e-9) return false;
        const t = Math.max(
            0,
            Math.min(LEG_SPAN, ((bx - hx) * lx + (by - hy) * ly + (bz - hz) * lz) / length2),
        );
        const cx = hx + lx * t - bx,
            cy = hy + ly * t - by,
            cz = hz + lz * t - bz;
        return cx * cx + cy * cy + cz * cz < distance * distance;
    }

    /**
     * 접촉 한 번의 결과 점수. 면 법선은 physics.aimedContact와 같은 식이다: 발→공 방향 d, 오른쪽 = d × 위(수평이면 팀 옆 방향), 위 = 오른쪽 × d,
     * 옮김 k = 공 반지름 비율 kickAim.maxOffset × (조준x·오른쪽 + 조준y·위)(크기 상한 maxOffset), 법선 = √(1−|k|²)·d − k.
     * 나가는 공 속도 = 들어오는 속도 + (1+반발계수)·m/(m+m공)·(발 속도 − 공 속도)·법선 × 법선.
     */
    _shot(player, strike, ax, ay, mass, goal, toward) {
        const s = this.physics.settings,
            reachOffset = s.kickAim.maxOffset,
            k = strike.index * 6,
            path = this.path;
        const dx = strike.dx,
            dy = strike.dy,
            dz = strike.dz;
        // 오른쪽 = d × (0,1,0) = (−dz, 0, dx)
        let rx = -dz,
            rz = dx;
        const rl = Math.hypot(rx, rz);
        if (rl > 1e-9) {
            rx /= rl;
            rz /= rl;
        } else {
            rx = 0;
            rz = player.toward;
        }
        // 위 = 오른쪽 × d
        const ux = -rz * dy,
            uy = rz * dx - rx * dz,
            uz = rx * dy;
        let ox = (rx * ax + ux * ay) * reachOffset,
            oy = uy * ay * reachOffset,
            oz = (rz * ax + uz * ay) * reachOffset;
        const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (ol > reachOffset) {
            const scale = reachOffset / ol;
            ox *= scale;
            oy *= scale;
            oz *= scale;
        }
        const along = Math.sqrt(1 - (ox * ox + oy * oy + oz * oz));
        const nx = dx * along - ox,
            ny = dy * along - oy,
            nz = dz * along - oz;
        const bx = path[k],
            by = path[k + 1],
            bz = path[k + 2],
            vx = path[k + 3],
            vy = path[k + 4],
            vz = path[k + 5];
        const closing = (strike.vx - vx) * nx + (strike.vy - vy) * ny + (strike.vz - vz) * nz;
        if (!(closing > 0)) return 50;
        const impulse = (1 + s.ballRestitution) * (mass / (mass + s.ballMass)) * closing;
        return this._score(
            bx,
            by,
            bz,
            vx + nx * impulse,
            vy + ny * impulse,
            vz + nz * impulse,
            goal,
            toward,
        );
    }

    /** 나가는 포물선의 점수(작을수록 좋다, m 단위). */
    _score(px, py, pz, vx, vy, vz, goal, toward) {
        const s = this.physics.settings,
            g = s.gravity,
            court = this.config.court;
        const fallTime = (height) => {
            const d = vy * vy + 2 * g * (py - height);
            return d < 0 ? -1 : (vy + Math.sqrt(d)) / g;
        };
        if (goal.over) {
            const t = fallTime(s.ballRadius);
            if (t < 0 || vx * toward <= 0.1) return 50;
            const landX = px + vx * t,
                landZ = pz + vz * t;
            const tNet = -px / vx,
                yNet = py + vy * tNet - 0.5 * g * tNet * tNet;
            const clear = court.netHeight + s.ballRadius + 0.2 - yNet;
            const deep = landX * toward - (court.halfLength - 0.5),
                short = 1.0 - landX * toward,
                wide = Math.abs(landZ) - (court.halfWidth - 0.5);
            return (
                Math.hypot(landX - goal.x, landZ - goal.z) +
                6 * Math.max(0, clear) +
                6 * Math.max(0, deep) +
                6 * Math.max(0, short) +
                6 * Math.max(0, wide)
            );
        }
        if (vy <= 0) return 50;
        const t = fallTime(goal.height);
        if (t < 0) return 50;
        const landX = px + vx * t,
            landZ = pz + vz * t,
            apex = py + (vy * vy) / (2 * g);
        return (
            Math.hypot(landX - goal.x, landZ - goal.z) +
            0.8 * Math.abs(apex - goal.apex) +
            8 * Math.max(0, landX * toward + 0.4)
        );
    }
}

export { TakrawGroundKickPlanner };
