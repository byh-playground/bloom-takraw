import { TAKRAW_ROLE, takrawAthleteEffects } from '../config/game.js';
import { TakrawMotionMatcher } from '../motion/matcher.js';
import { takrawNetShape } from '../config/physics.js';
import { HUMAN_JOINT_LIMITS } from './joint-limits.js';
import {
    legPlanModel,
    legAnkle,
    legJoints,
    legJointVelocity,
    legAnkleVelocity,
    legTorques,
    legActuation,
    legPlanSolve,
    legPlanAdvance,
} from './leg-plan.js';
import { bodyTurnPlan, bodyTurnAdvance } from './body-turn.js';
import { TAKRAW_ROLES, takrawIsAttacker, takrawSlotOf, takrawTeamOf } from './roster.js';

/**
 * 인스턴스 설정(DEV-005): config.physics(config/physics.js)를 복사하고 파생값만 더한다.
 * 네트 높이·코트 폭은 config.court를 직접 읽는다.
 */
function takrawPhysicsSettings(config) {
    const settings = structuredClone(config.physics);
    // 게임의 물리 한 걸음은 simulation.stepMs다. 검증한 상한(maxStepMs)을 넘으면 만들지 않는다(조용히 시간이 잘리지 않게).
    // Rapier 적분은 초 단위라 stepSeconds·maxStepSeconds는 여기서 한 번 초로 바꿔 둔 파생값이다.
    const stepMs = config.simulation.stepMs;
    if (stepMs > settings.maxStepMs + 1e-9)
        throw new RangeError(`physics step ${stepMs}ms exceeds maxStepMs ${settings.maxStepMs}ms`);
    settings.stepSeconds = stepMs / 1000;
    settings.maxStepSeconds = settings.maxStepMs / 1000;
    settings.fineContactWindowSeconds = config.simulation.fineContactWindowMs / 1000;
    // 지상 토스는 휘두르기가 시작될 수 있는 틱부터 잘게 돈다: 틱 시작에 공 도착이 가장 긴 휘두르기 길이(strokeLeadMs) + 한 틱 안일 때.
    settings.tickSeconds = 1 / config.simulation.tickRate;
    // 다리 관절 계획이 휘두르기 길이를 고르는 범위: 가장 짧은 계획 길이부터 가장 긴 휘두르기 길이까지.
    settings.legPlan.minTime = settings.groundToss.minPlanTime;
    settings.legPlan.maxTime = settings.groundToss.strokeLeadMs / 1000;
    const airKick = settings.airKick;
    airKick.velocityGain = 2 * Math.sqrt(airKick.positionGain * airKick.trackingMass);
    return settings;
}

/** 공 충돌체의 충돌 그룹 비트. 발·정강이 충돌체는 이 비트를 걸러 Rapier가 공과의 접촉을 풀지 않는다. */
const BALL_GROUP = 2;

/** 스냅샷 검사: x·y·z가 모두 유한한 벡터인지. */
const snapshotVector = (value) =>
    value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
/** 스냅샷 검사: 받기 기록이 없거나(null) 올바른 받기 기록인지. */
const snapshotReceive = (value) =>
    value === null ||
    (value &&
        ['cushion', 'lunge', 'slide'].includes(value.mode) &&
        ['prepare', 'contact', 'recover'].includes(value.phase) &&
        snapshotVector(value.point) &&
        snapshotVector(value.direction) &&
        value.committed === true &&
        Number.isFinite(value.startedAt) &&
        value.startedAt >= 0 &&
        Number.isFinite(value.contactAt) &&
        value.contactAt >= value.startedAt &&
        Number.isFinite(value.until) &&
        value.until >= value.contactAt &&
        (value.hitAt === null ||
            (Number.isFinite(value.hitAt) && value.hitAt >= value.startedAt)) &&
        (!Object.hasOwn(value, 'launch') || (Number.isFinite(value.launch) && value.launch >= 0)));
/** 스냅샷 검사: 신체 형상(상자 반길이, 공·캡슐 반지름·반높이)이 모양에 맞는지. */
const snapshotGeometry = (value, shape) =>
    value &&
    (shape === 'box'
        ? Object.keys(value).length === 1 &&
          snapshotVector(value.halfExtents) &&
          ['x', 'y', 'z'].every((axis) => value.halfExtents[axis] > 0)
        : Object.keys(value).length === (shape === 'capsule' ? 2 : 1) &&
          Number.isFinite(value.radius) &&
          value.radius > 0 &&
          (shape !== 'capsule' || (Number.isFinite(value.halfHeight) && value.halfHeight >= 0)));

/**
 * Articulated, force-driven players. Rendering never writes back into this world.
 * The only pose teleports are the public rally reset methods below.
 */
class TakrawPhysics {
    constructor(RAPIER, config) {
        this.R = RAPIER;
        this.config = config;
        this.motionMatcher = new TakrawMotionMatcher();
        this.settings = takrawPhysicsSettings(config);
        this.serializer = new RAPIER.SerializationPipeline();
        this._createWorld(Array(6).fill(null));
        // 조준 상한의 근거(config/physics.js kickAim): 가상 공 중심의 옆 이동이 발등 반폭보다 작아야, 발 면이 덜 기울어도
        // 발이 가는 선이 발등 면 안에서 공에 닿는다. 몸 치수나 공 크기가 바뀌어 이 조건이 깨지면 설정을 다시 정해야 한다.
        const footHalfWidth =
            this.players[0].byName['foot' + this.settings.dominantFoot.side].halfExtents.x;
        if (this.settings.kickAim.maxOffset * this.settings.ballRadius >= footHalfWidth)
            throw new RangeError('kickAim.maxOffset reaches the foot edge');
    }

    /** 물리 월드 한 벌(코트·선수·공·시계)을 새로 만든다. 생성자와 rebuild()가 같은 경로를 쓴다. */
    _createWorld(profiles) {
        const s = this.settings;
        this.world = new this.R.World({ x: 0, y: -s.gravity, z: 0 });
        this.world.integrationParameters.dt = s.stepSeconds;
        this.world.integrationParameters.numSolverIterations = s.solverIterations;
        this.world.integrationParameters.numInternalPgsIterations = 2;
        this.world.integrationParameters.maxCcdSubsteps = s.ccdSubsteps;
        this.queue = new this.R.EventQueue(true);
        // Original binary checkpoint while a restored world is still untouched.
        // Cleared by every authoritative physical-world mutation.
        this.restoredSnapshotBytes = null;
        this.players = [];
        this.colliderMeta = new Map();
        this.ballContacts = new Map();
        this.netContacts = new Set();
        this.lastBallTouch = null;
        this.time = 0;
        this._buildCourt();
        for (let id = 0; id < 6; id++) this.players.push(this._buildPlayer(id));
        this.setAthletes(profiles);
        this._buildBall();
        this.resetPlayers();
        this.resetBall({ x: -3.0, y: 2.2, z: -1.1 }, { x: 0, y: 0, z: 0 });
    }

    /**
     * 월드를 새로 만들어 새 인스턴스와 완전히 같은 처음 상태로 돌린다. 선수 프로필은 유지한다.
     * 몸을 제자리로 옮기는 resetPlayers/resetBall만으로는 Rapier 내부 상태(접촉 캐시·광역 단계 구조)가 이전 경기에서 넘어와,
     * 같은 시드라도 reset 횟수에 따라 결과가 달라졌다(v0.16 이전 난수 기준 시드 36의 첫 슈퍼세이브가 틱 436→437).
     */
    rebuild() {
        const profiles = this.players.map((player) => player.athlete);
        this.queue.free();
        this.world.free();
        this._createWorld(profiles);
    }

    _v(x = 0, y = 0, z = 0) {
        return { x, y, z };
    }
    _add(a, b) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }
    _sub(a, b) {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }
    _mul(a, k) {
        return { x: a.x * k, y: a.y * k, z: a.z * k };
    }
    _dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }
    _cross(a, b) {
        return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
    }
    _length(a) {
        return Math.hypot(a.x, a.y, a.z);
    }
    _limit(a, max) {
        const n = this._length(a);
        return n > max ? this._mul(a, max / n) : a;
    }
    _unit(a, fallback = { x: 1, y: 0, z: 0 }) {
        const n = this._length(a);
        return n > 1e-7 ? this._mul(a, 1 / n) : { ...fallback };
    }
    _clamp(a, lo, hi) {
        return Math.max(lo, Math.min(hi, a));
    }
    _conj(q) {
        return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    }
    _qmul(a, b) {
        return {
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        };
    }
    _rotate(q, v) {
        const tx = 2 * (q.y * v.z - q.z * v.y);
        const ty = 2 * (q.z * v.x - q.x * v.z);
        const tz = 2 * (q.x * v.y - q.y * v.x);
        return {
            x: v.x + q.w * tx + q.y * tz - q.z * ty,
            y: v.y + q.w * ty + q.z * tx - q.x * tz,
            z: v.z + q.w * tz + q.x * ty - q.y * tx,
        };
    }
    _yaw(a) {
        return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
    }
    _point(body, local) {
        return this._add(body.translation(), this._rotate(body.rotation(), local));
    }
    _bodyVelocity(p) {
        const velocity = this._v();
        for (const part of p.parts) {
            const value = part.body.linvel(),
                weight = part.mass / p.mass;
            velocity.x += value.x * weight;
            velocity.y += value.y * weight;
            velocity.z += value.z * weight;
        }
        return velocity;
    }
    /** 차는 다리(허벅지·정강이·발)를 뺀 몸의 질량 중심 속도. 다리가 밀고 당기는 반작용으로 골반만 흔들리는 속도를 빼고 몸이 가는 속도를 본다. */
    _supportVelocity(p, suffix) {
        const velocity = this._v();
        let mass = 0;
        for (const part of p.parts) {
            if (/^(upperLeg|lowerLeg|foot)/.test(part.name) && part.name.endsWith(suffix)) continue;
            const value = part.body.linvel();
            velocity.x += value.x * part.mass;
            velocity.y += value.y * part.mass;
            velocity.z += value.z * part.mass;
            mass += part.mass;
        }
        return this._mul(velocity, 1 / mass);
    }
    _groups(member, filter = 0xffff) {
        return ((member << 16) | filter) >>> 0;
    }

    _athleteProfile(profile, id) {
        const definition = this.config.athletes;
        const role = TAKRAW_ROLES[takrawSlotOf(id)];
        // 기본 선수는 이름이 없다(null). 화면이 역할 이름으로 보여 준다.
        const value =
            profile === null ? { id: 'standard-' + id, name: null, role, stats: {} } : profile;
        if (
            !value ||
            typeof value.id !== 'string' ||
            !value.id ||
            !(value.name === null || (typeof value.name === 'string' && value.name.trim())) ||
            value.role !== role ||
            !value.stats ||
            typeof value.stats !== 'object' ||
            Array.isArray(value.stats) ||
            Object.keys(value.stats).some((key) => !Object.hasOwn(definition.bonus, key))
        ) {
            throw new Error('선수 프로필과 역할을 확인하세요.');
        }
        const stats = {};
        for (const key of Object.keys(definition.bonus)) {
            const score = value.stats[key] ?? definition.base;
            if (!Number.isInteger(score) || score < definition.base)
                throw new Error('능력치 범위가 올바르지 않습니다.');
            stats[key] = score;
        }
        return { id: value.id, name: value.name, role, stats };
    }

    setAthletes(profiles) {
        this.restoredSnapshotBytes = null;
        if (!Array.isArray(profiles) || profiles.length !== 6)
            throw new Error('여섯 명의 선수 프로필이 필요합니다.');
        const values = profiles.map((profile, id) => this._athleteProfile(profile, id));
        const definition = this.config.athletes;
        for (const [id, athlete] of values.entries()) {
            const p = this.players[id],
                effect = takrawAthleteEffects(athlete.stats, definition),
                s = this.settings;
            p.athlete = athlete;
            p.effects = effect;
            p.settings = Object.values(effect).some((value) => value !== 0)
                ? {
                      ...s,
                      movementSpeed: s.movementSpeed * (1 + effect.mobility),
                      movementAcceleration: s.movementAcceleration * (1 + effect.mobility),
                      jumpSpeed: s.jumpSpeed * (1 + effect.jump),
                      airControl: s.airControl * (1 + effect.flexibility),
                      groundKickForce: s.groundKickForce * (1 + effect.setting),
                  }
                : s;
        }
    }

    /** Read-only interception estimate. A null input estimates an AI approach;
     * an explicit input uses only that player's actual movement direction. */
    planReceive(p, input = null) {
        const s = p.settings,
            receive = s.receive,
            ball = this.ball.translation(),
            velocity = this.ball.linvel();
        if (
            p.jump.active ||
            input?.jump ||
            input?.jumpPressed ||
            (input !== null && /recover|fall/.test(p.state))
        )
            return null;
        const root = p.root.translation(),
            bodyVelocity = this._bodyVelocity(p);
        const offset = Math.min(this.config.ai.toss.incomingOffset, receive.cushionReach);
        const candidate = (height, sliding) => {
            const discriminant = velocity.y * velocity.y + 2 * s.gravity * (ball.y - height);
            if (discriminant < 0) return null;
            const time = (velocity.y + Math.sqrt(discriminant)) / s.gravity;
            if (!(time > 0.015 && time <= receive.horizon)) return null;
            const point = {
                x: ball.x + velocity.x * time,
                y: height,
                z: ball.z + velocity.z * time,
            };
            if (
                point.x * p.toward >= -0.15 ||
                Math.abs(point.z) > this.config.court.halfWidth + 0.65 ||
                Math.abs(point.x) > this.config.court.halfLength + 0.65
            )
                return null;
            // 서는 자리: 접촉점(발로 받는 높이에 공이 오는 곳)에서 offset만큼 뒤. 뒤쪽 한계는 접촉점을 받아들이는 한계(끝줄 + 0.65 m)와 같다.
            // 끝줄 안쪽(끝줄 - 0.5 m)에서 멈추게 하면 깊은 서브에서 공이 발 높이로 내려오기 전에 몸에 닿는다(몸통 받기).
            const stance = {
                x:
                    this._clamp(
                        point.x * p.toward - offset,
                        -this.config.court.halfLength - 0.65,
                        -0.6,
                    ) * p.toward,
                z: this._clamp(
                    point.z + p.toward * this.config.ai.toss.attack.lateral,
                    -this.config.court.halfWidth + 0.15,
                    this.config.court.halfWidth - 0.15,
                ),
            };
            const toward = this._unit({ x: point.x - root.x, y: 0, z: point.z - root.z });
            const desired =
                input === null
                    ? this._limit(
                          { x: (stance.x - root.x) * 2, y: 0, z: (stance.z - root.z) * 2 },
                          1,
                      )
                    : this._limit({ x: Number(input.x) || 0, y: 0, z: Number(input.z) || 0 }, 1);
            const moving =
                this._length(desired) > receive.moveThreshold &&
                this._dot(this._unit(desired), toward) > receive.directionThreshold;
            const speed = s.movementSpeed * (sliding && moving ? receive.slide.speed : 1);
            const startVelocity = { ...bodyVelocity };
            if (sliding && moving && !p.receive) {
                const launchDirection = this._unit(desired),
                    amount = this._length(desired);
                const launch = Math.min(
                    s.movementSpeed * receive.slide.launchScale * amount,
                    Math.max(0, speed * amount - this._dot(startVelocity, launchDirection)),
                );
                startVelocity.x += launchDirection.x * launch;
                startVelocity.z += launchDirection.z * launch;
            }
            // Bounded pursuit estimate; it is not a position/velocity write. The
            // actual articulated controller and floor contact still decide arrival.
            const change = {
                x: desired.x * speed - startVelocity.x,
                y: 0,
                z: desired.z * speed - startVelocity.z,
            };
            const acceleration = Math.min(
                s.movementMaxAcceleration,
                s.movementAcceleration * this._length(change),
            );
            const accelerationTime =
                acceleration > 1e-6 ? Math.min(time, this._length(change) / acceleration) : 0;
            const travel = acceleration * accelerationTime * (time - accelerationTime * 0.5);
            const direction = this._unit(change);
            const predicted = {
                x: root.x + startVelocity.x * time + direction.x * travel,
                z: root.z + startVelocity.z * time + direction.z * travel,
            };
            if (input === null) {
                const approach = { x: stance.x - root.x, y: 0, z: stance.z - root.z };
                const span = this._length(approach),
                    along = this._dot(
                        { x: predicted.x - root.x, y: 0, z: predicted.z - root.z },
                        this._unit(approach),
                    );
                if (along >= span) {
                    predicted.x = stance.x;
                    predicted.z = stance.z;
                }
            }
            const distance = Math.hypot(point.x - predicted.x, point.z - predicted.z);
            const mode = sliding ? 'slide' : distance > receive.cushionReach ? 'lunge' : 'cushion';
            const scale = Math.min(
                s.legStretch.maxScale,
                Math.max(p.legs.L.scale, p.legs.R.scale) + s.legStretch.extendRate * time,
            );
            const extension = (scale - 1) * s.airKick.reach;
            const reachable =
                distance <=
                    (sliding
                        ? receive.slideReach
                        : mode === 'lunge'
                          ? receive.lungeReach
                          : receive.cushionReach) +
                        (mode === 'cushion' ? 0 : extension) &&
                (!sliding || moving);
            return { mode, reachable, point, time, stance, moving, at: this.time, distance };
        };
        const toss = this.settings.groundToss;
        const normal = candidate(toss.contactHeight, false);
        if (normal?.reachable) return normal;
        const slides = receive.slideContactFractions.map((fraction) =>
            candidate(toss.contactHeight * fraction, true),
        );
        return slides.find((plan) => plan?.reachable) || normal || slides.find(Boolean) || null;
    }

    _updateReceive(p, input, move, strokeDue) {
        const settings = p.settings.receive;
        if (
            p.jump.active ||
            input.jump ||
            input.jumpPressed ||
            (input.kickPressed && p.receive?.phase === 'recover')
        )
            p.receive = null;
        if (p.receive) {
            const action = p.receive;
            const cancel =
                !input.kick ||
                (action.mode === 'slide' &&
                    (this._length(move) <= settings.moveThreshold ||
                        this._dot(this._unit(move), action.direction) <=
                            settings.directionThreshold));
            if (cancel || this.time >= action.until) action.phase = 'recover';
            else if (action.phase !== 'recover')
                action.phase =
                    this.time >= action.contactAt || action.hitAt !== null ? 'contact' : 'prepare';
            if (!input.kick && this.time >= action.until) p.receive = null;
            return p.receive?.phase !== 'recover' && !!input.kick;
        }
        const plan = input.receive;
        if (
            !input.kick ||
            !plan?.reachable ||
            p.jump.active ||
            input.jump ||
            input.jumpPressed ||
            !(p.grounded || p.supportAge < 0.08) ||
            !['cushion', 'lunge', 'slide'].includes(plan.mode)
        )
            return false;
        const remaining = plan.at + plan.time - this.time;
        if (!(remaining > 0.015 && remaining <= settings.commitment)) return false;
        // 쿠션·런지는 몸을 옮기지 않는 자세라 휘두르기와 같은 때(_strokeDue) 시작한다. 일찍 누른 길이가 자세 전환·다리 뻗기 진행을 바꾸지 않는다.
        // 슬라이드는 몸을 던져 가야 하는 거리가 있어 누른 걸음에 시작한다(점프처럼 누른 시각이 몸 궤적을 정한다).
        // 토스 목표가 없는 지상 차기는 발이 기다리지 않고 바로 차므로(_armGroundToss) 받기 자세도 미루지 않는다.
        if (plan.mode !== 'slide' && this._tossing(input) && !strokeDue()) return false;
        const root = p.root.translation();
        const direction = this._unit({ x: plan.point.x - root.x, y: 0, z: plan.point.z - root.z });
        if (
            plan.mode === 'slide' &&
            (!plan.allowSlide ||
                this._length(move) <= settings.moveThreshold ||
                this._dot(this._unit(move), direction) <= settings.directionThreshold)
        )
            return false;
        const follow = plan.mode === 'slide' ? settings.slide.follow : settings.lunge.follow;
        p.receive = {
            mode: plan.mode,
            phase: 'prepare',
            point: { ...plan.point },
            startedAt: this.time,
            contactAt: this.time + remaining,
            until: this.time + remaining + follow,
            direction,
            committed: true,
            hitAt: null,
        };
        if (plan.mode === 'slide') {
            // Push off once in the held movement direction, as a grounded jump uses
            // a finite launch impulse. Every body part receives its mass share;
            // subsequent travel is ordinary collision/drag and bounded locomotion.
            const launchDirection = this._unit(move),
                amount = this._length(move),
                s = p.settings;
            const launch = Math.min(
                s.movementSpeed * settings.slide.launchScale * amount,
                Math.max(
                    0,
                    s.movementSpeed * settings.slide.speed * amount -
                        this._dot(this._bodyVelocity(p), launchDirection),
                ),
            );
            for (const part of p.parts)
                part.body.applyImpulse(this._mul(launchDirection, part.mass * launch), true);
            p.receive.launch = launch;
        }
        return true;
    }

    _buildCourt() {
        const R = this.R,
            s = this.settings,
            court = this.config.court;
        const floor = this.world.createCollider(
            R.ColliderDesc.cuboid(30, 0.12, 25)
                .setTranslation(0, -0.12, 0)
                .setFriction(0.85)
                .setRestitution(0)
                .setCollisionGroups(this._groups(1))
                .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        );
        this.floorHandle = floor.handle;
        this.colliderMeta.set(floor.handle, { kind: 'floor' });
        const { net: netShape, post: postShape } = takrawNetShape(court, s);
        const net = this.world.createCollider(
            R.ColliderDesc.cuboid(netShape.halfThickness, netShape.halfHeight, netShape.halfWidth)
                .setTranslation(0, netShape.centerY, 0)
                .setFriction(0.5)
                .setRestitution(0.16)
                .setCollisionGroups(this._groups(1))
                .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        );
        this.colliderMeta.set(net.handle, { kind: 'net' });
        for (const z of [-postShape.z, postShape.z]) {
            const post = this.world.createCollider(
                R.ColliderDesc.capsule(postShape.halfLength, postShape.radius)
                    .setTranslation(0, postShape.centerY, z)
                    .setFriction(0.6)
                    .setCollisionGroups(this._groups(1))
                    .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
            );
            this.colliderMeta.set(post.handle, { kind: 'net' });
        }
    }

    _buildPlayer(id) {
        const R = this.R;
        const team = takrawTeamOf(id),
            slot = takrawSlotOf(id),
            toward = team === 0 ? 1 : -1;
        const role = TAKRAW_ROLES[slot];
        const formation = this.config.formation[role];
        const home = { x: formation.x * toward, z: formation.z * toward };
        const p = {
            id,
            team,
            role,
            toward,
            home,
            yaw: (toward * Math.PI) / 2,
            parts: [],
            byName: {},
            joints: [],
            state: 'standing',
            grounded: false,
            contacts: [],
            mass: 0,
            jump: {},
            kick: {},
            gait: 0,
            airTime: 0,
            supportAge: 1,
            recoveryTime: 0,
            lastTouch: -10,
            desiredYaw: (toward * Math.PI) / 2,
            freeTime: 0,
            landArmed: false,
            locomotionActive: false,
            legs: { L: { scale: 1, targetScale: 1 }, R: { scale: 1, targetScale: 1 } },
            reaction: { remaining: 0, duration: 0, severity: 0, incomingSpeed: 0 },
        };
        const member = 1 << (id + 2);
        const descriptors = [
            ['pelvis', 'box', [0, 1.0, 0], 10, { halfExtents: { x: 0.17, y: 0.1, z: 0.11 } }],
            ['torso', 'box', [0, 1.27, 0], 18, { halfExtents: { x: 0.23, y: 0.19, z: 0.12 } }],
            ['head', 'sphere', [0, 1.62, 0.005], 4.5, { radius: 0.115 }],
        ];
        for (const [suffix, side] of [
            ['L', -1],
            ['R', 1],
        ]) {
            descriptors.push(
                [
                    'upperLeg' + suffix,
                    'capsule',
                    [side * 0.12, 0.74, 0],
                    7,
                    { radius: 0.065, halfHeight: 0.135 },
                ],
                [
                    'lowerLeg' + suffix,
                    'capsule',
                    [side * 0.12, 0.34, 0],
                    4,
                    { radius: 0.055, halfHeight: 0.145 },
                ],
                [
                    'foot' + suffix,
                    'box',
                    [side * 0.12, 0.075, 0.085],
                    1.4,
                    { halfExtents: { x: 0.075, y: 0.055, z: 0.145 } },
                ],
                [
                    'upperArm' + suffix,
                    'capsule',
                    [side * 0.29, 1.25, 0],
                    2.5,
                    { radius: 0.046, halfHeight: 0.104 },
                ],
                [
                    'forearm' + suffix,
                    'capsule',
                    [side * 0.29, 0.97, 0],
                    1.5,
                    { radius: 0.037, halfHeight: 0.093 },
                ],
                ['hand' + suffix, 'sphere', [side * 0.29, 0.785, 0], 0.6, { radius: 0.055 }],
            );
        }
        const q = this._yaw(p.yaw);
        for (const [name, shape, localArray, mass, geometry] of descriptors) {
            const local = this._v(...localArray),
                pos = this._add(this._v(home.x, 0, home.z), this._rotate(q, local));
            const body = this.world.createRigidBody(
                R.RigidBodyDesc.dynamic()
                    .setTranslation(pos.x, pos.y, pos.z)
                    .setRotation(q)
                    .setLinearDamping(0.08)
                    .setAngularDamping(0.12)
                    .setCanSleep(false)
                    .setCcdEnabled(name.startsWith('foot') || name.startsWith('lowerLeg')),
            );
            let desc;
            if (shape === 'sphere') desc = R.ColliderDesc.ball(geometry.radius);
            else if (shape === 'capsule')
                desc = R.ColliderDesc.capsule(geometry.halfHeight, geometry.radius);
            else
                desc = R.ColliderDesc.cuboid(
                    geometry.halfExtents.x,
                    geometry.halfExtents.y,
                    geometry.halfExtents.z,
                );
            const collider = this.world.createCollider(
                desc
                    .setMass(mass)
                    .setFriction(name.startsWith('foot') ? 0.9 : 0.42)
                    .setRestitution(0.04)
                    // 발·정강이와 공의 접촉은 Rapier가 풀지 않고 걸음 사이 경로로 직접 푼다(_sweepBallContacts). 그래서 공(그룹 비트 2)을 거른다.
                    .setCollisionGroups(
                        this._groups(
                            member,
                            0xffff ^ member ^ (this._sweptPart(name) ? BALL_GROUP : 0),
                        ),
                    )
                    .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
                body,
            );
            const part = {
                name,
                id: 'p' + id + ':' + name,
                body,
                colliderHandle: collider.handle,
                shape,
                mass,
                local,
                restGeometry: structuredClone(geometry),
                ...geometry,
            };
            if (/^(upperLeg|lowerLeg)/.test(name))
                part.restLength = 2 * (geometry.halfHeight + geometry.radius);
            p.parts.push(part);
            p.byName[name] = part;
            p.mass += mass;
            this.colliderMeta.set(collider.handle, {
                kind: 'player',
                playerId: id,
                team,
                part: name,
            });
        }
        p.root = p.byName.pelvis.body;
        const joint = (name, parent, child, anchorArray, hinge, stiffness, damping, maxForce) => {
            const a = p.byName[parent],
                b = p.byName[child],
                anchor = this._v(...anchorArray);
            const localA = this._sub(anchor, a.local),
                localB = this._sub(anchor, b.local);
            // 무릎은 +x 축(양수 = 정강이가 뒤로), 팔꿈치는 -x 축(양수 = 아래팔이 앞으로)이라 둘 다 0~2.45가 사람 방향이다.
            const data = hinge
                ? R.JointData.revolute(localA, localB, {
                      x: name.startsWith('elbow') ? -1 : 1,
                      y: 0,
                      z: 0,
                  })
                : R.JointData.spherical(localA, localB);
            let j = this.world.createImpulseJoint(data, a.body, b.body, true);
            // Rapier 0.21.0 currently returns GenericImpulseJoint for a spherical joint.
            // The public spherical wrapper exposes the valid angular motor API.
            if (!hinge && typeof j.configureMotorPosition !== 'function') {
                j = new R.SphericalImpulseJoint(
                    this.world.impulseJoints.raw,
                    this.world.bodies,
                    j.handle,
                );
            }
            j.setContactsEnabled(false);
            if (hinge) {
                j.setLimits(0, 2.45);
                j.configureMotorModel(R.MotorModel.ForceBased);
            } else
                for (const axis of [R.JointAxis.AngX, R.JointAxis.AngY, R.JointAxis.AngZ])
                    j.configureMotorModel(axis, R.MotorModel.ForceBased);
            // 구형 관절의 사람 가동 범위(joint-limits.js)를 Rapier 관절 한계로 건다. 표에 없는 관절은 한계가 없다.
            const humanLimits = hinge ? null : HUMAN_JOINT_LIMITS[name.replace(/[LR]$/, '')];
            if (humanLimits) {
                const left = name.endsWith('L');
                for (const [axis, key] of [
                    [R.JointAxis.AngX, 'x'],
                    [R.JointAxis.AngY, 'twist'],
                    [R.JointAxis.AngZ, 'z'],
                ]) {
                    const [min, max] = humanLimits[key].map((value) => (value * Math.PI) / 180);
                    const mirrored = left && key !== 'x';
                    j.rawSet.jointSetLimits(
                        j.handle,
                        axis,
                        mirrored ? -max : min,
                        mirrored ? -min : max,
                    );
                }
            }
            const item = {
                name,
                parent,
                child,
                joint: j,
                handle: j.handle,
                hinge,
                stiffness,
                damping,
                maxForce,
                restAnchor1: { ...localA },
                restAnchor2: { ...localB },
                target: [0, 0, 0],
                anchor,
            };
            p.joints.push(item);
            this._motor(item, item.target, 1);
        };
        joint('waist', 'pelvis', 'torso', [0, 1.1, 0], false, 130, 15, 95);
        joint('neck', 'torso', 'head', [0, 1.48, 0], false, 24, 3.6, 15);
        for (const [suffix, side] of [
            ['L', -1],
            ['R', 1],
        ]) {
            joint(
                'hip' + suffix,
                'pelvis',
                'upperLeg' + suffix,
                [side * 0.12, 0.94, 0],
                false,
                110,
                13,
                90,
            );
            joint(
                'knee' + suffix,
                'upperLeg' + suffix,
                'lowerLeg' + suffix,
                [side * 0.12, 0.54, 0],
                true,
                130,
                14,
                85,
            );
            joint(
                'ankle' + suffix,
                'lowerLeg' + suffix,
                'foot' + suffix,
                [side * 0.12, 0.14, 0],
                false,
                45,
                5.5,
                32,
            );
            joint(
                'shoulder' + suffix,
                'torso',
                'upperArm' + suffix,
                [side * 0.29, 1.4, 0],
                false,
                25,
                3.5,
                24,
            );
            joint(
                'elbow' + suffix,
                'upperArm' + suffix,
                'forearm' + suffix,
                [side * 0.29, 1.1, 0],
                true,
                22,
                3.0,
                20,
            );
            joint(
                'wrist' + suffix,
                'forearm' + suffix,
                'hand' + suffix,
                [side * 0.29, 0.84, 0],
                false,
                12,
                1.5,
                9,
            );
        }
        return p;
    }

    _buildBall() {
        const R = this.R,
            s = this.settings;
        this.ball = this.world.createRigidBody(
            R.RigidBodyDesc.dynamic()
                .setCcdEnabled(true)
                .setLinearDamping(s.ballDamping)
                .setAngularDamping(0.08)
                .setCanSleep(false),
        );
        const collider = this.world.createCollider(
            R.ColliderDesc.ball(s.ballRadius)
                .setMass(s.ballMass)
                .setFriction(0.45)
                .setRestitution(s.ballRestitution)
                .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
                .setCollisionGroups(this._groups(BALL_GROUP))
                .setActiveEvents(
                    R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS,
                ),
            this.ball,
        );
        this.ballColliderHandle = collider.handle;
        this.colliderMeta.set(collider.handle, { kind: 'ball' });
    }

    /** 관절 모터가 세기 strength에서 쓰는 강성·감쇠·최대 토크. 모터 설정(_motor)과 다리 관절 계획의 토크 한계(_legPlanModel)가 같이 읽는다. */
    _motorGains(j, strength) {
        return {
            stiffness: j.stiffness * strength,
            damping: j.damping * Math.max(0.16, Math.sqrt(strength)),
            cap: j.maxForce * Math.max(0.08, strength),
        };
    }

    /**
     * 관절 모터에 목표각을 건다. track = { velocity, torque }(축별 배열)를 주면 목표 각속도를 함께 걸고, 궤적이 요구하는 토크를
     * 목표각 오프셋(토크 ÷ 강성)으로 앞먹인다. 모터 토크 = 강성 × (목표각 − 각) + 감쇠 × (목표 각속도 − 각속도)이고 최대 토크에서 잘린다.
     */
    _motor(j, target, strength, track = null) {
        j.target = target;
        const R = this.R,
            { stiffness, damping, cap } = this._motorGains(j, strength);
        const lead = (i) => (track && stiffness > 0 ? track.torque[i] / stiffness : 0);
        if (j.hinge) {
            if (track)
                j.joint.configureMotor(target[0] + lead(0), track.velocity[0], stiffness, damping);
            else j.joint.configureMotorPosition(target[0], stiffness, damping);
            j.joint.setMotorMaxForce(cap);
        } else {
            [R.JointAxis.AngX, R.JointAxis.AngY, R.JointAxis.AngZ].forEach((axis, i) => {
                if (track)
                    j.joint.configureMotor(
                        axis,
                        target[i] + lead(i),
                        track.velocity[i],
                        stiffness,
                        damping,
                    );
                else j.joint.configureMotorPosition(axis, target[i], stiffness, damping);
                j.joint.setMotorMaxForce(axis, cap);
            });
        }
    }

    /** starts: 선수 id → {x, z}. 지정한 선수만 기본 자리(home) 대신 그 자리에서 시작한다(유저 서브 위치). */
    resetPlayers(starts = null) {
        this.restoredSnapshotBytes = null;
        this.ballContacts.clear();
        this.netContacts.clear();
        this.lastBallTouch = null;
        for (const p of this.players) {
            for (const suffix of ['L', 'R']) {
                p.legs[suffix].targetScale = 1;
                this._setLegScale(p, suffix, 1, true);
            }
            const q = this._yaw(p.yaw);
            for (const part of p.parts) {
                const start = starts?.[p.id] || p.home;
                part.body.setTranslation(
                    this._add(this._v(start.x, 0, start.z), this._rotate(q, part.local)),
                    true,
                );
                part.body.setRotation(q, true);
                part.body.setLinvel(this._v(), true);
                part.body.setAngvel(this._v(), true);
                part.body.resetForces(true);
                part.body.resetTorques(true);
            }
            p.state = 'standing';
            p.grounded = false;
            p.contacts = [];
            p.gait = 0;
            p.airTime = 0;
            p.supportAge = 0;
            p.recoveryTime = 0;
            p.lastTouch = -10;
            p.freeTime = 0;
            p.landArmed = false;
            p.locomotionActive = false;
            p.receive = null;
            p.reaction = { remaining: 0, duration: 0, severity: 0, incomingSpeed: 0 };
            p.desiredYaw = p.yaw;
            p.jump = { active: false, held: false, time: 0, cooldown: 0, airKickStarted: false };
            p.kick = {
                held: false,
                mode: 'none',
                side: this.settings.dominantFoot.side,
                receivePlan: null,
                airPlan: null,
            };
            for (const j of p.joints) this._motor(j, [0, 0, 0], 1);
        }
        this.queue.clear();
    }

    resetBall(position, velocity = { x: 0, y: 0, z: 0 }) {
        this.restoredSnapshotBytes = null;
        this.ball.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
        this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        this.ball.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
        this.ball.setAngvel(this._v(), true);
        this.ball.resetForces(true);
        this.ball.resetTorques(true);
        this.ballContacts.clear();
        this.lastBallTouch = null;
        for (const p of this.players) p.lastTouch = -10;
        this.queue.clear();
    }

    _groundInfo(p) {
        const floor = this.world.getCollider(this.floorHandle);
        const contacts = [];
        for (const part of p.parts) {
            const collider = this.world.getCollider(part.colliderHandle);
            this.world.contactPair(collider, floor, (manifold) => {
                if (manifold.numSolverContacts() > 0) contacts.push(part.name);
            });
        }
        p.contacts = contacts;
        const feet = contacts.some((name) => name.startsWith('foot'));
        return { any: contacts.length > 0, feet };
    }

    _orientRoot(p, dt, strength, yawOnly = false, lean = null) {
        const body = p.root,
            q = body.rotation(),
            w = body.angvel();
        let desired = this._yaw(p.desiredYaw);
        if (lean) {
            const sine = Math.sin(lean.angle / 2);
            desired = this._qmul(
                {
                    x: lean.direction.z * sine,
                    y: 0,
                    z: -lean.direction.x * sine,
                    w: Math.cos(lean.angle / 2),
                },
                desired,
            );
        }
        let error = this._qmul(desired, this._conj(q));
        if (error.w < 0) error = { x: -error.x, y: -error.y, z: -error.z, w: -error.w };
        const sine = Math.hypot(error.x, error.y, error.z);
        const angle = 2 * Math.atan2(sine, this._clamp(error.w, -1, 1));
        const factor = sine > 1e-7 ? angle / sine : 2;
        const e = this._mul(error, factor);
        const torque = this._limit(
            {
                x: yawOnly ? -w.x * 1.0 : 690 * e.x - 82 * w.x,
                y: 65 * e.y - 14 * w.y,
                z: yawOnly ? -w.z * 1.0 : 690 * e.z - 82 * w.z,
            },
            yawOnly ? 55 : 380,
        );
        body.applyTorqueImpulse(this._mul(torque, dt * strength), true);
    }

    /**
     * 발 PD. 이득은 footDrive.controlStepMs(v0.19.12의 물리 한 걸음 1000/120 ms) 동안 그 칸 시작 상태로 힘을 거는 것으로 맞춘 값이다.
     * 물리 한 걸음이 그보다 길면 걸음을 그 칸으로 나눠, 발(질점, 발 몸체 질량)이 이 힘에 어떻게 움직일지 예측하며 칸마다 되먹임·발등 밀기·힘 상한·
     * 힘-속도 한계를 다시 계산하고 그 평균을 건다. 걸음 시작 상태 하나로 25 ms 내내 같은 힘을 걸면 속도 이득 × 걸음 / 질량이 커져(지상 토스 약 2.5)
     * 발이 목표를 지나쳐 걸음마다 튄다. 걸음이 한 칸 이하이면 칸이 하나라 계산이 v0.19.12와 같다.
     */
    _footDrive(
        p,
        part,
        target,
        desiredVelocity,
        maxForce,
        dt,
        positionGain,
        velocityGain,
        applicationPoint = null,
        feedForward = null,
        contactDrive = null,
        speedLimit = null,
    ) {
        const point = applicationPoint || part.body.translation(),
            velocity = part.body.velocityAtPoint(point);
        const cells = Math.max(
                1,
                Math.ceil(dt / (this.settings.footDrive.controlStepMs / 1000) - 1e-9),
            ),
            cell = dt / cells,
            mass = part.body.mass();
        // 계획 목표는 걸음 끝 시각의 값이다(계획 함수가 this.time + dt로 계산). 칸마다 그 칸 끝의 목표가 되도록 목표 속도로 첫 칸 끝까지 되짚는다.
        let error = this._sub(
                cells > 1 ? this._sub(target, this._mul(desiredVelocity, dt - cell)) : target,
                point,
            ),
            modelVelocity = velocity,
            driveGap = contactDrive ? contactDrive.gap : 0,
            driveClosing = contactDrive ? contactDrive.closing : 0,
            sum = this._v();
        for (let index = 0; index < cells; index++) {
            const feedback = this._add(
                this._mul(error, positionGain),
                this._mul(this._sub(desiredVelocity, modelVelocity), velocityGain),
            );
            let requested = feedForward ? this._add(feedback, feedForward) : feedback;
            if (contactDrive) {
                const { normal, targetClosing, weight } = contactDrive;
                // The real instep may reach a falling ball before the planned clock.
                // Build the intended closing speed over the actual remaining gap.
                // Only the foot force changes; the ball contact itself is solved separately.
                const acceleration =
                    (targetClosing * targetClosing - driveClosing * Math.abs(driveClosing)) /
                    (2 * Math.max(driveGap, this.settings.ballRadius * 0.05));
                const normalForce = contactDrive.mass * acceleration;
                requested = this._add(
                    requested,
                    this._mul(normal, (normalForce - this._dot(requested, normal)) * weight),
                );
            }
            const limited = this._limit(requested, maxForce);
            const force = speedLimit
                ? this._forceVelocityLimit(
                      limited,
                      this._sub(modelVelocity, speedLimit.reference),
                      speedLimit.maxSpeed,
                  )
                : limited;
            sum = this._add(sum, force);
            if (index + 1 < cells) {
                // 앞먹임(중력·목표 가속 보상)은 목표가 함께 가속하는 몫이라 오차를 줄이지 않는다. 되먹임 몫만 발 속도를 바꾼다.
                const change = this._mul(
                    feedForward ? this._sub(force, feedForward) : force,
                    cell / mass,
                );
                modelVelocity = this._add(modelVelocity, change);
                error = this._add(
                    error,
                    this._mul(this._sub(desiredVelocity, modelVelocity), cell),
                );
                if (contactDrive) {
                    driveClosing += this._dot(change, contactDrive.normal);
                    driveGap -= driveClosing * cell;
                }
            }
        }
        const impulse = this._mul(sum, cell);
        part.body.applyImpulseAtPoint(impulse, point, true);
        // Equal/opposite impulses at the same world point cancel the total wrench.
        // Unlike an opposite force at pelvis COM, this also preserves angular momentum.
        p.root.applyImpulseAtPoint(this._mul(impulse, -1), point, true);
    }

    /**
     * 다리 근육의 힘-속도 관계(Hill 곡선의 선형 근사): 발이 엉덩이에 대해 움직이는 방향으로 더 미는 힘은
     * (1 - 속도/maxSpeed)배로 줄어 maxSpeed에서 0이 된다. 멈추거나 방향을 트는 힘(속도 반대·옆 성분)은 그대로 둔다
     * (근육은 늘어나며 버틸 때 줄어들며 밀 때보다 약하지 않다). 공·궤적은 건드리지 않고 발에 거는 힘만 줄인다.
     */
    _forceVelocityLimit(force, relative, maxSpeed) {
        const speed = this._length(relative);
        if (speed < 1e-9) return force;
        const direction = this._mul(relative, 1 / speed),
            along = this._dot(force, direction);
        if (along <= 0) return force;
        return this._sub(force, this._mul(direction, along * Math.min(1, speed / maxSpeed)));
    }

    _instepDrive(p, normal, targetClosing, forefoot, settings) {
        const foot = p.byName['foot' + p.kick.side].body,
            ball = this.ball.translation();
        const sole = this._point(foot, this._v(0, 0.055, forefoot)),
            velocity = foot.velocityAtPoint(sole);
        const gap = this._dot(this._sub(ball, sole), normal) - this.settings.ballRadius;
        const local = this._rotate(
            this._conj(foot.rotation()),
            this._sub(ball, foot.translation()),
        );
        const face = this._dot(this._rotate(foot.rotation(), this._v(0, 1, 0)), normal);
        const extent = p.byName['foot' + p.kick.side].halfExtents,
            radius = this.settings.ballRadius;
        const range = radius * 2 + settings.clearance;
        const onInstep =
            local.y > 0 &&
            Math.abs(local.x) < extent.x + radius * 0.5 &&
            local.z > -radius * 0.25 &&
            local.z < extent.z + radius * 0.5;
        if (!onInstep || face <= 0.85 || gap < -radius * 0.25 || gap >= range) return null;
        return {
            normal,
            gap,
            closing: this._dot(this._sub(velocity, this.ball.linvel()), normal),
            targetClosing,
            weight:
                this._clamp((range - gap) / radius, 0, 1) * this._clamp((face - 0.85) / 0.1, 0, 1),
            mass: settings.driveMass,
        };
    }

    _legReach(p, suffix) {
        const length =
            p.byName['upperLeg' + suffix].restLength + p.byName['lowerLeg' + suffix].restLength;
        return Math.min(this.settings.airKick.reach, length - 0.005) * p.legs[suffix].scale;
    }

    _legMinReach(p, suffix) {
        const scale = p.legs[suffix].scale;
        const upper = p.byName['upperLeg' + suffix].restLength * scale;
        const lower = p.byName['lowerLeg' + suffix].restLength * scale;
        const bend = p.joints.find((joint) => joint.name === 'knee' + suffix).joint.limitsMax();
        return (
            Math.sqrt(upper * upper + lower * lower + 2 * upper * lower * Math.cos(bend)) + 0.005
        );
    }

    _setLegScale(p, suffix, value, force = false) {
        const state = p.legs[suffix],
            scale = this._clamp(value, 1, this.settings.legStretch.maxScale);
        if (!force && Math.abs(state.scale - scale) < 1e-12) return;
        this.restoredSnapshotBytes = null;
        state.scale = scale;
        for (const name of ['upperLeg' + suffix, 'lowerLeg' + suffix]) {
            const part = p.byName[name],
                collider = this.world.getCollider(part.colliderHandle);
            // Keep the cap radius and mass fixed; only the long axis extends.
            part.radius = part.restGeometry.radius;
            part.halfHeight = part.restGeometry.halfHeight + part.restLength * (scale - 1) * 0.5;
            collider.setHalfHeight(part.halfHeight);
            collider.clearShapeCache();
            collider.setMass(part.mass);
            part.body.recomputeMassPropertiesFromColliders();
        }
        for (const name of ['hip' + suffix, 'knee' + suffix, 'ankle' + suffix]) {
            const item = p.joints.find((joint) => joint.name === name);
            if (item.parent === 'upperLeg' + suffix || item.parent === 'lowerLeg' + suffix) {
                item.joint.setAnchor1({ ...item.restAnchor1, y: item.restAnchor1.y * scale });
            }
            if (item.child === 'upperLeg' + suffix || item.child === 'lowerLeg' + suffix) {
                item.joint.setAnchor2({ ...item.restAnchor2, y: item.restAnchor2.y * scale });
            }
        }
        // No body pose or velocity assignment: the articulated solver moves the
        // changed anchors, including the smooth return after the input is released.
    }

    _updateLegStretch(p, dt) {
        const settings = this.settings.legStretch;
        const elapsed = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1 / 30) : 0;
        const air =
            p.kick.held &&
            p.kick.mode === 'air' &&
            !p.grounded &&
            p.kick.airPlan &&
            p.kick.airPlan.phase !== 'follow';
        const receive =
            p.kick.held &&
            p.kick.mode === 'ground' &&
            p.receive &&
            p.receive.mode !== 'cushion' &&
            p.receive.phase !== 'recover' &&
            p.receive.hitAt === null;
        const active = air || receive;
        for (const suffix of ['L', 'R']) {
            const state = p.legs[suffix],
                restReach = this._legReach(p, suffix) / state.scale;
            const hip = receive
                ? this._point(p.root, { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 })
                : null;
            const plan = receive ? p.kick.receivePlan : null;
            const receivePoint = plan
                ? this._add(
                      plan.point,
                      this._add(this._mul(plan.normal, 0.065), this._mul(plan.forward, -0.085)),
                  )
                : receive
                  ? p.receive.point
                  : null;
            const requested =
                active && suffix === p.kick.side
                    ? air
                        ? p.kick.airPlan.requestedReach
                        : this._length(this._sub(receivePoint, hip))
                    : restReach;
            const wanted = this._clamp(
                Number.isFinite(requested) ? requested / restReach : 1,
                1,
                settings.maxScale,
            );
            // Keep the reach prepared for this held swing until contact or release.
            // Retraction in the brief wind-up would remove the same few centimetres
            // that the following real stroke needs to keep its forward velocity.
            state.targetScale =
                active && suffix === p.kick.side ? Math.max(state.targetScale, wanted) : 1;
            const rate =
                state.targetScale > state.scale ? settings.extendRate : settings.retractRate;
            const change = this._clamp(
                state.targetScale - state.scale,
                -rate * elapsed,
                rate * elapsed,
            );
            this._setLegScale(p, suffix, state.scale + change);
        }
    }

    _legTargets(
        p,
        suffix,
        footTarget,
        blend = 1,
        rootPosition = p.root.translation(),
        rootRotation = p.root.rotation(),
    ) {
        const inv = this._conj(rootRotation);
        const local = this._rotate(inv, this._sub(footTarget, rootPosition));
        local.x -= suffix === 'L' ? -0.12 : 0.12;
        local.y += 0.06;
        // The foot COM is ahead of its ankle by 8.5 cm.
        local.z -= 0.055;
        const scale = p.legs[suffix].scale;
        const upper = p.byName['upperLeg' + suffix].restLength * scale;
        const lower = p.byName['lowerLeg' + suffix].restLength * scale;
        const distance = this._clamp(
            this._length(local),
            this._legMinReach(p, suffix),
            this._legReach(p, suffix),
        );
        const knee =
            Math.PI -
            Math.acos(
                this._clamp(
                    (upper * upper + lower * lower - distance * distance) / (2 * upper * lower),
                    -1,
                    1,
                ),
            );
        const alpha = Math.acos(
            this._clamp(
                (upper * upper + distance * distance - lower * lower) / (2 * upper * distance),
                -1,
                1,
            ),
        );
        const pitch = -Math.atan2(local.z, -local.y) - alpha;
        const roll = Math.atan2(local.x, Math.hypot(local.y, local.z));
        return {
            hip: [pitch * blend, 0, roll * blend],
            knee: [knee * blend, 0, 0],
            ankle: [-(pitch + knee) * 0.7 * blend, 0, -roll * 0.5 * blend],
        };
    }

    _airCounterLegPose(p, suffix, freeLeg) {
        const mirror = p.kick.side === 'L' ? -1 : 1;
        const pose = {};
        for (const joint of ['hip', 'knee', 'ankle']) {
            const value = freeLeg[joint];
            pose[joint] = [value[0], value[1] * mirror, value[2] * mirror];
        }
        const plan = p.kick.airPlan,
            start = 0.3;
        if (
            !p.kick.held ||
            p.kick.mode !== 'air' ||
            p.grounded ||
            suffix === p.kick.side ||
            !plan?.contact?.impact ||
            !['align', 'lift', 'strike'].includes(plan.phase) ||
            !Number.isFinite(plan.remaining) ||
            plan.remaining >= start
        )
            return pose;
        const interval = Math.max(1 / 120, start - this.settings.airKick.contact.strokeTime);
        const progress = this._clamp((start - plan.remaining) / interval, 0, 1);
        const weight = progress * progress * (3 - 2 * progress);
        const scale = p.legs[suffix].scale;
        const upper = p.byName['upperLeg' + suffix].restLength * scale;
        const lower = p.byName['lowerLeg' + suffix].restLength * scale;
        // Use the decoder's existing maximum knee bend, inside the real 2.45 rad
        // hinge limit. Its two-bone chord is 0.290 m at rest, rather than 0.800 m.
        const bend = 2.4;
        const foldedReach = Math.sqrt(
            upper * upper + lower * lower + 2 * upper * lower * Math.cos(bend),
        );
        const hip = this._point(p.root, this._v(suffix === 'L' ? -0.12 : 0.12, -0.06, 0));
        const away = this._unit(
            this._sub(hip, plan.contact.impact),
            this._rotate(p.root.rotation(), this._v(0, -1, 0)),
        );
        const ankle = this._add(hip, this._mul(away, foldedReach));
        // _legTargets consumes the standing foot COM offset. Cancel that offset
        // so the folded chord is the real hip-to-ankle target, as in the active leg.
        const target = this._add(ankle, this._rotate(p.root.rotation(), this._v(0, 0, 0.055)));
        const tuck = this._legTargets(p, suffix, target);
        const pitch = Math.atan2(Math.sin(tuck.hip[0]), Math.cos(tuck.hip[0]));
        tuck.hip = [this._clamp(pitch, -1.5, 1.7), 0, this._clamp(tuck.hip[2], -0.65, 0.65)];
        tuck.knee = [bend, 0, 0];
        tuck.ankle = [
            this._clamp(-(tuck.hip[0] + bend) * 0.7, -1.2, 1.2),
            0,
            this._clamp(-tuck.hip[2] * 0.5, -0.5, 0.5),
        ];
        // Only joint targets change. Existing finite motors retract the real shin;
        // no contact filter, body velocity, root pose or active-leg drive is altered.
        for (const joint of ['hip', 'knee', 'ankle']) {
            pose[joint] = pose[joint].map(
                (value, axis) => value + (tuck[joint][axis] - value) * weight,
            );
        }
        return pose;
    }

    /**
     * 선수 한 명의 한 물리 걸음 제어. 몸 상태 읽기 → 이동·점프 입력 → 행동 결정 → 자세·이동 → 행동 자세 → 발차기 → 관절 모터.
     * 단계 순서와 각 단계 안의 Rapier 읽기·쓰기 순서는 하나의 메서드였을 때와 같다.
     */
    _drivePlayer(p, input, dt) {
        const body = this._senseBody(p, dt);
        const intent = this._readIntent(p, input);
        this._jump(p, input, intent, dt);
        const action = this._selectAction(p, input, body, intent, dt);
        const targetMap = this._restTargets(p);
        this._driveStance(p, body, intent, action, targetMap, dt);
        this._driveActionPose(p, body, action, targetMap, dt);
        const kick = this._driveKick(p, input, body, action, targetMap, dt);
        this._applyJointTargets(p, body, action, targetMap, kick);
    }

    /** 이번 물리 걸음의 몸 상태(뿌리 자세·바닥 접촉·받기 충격 반응)를 읽고 접지·점프 타이머를 갱신한다. */
    _senseBody(p, dt) {
        const drive = p.settings.drive,
            root = p.root,
            pos = root.translation(),
            vel = root.linvel();
        // Force/torque actuation below does not change poses until world.step.
        // Reuse this physics step's root pose for the two IK queries and frame changes.
        const rootRotation = root.rotation();
        // 이번 걸음에 거는 충격량(몸 세우기·뜨는 힘·디딤발 반작용)이 골반 속도를 바꾸기 전의 각속도. 관절 각속도와 엉덩이 속도를 풀린 상태에서 읽는다.
        const rootAngularVelocity = { ...root.angvel() };
        const contact = this._groundInfo(p),
            up = this._rotate(rootRotation, this._v(0, 1, 0));
        p.freeTime = contact.any ? 0 : p.freeTime + dt;
        if (p.freeTime > drive.landing.freeTime && p.airTime > drive.landing.airTime)
            p.landArmed = true;
        p.reaction.remaining = Math.max(0, p.reaction.remaining - dt);
        const reactionWeight = this._reactionWeight(p);
        const muscleResponse = 1 - reactionWeight * drive.reaction.muscleLoss;
        const balanceResponse = 1 - reactionWeight * drive.reaction.balanceLoss;
        p.jump.cooldown = Math.max(0, p.jump.cooldown - dt);
        p.jump.time += dt;
        const supported = contact.feet && !(p.jump.active && p.jump.time < drive.jump.supportDelay);
        p.supportAge = supported ? 0 : p.supportAge + dt;
        p.grounded = supported && up.y > drive.grounded.up && pos.y > drive.grounded.height;
        if (contact.any && p.jump.time > drive.jump.endTime && vel.y < drive.jump.endRiseSpeed)
            p.jump.active = false;
        return {
            pos,
            vel,
            rootRotation,
            rootAngularVelocity,
            contact,
            up,
            muscleResponse,
            balanceResponse,
        };
    }

    /** 받기 충격 반응의 지금 세기(0~1). 근육·균형 제어가 이만큼의 비율로 빠진다. */
    _reactionWeight(p) {
        const reaction = p.settings.drive.reaction;
        return p.reaction.duration > 0
            ? p.reaction.severity *
                  Math.min(1, p.reaction.remaining / (p.reaction.duration * reaction.hold))
            : 0;
    }

    /** 입력의 이동 방향과 점프·발차기 유지 의도. 점프가 발차기 모드를 바꾸기 전에 읽는다. */
    _readIntent(p, input) {
        const move = this._limit({ x: Number(input.x) || 0, y: 0, z: Number(input.z) || 0 }, 1);
        const moving = this._length(move);
        const jumpPressed = !!input.jumpPressed;
        // Capture the held leg before an accepted jump changes the mode. A new
        // airborne click chooses its own leg; a ground hold carries its leg over.
        const continuingGroundKick =
            !!input.kick &&
            p.kick.held &&
            (p.kick.mode === 'ground' ||
                (!p.jump.active && p.supportAge < p.settings.drive.jump.coyoteTime));
        return { move, moving, jumpPressed, continuingGroundKick };
    }

    /** 점프 시작 충격량, 누르고 있는 동안의 추가 가속, 공중 시간. */
    _jump(p, input, intent, dt) {
        const s = p.settings;
        const { jumpPressed } = intent;
        if (
            jumpPressed &&
            (p.grounded || (p.supportAge < s.drive.jump.coyoteTime && !p.jump.active)) &&
            p.jump.cooldown <= 0
        ) {
            // The impulse accelerates the entire articulated body. A moving pelvis
            // is not its centre-of-mass velocity, especially with a raised leg.
            const delta = Math.max(0, s.jumpSpeed - this._bodyVelocity(p).y);
            for (const part of p.parts)
                part.body.applyImpulse({ x: 0, y: part.mass * delta, z: 0 }, true);
            p.jump.active = true;
            p.jump.time = 0;
            p.jump.cooldown = s.drive.jump.cooldown;
            p.jump.airKickStarted = false;
            p.grounded = false;
            p.supportAge = 1;
            p.kick.mode = 'none';
        }
        p.jump.held = !!input.jump;
        if (
            p.jump.active &&
            input.jump &&
            p.jump.time < s.jumpHoldTime &&
            this._bodyVelocity(p).y > 0
        ) {
            for (const part of p.parts)
                part.body.applyImpulse(
                    { x: 0, y: part.mass * s.jumpHoldAcceleration * dt, z: 0 },
                    true,
                );
        }
        if (p.grounded) p.airTime = 0;
        else p.airTime += dt;
    }

    /** 받기·넘어짐·공중·발차기 모드와 선수 상태를 정하고 다리 늘이기·공중 발 목표를 갱신한다. */
    _selectAction(p, input, body, intent, dt) {
        const s = p.settings;
        const { pos, vel, rootRotation, contact, up, muscleResponse } = body;
        const { move, moving, continuingGroundKick } = intent;
        // 휘두르기 시작 판정(_strokeDue)은 이 걸음에 받기 동작과 발 계획이 같이 쓴다. 한 번만 풀어 둘이 같은 답을 본다.
        let due = null;
        const strokeDue = () => (due ??= this._strokeDue(p, input, dt));
        const receive = this._updateReceive(p, input, move, strokeDue) ? p.receive : null;
        const receiving = receive && receive.mode !== 'cushion';
        const motion = receive && receive.mode !== 'cushion' ? s.receive[receive.mode] : null;
        const receiveBlend = motion
            ? this._clamp((this.time - receive.startedAt + dt) / s.receive.preparation, 0, 1)
            : 0;
        const fallen =
            !receiving &&
            contact.any &&
            !p.grounded &&
            !p.jump.active &&
            (up.y < s.drive.fallen.up || pos.y < s.drive.fallen.height);
        p.recoveryTime = fallen ? p.recoveryTime + dt : 0;
        const airborne =
            !receiving &&
            !p.grounded &&
            !fallen &&
            (p.jump.active || p.airTime > s.drive.airborneDelay);
        const kicking =
            !!input.kick &&
            !(p.receive && p.receive.mode !== 'cushion' && p.receive.phase === 'recover');
        const mode = kicking ? (airborne ? 'air' : 'ground') : 'none';
        if (mode !== p.kick.mode)
            this._switchKickMode(p, mode, input, pos, rootRotation, continuingGroundKick);
        p.kick.held = kicking;
        const armed =
            mode === 'ground' && this._armGroundToss(p, input, pos, rootRotation, strokeDue);
        this._updateLegStretch(p, dt);
        const airTarget =
            mode === 'air' && !fallen
                ? this._airFootTarget(
                      p,
                      dt,
                      continuingGroundKick,
                      input.motionPreference || 'auto',
                      input.aim,
                      muscleResponse,
                  )
                : null;
        if (airTarget) p.jump.airKickStarted = true;
        const preparing = !!airTarget && p.kick.airPlan.phase !== 'follow';
        const floppy =
            airborne &&
            vel.y < -s.drive.fallSpeed &&
            (!kicking || p.kick.airPlan?.phase === 'follow');
        const ready =
            airborne && p.jump.active && vel.y > 0 && !kicking && !fallen && !p.jump.airKickStarted;
        p.state = fallen
            ? 'recovering'
            : floppy
              ? 'falling'
              : mode === 'air'
                ? 'overhead'
                : mode === 'ground'
                  ? 'kicking'
                  : airborne
                    ? 'airborne'
                    : moving > s.drive.moveInput
                      ? 'moving'
                      : 'standing';
        const recovery = fallen ? 1 + p.effects.recovery : 1;
        let muscle =
            (floppy
                ? s.drive.muscle.falling
                : airborne
                  ? ready
                      ? s.airReady.strength
                      : s.drive.muscle.airborne
                  : fallen
                    ? s.drive.muscle.fallen
                    : 1) *
            muscleResponse *
            recovery;
        return {
            receive,
            receiving,
            motion,
            receiveBlend,
            fallen,
            airborne,
            kicking,
            armed,
            mode,
            airTarget,
            preparing,
            floppy,
            ready,
            recovery,
            muscle,
        };
    }

    /** 발차기 모드가 바뀔 때 계획을 비우고, 공(지상 토스는 예측 접촉점) 위치로 찰 발을 고른다. */
    _switchKickMode(p, mode, input, pos, rootRotation, continuingGroundKick) {
        p.kick.mode = mode;
        p.kick.receivePlan = null;
        p.kick.airPlan = null;
        if (!(mode === 'air' && continuingGroundKick))
            p.kick.side = this._kickSide(
                p,
                mode === 'ground' && !!input.tossTarget,
                pos,
                rootRotation,
            );
    }

    /** 찰 발: 공(지상 토스는 공이 접촉 높이에 올 자리)이 몸의 어느 쪽에 있는지로 고른다. */
    _kickSide(p, tossing, pos, rootRotation) {
        const s = p.settings;
        let choose = this.ball.translation();
        if (tossing) {
            const bv = this.ball.linvel(),
                height = this.settings.groundToss.contactHeight;
            const disc = bv.y * bv.y + 2 * s.gravity * (choose.y - height);
            const t = Math.max(0, (bv.y + Math.sqrt(Math.max(0, disc))) / s.gravity);
            choose = { x: choose.x + bv.x * t, y: height, z: choose.z + bv.z * t };
        }
        const ballLocal = this._rotate(this._conj(rootRotation), this._sub(choose, pos));
        return this._groundSide(ballLocal.x);
    }

    /**
     * 지상 토스(받기·세트·서브)의 발은 휘두르는 데 걸리는 시간만큼만 공 도착보다 먼저 움직이기 시작한다(_strokeDue). 그보다 일찍 누르면 그때까지
     * 차는 다리도 디딤발로 서 있고(계획 없음), 찰 발만 공이 올 자리로 다시 고른다. 쿠션·런지 받기 동작도 같은 때 시작한다(_updateReceive).
     * 그래서 일찍 누른 길이는 휘두르기를 바꾸지 않는다. 슬라이드는 누른 걸음에 몸을 던지므로 예외다. true면 아직 기다리는 중이다.
     */
    _armGroundToss(p, input, pos, rootRotation, strokeDue) {
        if (p.kick.receivePlan || !this._tossing(input)) return false;
        // 기다리는 걸음마다, 그리고 계획을 세우는 걸음에도 찰 발을 고른다. 언제 눌렀든 계획은 그 걸음의 공 궤적으로 고른 발에서 시작한다.
        p.kick.side = this._kickSide(p, true, pos, rootRotation);
        return !strokeDue();
    }

    /** 입력에 지상 토스 목표(동료·서브 목표 자리)가 있는지. 있으면 발이 휘두르기 시작까지 기다린다(_armGroundToss). */
    _tossing(input) {
        const target = input?.tossTarget;
        return !!target && Number.isFinite(target.x) && Number.isFinite(target.z);
    }

    /** 몸을 던지는 받기(런지·슬라이드)를 하고 있거나, 받기 예측이 그 동작을 고른 상태인지. 이 받기의 발은 관절 계획이 아니라 기존 발 궤적을 쓴다. */
    _bodyReceive(p, input) {
        const mode = p.receive
            ? p.receive.mode
            : input?.receive?.reachable
              ? input.receive.mode
              : 'cushion';
        return mode !== 'cushion';
    }

    /**
     * 지금 휘두르기를 시작해야 하는지. 서서 차는 지상 토스는 다리 관절 계획이 계산한 길이(_strokeLead)를 쓴다: 이번 걸음(step초)을 넘기면
     * 공 도착까지 남은 시간이 그보다 짧아질 때 참이다. 몸을 던지는 받기는 groundToss.strokeLeadMs 이하로 남았을 때다.
     * 어느 쪽이든 공 도착이 strokeLeadMs + 한 걸음보다 멀면 거짓이다(길이는 strokeLeadMs를 넘지 않는다). 잘게 도는 틱 판정(fineStepNeeded)은 이 한계를 쓴다.
     */
    _strokeDue(p, input, step) {
        const arrival = this._receiveArrival(p, this.ball.translation(), this.ball.linvel()),
            longest = this.settings.groundToss.strokeLeadMs / 1000;
        if (this._bodyReceive(p, input)) return arrival <= longest;
        return arrival < longest + step && arrival < this._strokeLead(p, input) + step;
    }

    /** 관절 목표의 기본값(팔을 조금 굽힌 선 자세). */
    _restTargets(p) {
        const targetMap = {};
        for (const j of p.joints) targetMap[j.name] = [0, 0, 0];
        targetMap.elbowL = [0.12, 0, 0];
        targetMap.elbowR = [0.12, 0, 0];
        targetMap.shoulderL = [0.02, 0, -0.08];
        targetMap.shoulderR = [0.02, 0, 0.08];
        return targetMap;
    }

    /** 접지·넘어짐·받기 중이면 몸 세우기·이동·걷는 발, 공중이면 공중 자세와 공중 조향. */
    _driveStance(p, body, intent, action, targetMap, dt) {
        const { airborne, fallen, mode, receiving } = action;
        const { moving } = intent;
        if (!airborne) p.desiredYaw = p.yaw;
        // After the attacker stops walking, brake the whole articulated body's
        // momentum before takeoff. Receivers/setters retain their planted-pass
        // controller, as do ground kicks and recovery.
        if (p.role !== TAKRAW_ROLE.attacker || airborne || fallen || mode === 'ground')
            p.locomotionActive = false;
        else if (moving > p.settings.drive.gaitInput) p.locomotionActive = true;
        if (p.grounded || fallen || receiving)
            this._driveGroundStance(p, body, intent, action, targetMap, dt);
        else this._driveAirStance(p, body, intent, action, targetMap, dt);
    }

    /** 지상 자세: 몸 세우기와 뜨는 힘 → 수평 이동 → 두 다리(차는 다리는 _driveKick이 맡는다). */
    _driveGroundStance(p, body, intent, action, targetMap, dt) {
        this._groundSupport(p, body, action, dt);
        this._groundMovement(p, body, intent, action, dt);
        this._groundLegs(p, body, intent, action, targetMap, dt);
    }

    /** 몸통을 세우고 서 있는(받기 자세면 낮춘) 높이로 뜨는 힘을 건다. */
    _groundSupport(p, body, action, dt) {
        const s = p.settings,
            stance = s.drive.stance,
            root = p.root;
        const { pos, vel, up, balanceResponse } = body;
        const { receive, motion, receiveBlend, fallen, recovery } = action;
        this._orientRoot(
            p,
            dt,
            (fallen ? stance.fallenBalance : 1) * balanceResponse * recovery,
            false,
            motion ? { angle: motion.lean * receiveBlend, direction: receive.direction } : null,
        );
        const liftHeight = motion
            ? stance.height + (motion.height - stance.height) * receiveBlend
            : fallen && up.y < stance.lowUp
              ? stance.lowHeight
              : stance.height;
        const lift = this._clamp(
            p.mass * s.gravity * stance.gravityShare +
                (liftHeight - pos.y) * stance.stiffness -
                vel.y * stance.damping,
            motion ? -p.mass * s.gravity * stance.receiveMinGravity : 0,
            p.mass * s.gravity * (fallen ? stance.fallenMaxGravity : stance.maxGravity),
        );
        root.applyImpulse({ x: 0, y: lift * dt * balanceResponse * recovery, z: 0 }, true);
    }

    /** 목표 이동 속도와 지금 속도(걷는 중이면 몸 전체 질량 중심 속도)의 차이로 수평 힘을 건다. */
    _groundMovement(p, body, intent, action, dt) {
        const s = p.settings,
            stance = s.drive.stance,
            root = p.root;
        const { pos, vel, muscleResponse } = body;
        const { move, moving } = intent;
        const { receive, fallen } = action;
        const targetV = this._mul(
            move,
            s.movementSpeed *
                (fallen
                    ? stance.fallenSpeed
                    : receive?.mode === 'slide'
                      ? s.receive.slide.speed
                      : 1),
        );
        let movementVelocity = vel;
        if (p.locomotionActive && moving <= s.drive.gaitInput) {
            movementVelocity = this._v();
            for (const part of p.parts)
                movementVelocity = this._add(
                    movementVelocity,
                    this._mul(part.body.linvel(), part.mass / p.mass),
                );
            if (Math.hypot(movementVelocity.x, movementVelocity.z) < stance.stopSpeed)
                p.locomotionActive = false;
        }
        const force = this._limit(
            {
                x: (targetV.x - movementVelocity.x) * p.mass * s.movementAcceleration,
                y: 0,
                z: (targetV.z - movementVelocity.z) * p.mass * s.movementAcceleration,
            },
            p.mass * s.movementMaxAcceleration,
        );
        root.applyImpulseAtPoint(
            this._mul(force, dt * muscleResponse),
            { x: pos.x, y: stance.pushHeight, z: pos.z },
            true,
        );
    }

    /** 걸음 위상을 진행하고 두 다리의 발 목표·관절 목표를 정한다. 차는 다리는 건너뛴다. */
    _groundLegs(p, body, intent, action, targetMap, dt) {
        const s = p.settings,
            gait = s.drive.gait;
        const { pos, rootRotation, muscleResponse } = body;
        const { move, moving } = intent;
        const { receive, motion, receiveBlend, fallen, kicking, armed } = action;
        p.gait += dt * (moving > s.drive.gaitInput ? gait.rate : 0);
        const facing = this._yaw(p.desiredYaw);
        for (const [suffix, side] of [
            ['L', -1],
            ['R', 1],
        ]) {
            if (kicking && !armed && suffix === p.kick.side && !fallen) continue;
            const phase = p.gait + (side < 0 ? 0 : Math.PI);
            const localFoot = { x: side * gait.width, y: 0, z: gait.forward };
            const spread = this._rotate(facing, localFoot);
            const planted = motion
                ? this._mul(receive.direction, -gait.plant * receiveBlend)
                : this._v();
            const target = {
                x: pos.x + spread.x + move.x * Math.sin(phase) * gait.stride + planted.x,
                y:
                    gait.footHeight +
                    (moving > s.drive.moveInput ? Math.max(0, Math.sin(phase)) * gait.lift : 0),
                z: pos.z + spread.z + move.z * Math.sin(phase) * gait.stride + planted.z,
            };
            const pose = this._legTargets(p, suffix, target, 1, pos, rootRotation);
            if (motion) this._receiveCrouch(p, suffix, motion, receiveBlend, pose);
            targetMap['hip' + suffix] = pose.hip;
            targetMap['knee' + suffix] = pose.knee;
            targetMap['ankle' + suffix] = pose.ankle;
            this._footDrive(
                p,
                p.byName['foot' + suffix],
                target,
                this._mul(move, s.movementSpeed * gait.footSpeed),
                gait.footForce * muscleResponse,
                dt,
                gait.positionGain * muscleResponse,
                gait.velocityGain * muscleResponse,
            );
        }
    }

    /** 받기 자세에서 받기 높이에 맞춰 무릎을 굽히고 엉덩이·발목을 맞춘다. */
    _receiveCrouch(p, suffix, motion, receiveBlend, pose) {
        const s = p.settings;
        const length =
            p.byName['upperLeg' + suffix].restLength + p.byName['lowerLeg' + suffix].restLength;
        const bend =
            Math.min(2.45, 2 * Math.acos(this._clamp((motion.height - 0.14) / length, 0, 1))) *
            receiveBlend;
        pose.hip[0] -= bend * 0.5;
        pose.knee[0] = Math.max(pose.knee[0], bend);
        pose.ankle[0] = -(pose.hip[0] + pose.knee[0]) * s.drive.ankleCompensation;
    }

    _driveAirStance(p, body, intent, action, targetMap, dt) {
        const s = p.settings,
            root = p.root;
        const { muscleResponse } = body;
        const { move } = intent;
        const { mode, floppy, ready } = action;
        if (!floppy) {
            if (mode !== 'air')
                this._orientRoot(
                    p,
                    dt,
                    ready ? s.airReady.bodyStrength : s.drive.airBalance,
                    !ready,
                );
        }
        if (mode === 'air') this._rotateOverhead(p, dt, muscleResponse);
        // Air steering is a bounded acceleration, never a root velocity assignment.
        const airForce = this._mul(move, p.mass * s.airControl);
        root.applyImpulse(this._mul(airForce, dt), true);
        targetMap.hipL = [0.12, 0, -0.06];
        targetMap.hipR = [0.12, 0, 0.06];
        targetMap.kneeL = [0.25, 0, 0];
        targetMap.kneeR = [0.25, 0, 0];
        targetMap.shoulderL = [-0.35, 0, -0.65];
        targetMap.shoulderR = [-0.35, 0, 0.65];
    }

    /** 받기·점프 준비·공중 발차기 준비 동안 팔·허리·반대 다리 자세를 덮어쓰고 차는 다리 평면을 맞춘다. */
    _driveActionPose(p, body, action, targetMap, dt) {
        const s = p.settings;
        const { muscleResponse } = body;
        const { motion, receiveBlend, airTarget, preparing, ready } = action;
        if (motion) {
            // Keep the hands against the torso while the foot saves a low ball.
            // Wide balancing arms otherwise cross the newly rising pass; every
            // collider remains active and these are ordinary bounded joint motors.
            targetMap.shoulderL = [-1.6 * receiveBlend, 0, 0.55 * receiveBlend];
            targetMap.shoulderR = [-1.6 * receiveBlend, 0, -0.55 * receiveBlend];
            targetMap.elbowL = [2.05 * receiveBlend, 0, 0];
            targetMap.elbowR = [2.05 * receiveBlend, 0, 0];
            targetMap.waist = [0.15 * receiveBlend, 0, 0];
        }
        if (ready) {
            // A jump can tuck both legs before the first click. These are fixed
            // body-local joint poses: no ball query, foot drive or attack direction.
            for (const [suffix, side] of [
                ['L', -1],
                ['R', 1],
            ]) {
                targetMap['hip' + suffix] = [s.airReady.hipPitch, 0, side * s.airReady.hipSpread];
                targetMap['knee' + suffix] = [s.airReady.kneeBend, 0, 0];
                targetMap['ankle' + suffix] = [
                    -(s.airReady.hipPitch + s.airReady.kneeBend) * s.drive.ankleCompensation,
                    0,
                    0,
                ];
            }
        }
        if (preparing || ready) {
            // Keep the torso on the pelvis' attack plane and tuck both hands against
            // the chest. Every arm collider remains active for real ball contacts.
            targetMap.waist = [0, 0, 0];
            targetMap.shoulderL = [-1.6, 0, 0.55];
            targetMap.shoulderR = [-1.6, 0, -0.55];
            targetMap.elbowL = [2.05, 0, 0];
            targetMap.elbowR = [2.05, 0, 0];
            if (preparing) this._orientKickPlane(p, dt, muscleResponse);
        }

        if (airTarget) {
            const pose = p.kick.airPlan.motion.pose,
                inactive = p.kick.side === 'L' ? 'R' : 'L';
            const mirror = p.kick.side === 'L' ? -1 : 1;
            // The decoded counter-leg motion is what distinguishes the scissor's
            // leg exchange from an inverted sweep or a roundhouse. Preserve its early
            // arc, then fold the free shin away from the upcoming physical contact.
            const counterLeg = this._airCounterLegPose(p, inactive, pose.freeLeg);
            for (const joint of ['hip', 'knee', 'ankle']) {
                targetMap[joint + inactive] = counterLeg[joint];
            }
            targetMap.waist = [pose.waist[0], pose.waist[1] * mirror, pose.waist[2] * mirror];
        }
    }

    /**
     * 차는 발을 목표 위치·속도로 끌고 접촉면 방향을 맞춘다. { orientedFoot, legJoints }를 돌려준다:
     * orientedFoot은 발 방향을 제어한 발('L'|'R'|''), legJoints는 관절 계획이 모터에 걸 기준(없으면 null)이다.
     */
    _driveKick(p, input, body, action, targetMap, dt) {
        const root = p.root;
        const { pos, rootRotation, muscleResponse } = body;
        const { fallen, kicking, armed, mode, airTarget } = action;
        if (!kicking || armed || fallen) return { orientedFoot: '', legJoints: null };
        const suffix = p.kick.side,
            foot = p.byName['foot' + suffix];
        const hip = this._point(root, this._hipAnchor(suffix));
        const command = this._kickCommand(p, input, mode, airTarget, hip, body, dt);
        if (command.legJoints) {
            this._driveJointKick(p, suffix, foot, hip, command, body, targetMap, dt);
            return { orientedFoot: suffix, legJoints: command.legJoints };
        }
        // The air controller already projects position and velocity together
        // into the current leg workspace. Ground reception keeps its own path.
        if (mode !== 'air') this._limitGroundKickReach(p, suffix, foot, hip, command, dt);
        const target = command.target,
            contactNormal = command.contactNormal,
            contactForward = command.contactForward,
            faceControl = command.faceControl;
        let targetVelocity = command.targetVelocity;
        const ankleDriven = mode === 'air' || !!p.kick.receivePlan;
        // Controlled contacts drive the actual ankle. Convert the planned foot
        // centre to that anchor, cancelling _legTargets' standing COM offset.
        const ikTarget = this._kickIkTarget(
            mode,
            airTarget,
            target,
            ankleDriven ? contactNormal : null,
            contactForward,
            rootRotation,
        );
        this._setKickLegPose(p, suffix, ikTarget, mode, pos, rootRotation, targetMap);
        const forcePoint = ankleDriven ? this._point(foot.body, this._v(0, 0.065, -0.085)) : null;
        const driveTarget =
            mode !== 'air' && ankleDriven
                ? this._sub(ikTarget, this._rotate(rootRotation, this._v(0, 0, 0.055)))
                : target;
        if (mode === 'ground' && ankleDriven)
            targetVelocity = this._groundStrokeVelocity(p, foot, forcePoint, targetVelocity, dt);
        // Both controls read the same solved state. A point impulse temporarily
        // changes free-body omega before the ankle joint is solved again.
        const angularVelocity = ankleDriven ? foot.body.angvel() : null;
        this._driveKickFoot(p, foot, command, {
            mode,
            airTarget,
            driveTarget,
            targetVelocity,
            forcePoint,
            hip,
            muscleResponse,
            dt,
        });
        if (contactNormal)
            this._orientFootNormal(
                p,
                suffix,
                contactNormal,
                contactForward,
                faceControl,
                dt,
                muscleResponse,
                angularVelocity,
            );
        return { orientedFoot: contactNormal ? suffix : '', legJoints: null };
    }

    /**
     * 관절 계획 지상 토스의 구동. 엉덩이·무릎 모터가 계획의 관절 기준을 따라가고(_applyJointTargets), 모터가 못 내는 몫과 발목 위치·속도 오차는
     * 발-골반 힘이 맡는다. 발목 목표는 그 관절 기준의 순기구학이라 모터와 발-골반 힘이 같은 궤적을 따른다. 발목 관절은 발 방향 제어가 맡는다.
     */
    _driveJointKick(p, suffix, foot, hip, command, body, targetMap, dt) {
        const s = p.settings,
            toss = this.settings.groundToss;
        const { muscleResponse } = body;
        const { position } = command.legJoints;
        targetMap['hip' + suffix] = [position[0], 0, position[1]];
        targetMap['knee' + suffix] = [position[2], 0, 0];
        const forcePoint = this._point(foot.body, this._v(0, 0.065, -0.085)),
            angularVelocity = foot.body.angvel();
        this._footDrive(
            p,
            foot,
            command.target,
            command.targetVelocity,
            s.groundKickForce * muscleResponse,
            dt,
            toss.positionGain * muscleResponse,
            2 * Math.sqrt(toss.positionGain * toss.accelerationMass) * muscleResponse,
            forcePoint,
            command.footForce,
            null,
            { reference: p.root.velocityAtPoint(hip), maxSpeed: toss.maxFootSpeed },
        );
        this._orientFootNormal(
            p,
            suffix,
            command.contactNormal,
            command.contactForward,
            command.faceControl,
            dt,
            muscleResponse,
            angularVelocity,
        );
    }

    /** 골반 좌표의 엉덩이 관절 자리. */
    _hipAnchor(suffix) {
        return { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 };
    }

    /** 차는 발의 IK 목표(발목 기준점). 공중은 공중 계획 발목, 지상 접촉은 발 중심에서 발목으로 옮긴 점, 그 밖은 목표 그대로다. */
    _kickIkTarget(mode, airTarget, target, contactNormal, contactForward, rootRotation) {
        return mode === 'air'
            ? this._add(airTarget.ankle, this._rotate(rootRotation, this._v(0, 0, 0.055)))
            : contactNormal
              ? this._add(
                    this._add(target, this._mul(contactNormal, 0.065)),
                    this._add(
                        this._mul(contactForward, -0.085),
                        this._rotate(rootRotation, this._v(0, 0, 0.055)),
                    ),
                )
              : target;
    }

    /** 차는 다리의 엉덩이·무릎·발목 목표. 공중은 들어 올리는 동안 동작 클립 무릎과 기하 무릎을 섞는다. */
    _setKickLegPose(p, suffix, ikTarget, mode, pos, rootRotation, targetMap) {
        const s = p.settings;
        const pose = this._legTargets(p, suffix, ikTarget, 1, pos, rootRotation);
        targetMap['hip' + suffix] = pose.hip;
        targetMap['knee' + suffix] = pose.knee;
        if (mode === 'air') {
            const motion = p.kick.airPlan.motion;
            const geometryWeight =
                p.kick.airPlan.phase === 'lift' ? s.airKick.motion.liftGeometryWeight : 1;
            targetMap['knee' + suffix] = [
                this._clamp(
                    motion.pose.activeKnee[0] * (1 - geometryWeight) +
                        pose.knee[0] * geometryWeight,
                    0,
                    2.45,
                ),
                0,
                0,
            ];
        }
        targetMap['ankle' + suffix] = pose.ankle;
    }

    /** 지상 토스 마무리 구간: 발등과 힘점의 회전 속도 차이를 목표 속도에서 뺀다(구간 끝으로 갈수록 크게). */
    _groundStrokeVelocity(p, foot, forcePoint, targetVelocity, dt) {
        const plan = p.kick.receivePlan,
            toss = this.settings.groundToss;
        const terminal = this._clamp(
            (this.time - plan.startedAt + dt - plan.duration + toss.strokeTime) / toss.strokeTime,
            0,
            1,
        );
        const instep = this._point(foot.body, this._v(0, 0.055, toss.forefoot));
        const rotationVelocity = this._sub(
            foot.body.velocityAtPoint(instep),
            foot.body.velocityAtPoint(forcePoint),
        );
        return this._sub(targetVelocity, this._mul(rotationVelocity, terminal));
    }

    /** 차는 발에 힘을 건다. 공중·지상과 발 제어 설정(footControl)에 따라 힘·위치·속도 이득과 가속 보상이 달라진다. */
    _driveKickFoot(
        p,
        foot,
        command,
        { mode, airTarget, driveTarget, targetVelocity, forcePoint, hip, muscleResponse, dt },
    ) {
        const s = p.settings;
        const { groundAcceleration, groundContactDrive, footControl } = command;
        const groundToss = footControl === this.settings.groundToss;
        this._footDrive(
            p,
            foot,
            driveTarget,
            targetVelocity,
            (mode === 'air' ? s.airKick.force : s.groundKickForce) * muscleResponse,
            dt,
            (footControl ? footControl.positionGain : s.footPositionGain) * muscleResponse,
            (groundToss
                ? 2 * Math.sqrt(footControl.positionGain * footControl.accelerationMass)
                : footControl
                  ? footControl.velocityGain
                  : s.footVelocityGain) * muscleResponse,
            forcePoint,
            mode === 'air' && airTarget.acceleration
                ? this._mul(
                      this._add(airTarget.acceleration, this._v(0, s.gravity, 0)),
                      s.airKick.trackingMass * muscleResponse,
                  )
                : groundAcceleration
                  ? this._mul(
                        this._add(groundAcceleration, this._v(0, s.gravity, 0)),
                        this.settings.groundToss.accelerationMass * muscleResponse,
                    )
                  : null,
            groundContactDrive,
            // 지상 토스(서브·받기·토스·세트) 발만 다리의 힘-속도 한계를 받는다. 공중 차기(airKick 제어)는 그대로다.
            groundToss
                ? {
                      reference: p.root.velocityAtPoint(hip),
                      maxSpeed: this.settings.groundToss.maxFootSpeed,
                  }
                : null,
        );
    }

    /** 차는 발의 목표: 공중은 공중 발 계획, 지상 토스는 받기 계획, 그 밖의 지상 발차기는 공을 위로 차 올리는 방향. */
    _kickCommand(p, input, mode, airTarget, hip, body, dt) {
        const s = p.settings;
        const ballPos = this.ball.translation(),
            ballVel = this.ball.linvel();
        const lead = s.drive.groundKick.lead;
        const predicted = this._add(ballPos, this._mul(ballVel, lead));
        predicted.y -= 0.5 * s.gravity * lead * lead;
        let target,
            targetVelocity,
            groundAcceleration = null,
            contactNormal = null,
            contactForward = null,
            groundContactDrive = null,
            legJoints = null,
            footForce = null;
        let footControl = null,
            faceControl = null;
        if (mode === 'air') {
            target = airTarget.target;
            targetVelocity = airTarget.velocity;
            contactNormal = airTarget.normal;
            contactForward = airTarget.forward;
            footControl = s.airKick;
            faceControl = s.airKick;
        } else {
            const teammate = input.tossTarget;
            const tossing = teammate && Number.isFinite(teammate.x) && Number.isFinite(teammate.z);
            if (tossing) {
                const receive = this._receiveFootTarget(p, input, ballPos, ballVel, body, dt);
                target = receive.target;
                targetVelocity = receive.velocity;
                groundAcceleration = receive.acceleration;
                groundContactDrive = receive.contactDrive || null;
                legJoints = receive.joints || null;
                footForce = receive.force || null;
                contactNormal = receive.normal;
                contactForward = p.kick.receivePlan.forward;
                footControl = this.settings.groundToss;
                faceControl = this.settings.groundToss;
            } else {
                const horizontal = this._unit(
                    { x: predicted.x - hip.x, y: 0, z: predicted.z - hip.z },
                    { x: p.toward, y: 0, z: 0 },
                );
                const kickDirection = this._unit({
                    x: horizontal.x * s.drive.groundKick.horizontal,
                    y: 1,
                    z: horizontal.z * s.drive.groundKick.horizontal,
                });
                // 엉덩이에서 공 쪽으로 차 올리는 방향이 발이 공으로 향하는 방향이다. 발은 그 방향 그대로 가상 중심(접촉점을 지나는 선)을
                // 지나가고, 발 면은 조준이 정한 접촉면으로 돌린다(지상 토스와 같은 발 방향 제어).
                const { normal, surface } = this.aimedContact(
                    p,
                    predicted,
                    kickDirection,
                    input.aim,
                );
                const virtualCenter = this._add(
                    surface,
                    this._mul(
                        kickDirection,
                        this._dot(this._sub(predicted, surface), kickDirection),
                    ),
                );
                target = this._add(
                    virtualCenter,
                    this._mul(kickDirection, -s.drive.groundKick.behind),
                );
                targetVelocity = this._mul(kickDirection, s.groundKickSpeed);
                contactNormal = normal;
                contactForward = this._unit(
                    this._sub(horizontal, this._mul(normal, this._dot(horizontal, normal))),
                    this._v(0, 1, 0),
                );
                faceControl = this.settings.groundToss;
            }
        }
        return {
            target,
            targetVelocity,
            groundAcceleration,
            contactNormal,
            contactForward,
            groundContactDrive,
            footControl,
            faceControl,
            legJoints,
            footForce,
        };
    }

    /** 지상 발 목표를 지금 다리가 닿는 범위 안으로 옮기고, 다음 물리 걸음에 범위를 벗어날 속도는 범위 끝으로 줄인다. */
    _limitGroundKickReach(p, suffix, foot, hip, command, dt) {
        const root = p.root;
        const contactNormal = command.contactNormal,
            contactForward = command.contactForward;
        let target = command.target,
            targetVelocity = command.targetVelocity;
        if (p.kick.receivePlan && contactNormal) {
            const offset = this._add(
                this._mul(contactNormal, 0.065),
                this._mul(contactForward, -0.085),
            );
            const ankle = this._add(target, offset),
                relative = this._sub(ankle, hip);
            const reach = this._legReach(p, suffix),
                minimum = this._legMinReach(p, suffix);
            const direction = this._unit(relative),
                distance = this._length(relative);
            target = this._sub(
                this._add(hip, this._mul(direction, this._clamp(distance, minimum, reach))),
                offset,
            );
            const current = this._sub(this._point(foot.body, this._v(0, 0.065, -0.085)), hip);
            const hipVelocity = root.velocityAtPoint(hip);
            const next = this._add(current, this._mul(this._sub(targetVelocity, hipVelocity), dt)),
                nextDistance = this._length(next);
            if (nextDistance > reach || nextDistance < minimum) {
                targetVelocity = this._add(
                    hipVelocity,
                    this._mul(
                        this._sub(
                            this._mul(
                                this._unit(next, direction),
                                this._clamp(nextDistance, minimum, reach),
                            ),
                            current,
                        ),
                        1 / dt,
                    ),
                );
            }
        } else {
            const delta = this._limit(this._sub(target, hip), p.settings.drive.groundKick.reach);
            target = this._add(hip, delta);
        }
        command.target = target;
        command.targetVelocity = targetVelocity;
    }

    /**
     * 관절 모터에 목표를 건다. 발 방향 제어가 맡은 발목과, 발 궤적 힘이 엉덩이 방향을 맡는 차기의 엉덩이는 모터 힘을 0으로 둔다.
     * 관절 계획(legJoints)이 있는 차기는 엉덩이·무릎 모터가 그 기준 각·각속도·토크를 따라간다.
     */
    _applyJointTargets(p, body, action, targetMap, { orientedFoot, legJoints }) {
        const s = p.settings;
        const { muscleResponse } = body;
        const { fallen, kicking, armed, mode, preparing, muscle } = action;
        for (const j of p.joints) {
            let strength = muscle;
            if (
                preparing &&
                (j.name === 'waist' ||
                    j.name.startsWith('shoulder') ||
                    j.name.startsWith('elbow') ||
                    j.name.startsWith('wrist'))
            )
                strength = s.airKick.preparationStrength * muscleResponse;
            if (
                preparing &&
                ['hip', 'knee', 'ankle'].some(
                    (name) => j.name === name + (p.kick.side === 'L' ? 'R' : 'L'),
                )
            )
                strength = s.airKick.motion.poseStrength * muscleResponse;
            if (
                kicking &&
                !armed &&
                !fallen &&
                (j.name === 'hip' + p.kick.side ||
                    j.name === 'knee' + p.kick.side ||
                    j.name === 'ankle' + p.kick.side)
            )
                strength =
                    (mode === 'air'
                        ? s.drive.kickLegStrength.air
                        : s.drive.kickLegStrength.ground) * muscleResponse;
            if (legJoints && j.name === 'hip' + orientedFoot) {
                const { velocity, torque } = legJoints;
                this._motor(j, targetMap[j.name], strength, {
                    velocity: [velocity[0], 0, velocity[1]],
                    torque: [torque[0], 0, torque[1]],
                });
                continue;
            }
            if (legJoints && j.name === 'knee' + orientedFoot) {
                const { velocity, torque } = legJoints;
                this._motor(j, targetMap[j.name], strength, {
                    velocity: [velocity[2]],
                    torque: [torque[2]],
                });
                continue;
            }
            if (
                orientedFoot &&
                (j.name === 'ankle' + orientedFoot ||
                    ((mode === 'air' || p.kick.receivePlan) && j.name === 'hip' + orientedFoot))
            ) {
                // Foot orientation owns the ankle. Every controlled contact lets its
                // force trajectory own hip direction, without a second
                // absolute-angle motor pulling the foot through the contact point.
                for (const axis of [
                    this.R.JointAxis.AngX,
                    this.R.JointAxis.AngY,
                    this.R.JointAxis.AngZ,
                ])
                    j.joint.setMotorMaxForce(axis, 0);
                continue;
            }
            this._motor(j, targetMap[j.name], strength);
        }
    }

    /**
     * 공중 차기의 몸 회전: 골반·몸통에 축 둘레 외부 토크를 건다(반작용 없음). 계획이 세운 몸 회전 기준 궤적(plan.body)을 따라간다.
     * - 앞먹임은 기준 궤적에서만 낸다: 기준 상태를 걸음 끝 시각까지 나아가고(bodyTurnAdvance) 관성 × 기준 각가속도를 토크로 더한다.
     * - 되먹임은 지금 설정 그대로다: 기준 각속도 + rootGain × (기준 각 − 잰 각)을 각속도 상한으로 자른 목표 각속도를 damping으로 따라간다.
     *   잰 값(골반이 돈 각, 부위의 각속도)은 되먹임에만 쓴다.
     * - 접촉 시각 뒤 strokeTime까지는 접촉 각속도를 그대로 따라가고, 그 뒤와 맞힌 뒤(follow)에는 지지를 대부분 푼다.
     */
    _rotateOverhead(p, dt, response) {
        const plan = p.kick.airPlan,
            rotation = plan.rotation,
            kick = this.settings.airKick,
            s = kick.rotation;
        const motion = plan.motion,
            settings = kick.motion,
            turn = plan.body,
            root = p.root;
        // Accumulate the actual quaternion increment so a 540-degree reference
        // does not wrap into the shortest 180-degree turn. No render pose is read.
        let delta = this._qmul(root.rotation(), this._conj(rotation.previous));
        if (delta.w < 0) delta = { x: -delta.x, y: -delta.y, z: -delta.z, w: -delta.w };
        const sine = Math.hypot(delta.x, delta.y, delta.z);
        const increment = this._mul(
            delta,
            sine > 1e-7 ? (2 * Math.atan2(sine, delta.w)) / sine : 2,
        );
        rotation.angle += this._dot(increment, rotation.axis);
        rotation.previous = { ...root.rotation() };
        const axis = rotation.axis;
        bodyTurnAdvance(turn, this.time + dt);
        rotation.target = turn.angle;
        const limits = this._airTurnLimits(response);
        const speed = this._clamp(
            turn.rate + settings.rootGain * (rotation.target - rotation.angle),
            -limits.rate,
            limits.rate,
        );
        const desired = this._qmul(
            { ...this._mul(axis, Math.sin(rotation.target / 2)), w: Math.cos(rotation.target / 2) },
            rotation.start,
        );
        const bodies = [
            { body: root, weight: 0.45 },
            { body: p.byName.torso.body, weight: 0.55 },
        ];
        // The physical hit releases most of the pose support. The ragdoll keeps
        // its momentum on descent; an animation cannot pull it through a landing.
        // 맞히지 못해도 계획 접촉 시각에서 strokeTime이 지나면 같이 푼다.
        const released =
            plan.phase === 'follow' || this.time + dt > turn.end.at + kick.contact.strokeTime;
        const support = released ? 0.15 : this._airTurnSupport(motion.age);
        // 두 부위에 거는 토크는 아래에서 response × support배가 된다. 기준 궤적의 토크(관성 × 각가속도)가 그대로 걸리게 그만큼 나눠 둔다:
        // 계획이 본 토크 상한(_airTurnLimits)이 s.torque × response × support라, 한계 안의 기준이면 이 값은 s.torque를 넘지 않는다.
        const drive = response * support;
        const feedforward = released || drive <= 0 ? 0 : (turn.inertia * turn.acceleration) / drive;
        // 축이 몸의 주축이 아니면 그 축 둘레로만 도는 데에도 축 밖 토크가 든다(없으면 몸이 계획 축에서 기운다). 도는 몸의 관성에서
        // 계산해 같이 앞먹인다: 각가속도 × 관성곱 + 각속도² × (축 × 관성곱). 값은 축 앞먹임과 같이 기준 궤적의 각속도·각가속도다.
        let tilt = this._v();
        if (!released && drive > 0) {
            const { product } = this._turnState(p, p.kick.side, axis);
            tilt = this._mul(
                this._add(
                    this._mul(product, turn.acceleration),
                    this._mul(this._cross(axis, product), turn.rate * turn.rate),
                ),
                1 / drive,
            );
        }
        for (const { body, weight } of bodies) {
            let error = this._qmul(desired, this._conj(body.rotation()));
            if (error.w < 0) error = { x: -error.x, y: -error.y, z: -error.z, w: -error.w };
            const length = Math.hypot(error.x, error.y, error.z);
            const e = this._mul(
                error,
                length > 1e-7 ? (2 * Math.atan2(length, error.w)) / length : 2,
            );
            const omega = body.angvel(),
                spin = this._dot(omega, axis);
            const plane = this._sub(e, this._mul(axis, this._dot(e, axis)));
            const offAxis = this._sub(omega, this._mul(axis, spin));
            const torque = this._limit(
                this._add(
                    this._add(this._mul(axis, feedforward + (speed - spin) * s.damping), tilt),
                    this._sub(
                        this._mul(plane, s.planeStiffness),
                        this._mul(offAxis, s.planeDamping),
                    ),
                ),
                s.torque,
            );
            body.applyTorqueImpulse(this._mul(torque, dt * weight * drive), true);
        }
    }

    /** 몸 회전 지지가 계획 시작 뒤 age초에 오른 비율(0~1). 구동(_rotateOverhead)과 계획의 토크 상한(_airTurnLimits)이 같이 읽는다. */
    _airTurnSupport(age) {
        return Math.min(1, age / this.settings.airKick.motion.transition);
    }

    /**
     * 몸 회전 구동의 한계: 목표 각속도 상한(rad/s)과, 계획 시작 뒤 time초에 실제로 걸리는 토크 상한(N·m)을 내는 함수.
     * _rotateOverhead가 거는 값과 같은 식이다(계획 전용 값 없음).
     */
    _airTurnLimits(response) {
        const kick = this.settings.airKick;
        return {
            rate: kick.rotation.speed * kick.motion.angularSpeed,
            torque: (time) => kick.rotation.torque * response * this._airTurnSupport(time),
        };
    }

    /**
     * 차는 다리(suffix)를 뺀 몸이 질량 중심을 지나는 축(axis, 단위 벡터) 둘레로 도는 상태: 관성(kg·m²)과 각속도(각운동량 ÷ 관성, rad/s).
     * 몸 회전 토크가 돌리는 것이 이 몸이다. 차는 다리는 발-골반 힘이 세계 좌표의 발목 목표로 끌고 가므로 몸과 같이 돌지 않는다.
     * product는 관성 텐서 × axis에서 축 성분(inertia)을 뺀 나머지(관성곱 벡터, kg·m²)다. axis가 주축이면 0이다.
     */
    _turnState(p, suffix, axis) {
        const parts = p.parts.filter(
            (part) => !(/^(upperLeg|lowerLeg|foot)/.test(part.name) && part.name.endsWith(suffix)),
        );
        let mass = 0,
            center = this._v(),
            velocity = this._v();
        for (const part of parts) {
            mass += part.mass;
            center = this._add(center, this._mul(part.body.worldCom(), part.mass));
            velocity = this._add(velocity, this._mul(part.body.linvel(), part.mass));
        }
        center = this._mul(center, 1 / mass);
        velocity = this._mul(velocity, 1 / mass);
        let inertia = 0,
            momentum = 0,
            // 관성 텐서 × axis.
            column = this._v();
        for (const part of parts) {
            const body = part.body,
                arm = this._sub(body.worldCom(), center),
                lever = this._cross(axis, arm);
            inertia += part.mass * this._dot(lever, lever);
            column = this._add(column, this._mul(this._cross(arm, lever), part.mass));
            momentum +=
                part.mass * this._dot(axis, this._cross(arm, this._sub(body.linvel(), velocity)));
            // 부위 자신의 관성: 주축(세계 좌표)마다 주관성 × (주축·축)².
            const frame = this._qmul(body.rotation(), body.principalInertiaLocalFrame()),
                principal = body.principalInertia(),
                spin = body.angvel();
            for (const key of ['x', 'y', 'z']) {
                const direction = this._rotate(frame, { x: 0, y: 0, z: 0, [key]: 1 }),
                    along = this._dot(direction, axis);
                inertia += principal[key] * along * along;
                column = this._add(column, this._mul(direction, principal[key] * along));
                momentum += principal[key] * along * this._dot(direction, spin);
            }
        }
        const product = this._sub(column, this._mul(axis, inertia));
        return { inertia, product, rate: momentum / inertia };
    }

    /**
     * 몸 회전 기준 궤적(plan.body)을 세운다: 지금 몸이 도는 상태에서 접촉 시각(duration초 뒤)의 끝 상태로 가는 곡선.
     * 원하는 끝 상태는 동작 클립에서 읽는다: 접촉 각은 클립의 접촉 위상 각, 접촉 각속도의 상한은 클립이 접촉 뒤에 도는 평균 각속도(남은 각 ÷ 남은 시간)다.
     * 한계 안에서 낼 수 있는 끝 상태는 bodyTurnPlan이 고른다. 기준 상태는 유한한 수만 담아 스냅샷에 그대로 실린다.
     */
    _airBodyTurn(p, pose, axis, duration, response) {
        const state = this._turnState(p, p.kick.side, axis);
        const limit = { ...this._airTurnLimits(response), inertia: state.inertia };
        const contactAngle = Math.max(
            pose.body.angle,
            this.motionMatcher.sample(pose.id, pose.contactPhase).body.angle,
        );
        const end = bodyTurnPlan(
            { angle: pose.body.angle, rate: state.rate },
            {
                angle: contactAngle,
                rate: Math.min(
                    limit.rate,
                    (pose.body.totalAngle - contactAngle) /
                        ((1 - pose.contactPhase) * pose.duration),
                ),
            },
            duration,
            limit,
            this.settings.legPlan,
        );
        return {
            angle: pose.body.angle,
            rate: state.rate,
            acceleration: 0,
            at: this.time,
            end: { angle: end.angle, rate: end.rate, at: this.time + duration },
            top: pose.body.totalAngle,
            inertia: state.inertia,
        };
    }

    _orientKickPlane(p, dt, response) {
        const s = this.settings.airKick,
            suffix = p.kick.side;
        const upper = p.byName['upperLeg' + suffix].body;
        const foot = p.byName['foot' + suffix].body;
        const hip = this._point(p.root, { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
        const chord = this._unit(this._sub(this._point(foot, this._v(0, 0.065, -0.085)), hip));
        const hinge = this._rotate(upper.rotation(), this._v(1, 0, 0));
        const a = this._sub(hinge, this._mul(chord, this._dot(hinge, chord)));
        if (this._length(a) < 0.05) return;
        const current = this._unit(a);
        const towardBall = this._sub(p.kick.airPlan.contact.impact, hip);
        const perpendicular = this._sub(towardBall, this._mul(chord, this._dot(towardBall, chord)));
        // With fixed hip/ankle and positive knee bend, the knee's pole is
        // chord x hinge. Put that pole opposite the ball's perpendicular offset.
        // Both knees use the same local +X hinge, so no left/right sign is needed.
        let wanted = current;
        if (this._length(perpendicular) > 0.05 * this._length(towardBall)) {
            const away = this._mul(this._unit(perpendicular), -1);
            wanted = this._unit(
                {
                    x: away.y * chord.z - away.z * chord.y,
                    y: away.z * chord.x - away.x * chord.z,
                    z: away.x * chord.y - away.y * chord.x,
                },
                current,
            );
        }
        // Close to collinearity every pole has the same clearance. Keep the
        // current plane and damp its spin instead of amplifying a tiny offset.
        const cross = {
            x: current.y * wanted.z - current.z * wanted.y,
            y: current.z * wanted.x - current.x * wanted.z,
            z: current.x * wanted.y - current.y * wanted.x,
        };
        const angle = Math.atan2(this._dot(chord, cross), this._dot(current, wanted));
        const speed = this._dot(this._sub(upper.angvel(), p.root.angvel()), chord);
        const gains = this._stablePdGains(
            s.kneePlaneStiffness,
            s.kneePlaneDamping,
            s.kneePlaneInertia,
            dt,
            1,
        );
        const torque =
            this._clamp(
                gains.position * angle + gains.velocity * speed,
                -s.kneePlaneMaxTorque,
                s.kneePlaneMaxTorque,
            ) * response;
        // Only twist around the actual leg chord. The foot force still exclusively
        // controls hip direction, without a second position motor fighting it.
        const impulse = this._mul(chord, torque * dt);
        upper.applyTorqueImpulse(impulse, true);
        p.root.applyTorqueImpulse(this._mul(impulse, -1), true);
    }

    /**
     * 회전 PD(발 방향·무릎 평면)의 한 걸음 이득. 토크 = position × 각도 오차 + velocity × 각속도.
     * v0.19.12의 안정 PD 식 r(kp e - kd w) / (1 + kd dt / I + kp dt^2 / I)를 실제 걸음 dt로 쓴다. 이 식은 PD를 걸음 끝 상태로 푼(암시적) 형태라
     * 걸음 길이와 상관없이 발산하지 않고, 걸음이 짧아지면 연속 PD로 수렴한다. 60틱 × 물리 걸음 2이면 v0.19.12와 같은 값이다.
     * (0fc9b71은 칸 n개 응답과 고유값을 맞춘 이득을 썼으나, 관성 I가 실제 발·정강이 결합 관성과 달라 25 ms에서 발 방향이 걸음마다 흔들렸다:
     *  받기 직전 발 각속도 12~23 rad/s, 60틱은 1~3 rad/s. 같은 상태에서 이 식으로 바꾸면 1~4 rad/s로 돌아온다.)
     */
    _stablePdGains(stiffness, damping, inertia, dt, response) {
        const stable = 1 + (damping * dt) / inertia + (stiffness * dt * dt) / inertia;
        return {
            position: (stiffness * response) / stable,
            velocity: (-damping * response) / stable,
        };
    }

    _orientFootNormal(p, suffix, normal, forward, s, dt, response, angularVelocity) {
        const body = p.byName['foot' + suffix].body;
        const parent = p.byName['lowerLeg' + suffix].body;
        const rotation = body.rotation();
        const up = this._rotate(rotation, this._v(0, 1, 0));
        const cross = (a, b) => ({
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x,
        });
        const right = cross(normal, forward);
        const currentForward = this._rotate(rotation, this._v(0, 0, 1));
        const currentRight = this._rotate(rotation, this._v(1, 0, 0));
        let error = this._mul(
            this._add(
                this._add(cross(up, normal), cross(currentForward, forward)),
                cross(currentRight, right),
            ),
            0.5,
        );
        if (s === this.settings.airKick) {
            // A quaternion error also has a direction at a 180-degree foot turn.
            // The cross-axis form above is retained verbatim for ground receptions.
            const m00 = right.x,
                m01 = normal.x,
                m02 = forward.x;
            const m10 = right.y,
                m11 = normal.y,
                m12 = forward.y;
            const m20 = right.z,
                m21 = normal.z,
                m22 = forward.z;
            const trace = m00 + m11 + m22;
            let q;
            if (trace > 0) {
                const t = Math.sqrt(trace + 1) * 2;
                q = { w: t / 4, x: (m21 - m12) / t, y: (m02 - m20) / t, z: (m10 - m01) / t };
            } else if (m00 > m11 && m00 > m22) {
                const t = Math.sqrt(1 + m00 - m11 - m22) * 2;
                q = { w: (m21 - m12) / t, x: t / 4, y: (m01 + m10) / t, z: (m02 + m20) / t };
            } else if (m11 > m22) {
                const t = Math.sqrt(1 + m11 - m00 - m22) * 2;
                q = { w: (m02 - m20) / t, x: (m01 + m10) / t, y: t / 4, z: (m12 + m21) / t };
            } else {
                const t = Math.sqrt(1 + m22 - m00 - m11) * 2;
                q = { w: (m10 - m01) / t, x: (m02 + m20) / t, y: (m12 + m21) / t, z: t / 4 };
            }
            let e = this._qmul(q, this._conj(rotation));
            if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w };
            const sine = Math.hypot(e.x, e.y, e.z);
            error = this._mul(
                e,
                sine > 1e-7 ? (2 * Math.atan2(sine, this._clamp(e.w, -1, 1))) / sine : 2,
            );
        }
        const omega = angularVelocity || body.angvel();
        const gains = this._stablePdGains(
            s.orientationStiffness,
            s.orientationDamping,
            s.orientationInertia,
            dt,
            response,
        );
        // Translation acts at the ankle joint, so there is no COM-force moment
        // to compensate. Orientation retains equal/opposite finite torques.
        const torque = this._limit(
            this._add(this._mul(error, gains.position), this._mul(omega, gains.velocity)),
            s.maxTorque * response,
        );
        body.applyTorqueImpulse(this._mul(torque, dt), true);
        parent.applyTorqueImpulse(this._mul(torque, -dt), true);
    }

    _pendingJumpHold(p) {
        return p.jump.active && p.jump.held && this._bodyVelocity(p).y > 0
            ? Math.max(
                  0,
                  this.settings.jumpHoldTime - p.jump.time - this.world.integrationParameters.dt,
              )
            : 0;
    }

    /**
     * 발 조준(사람·AI 공통, 공중·지상 토스·지상 발차기 모든 경로). direction은 발이 공으로 향하는 방향(단위 벡터)이고,
     * 조준 0은 그 방향 그대로 공 중심을 맞힌다. 조준(aim, -1..1)은 발에서 본 공의 면 위의 점이다: 가로 +는 direction × 위(발 기준 오른쪽),
     * 세로 +는 그 둘에 수직인 위쪽. 발은 direction 그대로, 공 중심을 그만큼(공 반지름 × kickAim.maxOffset 비율) 옮긴 가상 중심을
     * 향해 가므로 실제 공에는 그 선이 처음 닿는 면이 닿는다. 그 점에서 발 면이 공을 미는 방향(normal)은 √(1−|k|²)·direction − k이고,
     * surface는 그 접촉점이다. 공이 나가는 방향은 방향·각도로 환산하지 않고 이 면과 접촉 물리가 정한다.
     */
    aimedContact(p, impact, direction, aim) {
        const s = this.settings,
            reach = s.kickAim.maxOffset;
        const right = this._unit(this._cross(direction, this._v(0, 1, 0)), this._v(0, 0, p.toward));
        const up = this._cross(right, direction);
        const offset = this._limit(
            this._add(this._mul(right, aim.x * reach), this._mul(up, aim.y * reach)),
            reach,
        );
        const normal = this._sub(
            this._mul(direction, Math.sqrt(1 - this._dot(offset, offset))),
            offset,
        );
        return { normal, surface: this._sub(impact, this._mul(normal, s.ballRadius)) };
    }

    _airContact(p, ballPos, ballVel, lead, aim) {
        const s = this.settings,
            kick = s.airKick;
        const incoming = { x: ballVel.x, y: ballVel.y - s.gravity * lead, z: ballVel.z };
        const impact = this._add(ballPos, this._mul(ballVel, lead));
        impact.y -= 0.5 * s.gravity * lead * lead;
        const shot = kick.contact;
        // 발이 공으로 향하는 수평 방향은 이 발차기의 공격 평면 축이다(계획이 있으면 그 축, 처음이면 몸에서 공 쪽).
        // 코트 정면으로 되돌리지 않는다. 서는 자리가 공에 대한 발의 방향을 정한다.
        const heading = p.kick.airPlan?.axis || this._airPlanAxis(p, { impact });
        // A falling set needs a downward change in velocity for an instep-leading
        // smash. The net clearance constraint below limits how steep it can be.
        const down = Math.max(kick.speed * kick.downward, -incoming.y + shot.downwardGain);
        // 그 방향으로 네트까지 가는 거리. 축은 옆으로 lateral.max까지만 기울어 앞 성분이 0이 되지 않는다.
        const distance = Math.max(0, -impact.x * p.toward) / (heading.x * p.toward);
        const clearance = this.config.court.netHeight + s.ballRadius + shot.netClearance;
        // Solve the time available before this downward shot falls to net height.
        // Only the foot's target face/speed changes: the ball remains solver-owned.
        const drop = Math.max(0, impact.y - clearance);
        const crossingTime = (Math.sqrt(down * down + 2 * s.gravity * drop) - down) / s.gravity;
        const forwardSpeed = this._clamp(
            distance / Math.max(0.01, crossingTime),
            kick.speed,
            shot.maxSpeed,
        );
        const flight = Math.max(0.02, distance / forwardSpeed);
        const verticalSpeed = Math.max(
            -down,
            (clearance - impact.y) / flight + 0.5 * s.gravity * flight,
        );
        // 가운데를 맞혔을 때 공이 이 평면에서 네트를 넘어 내리꽂히는 속도(swing)로 바뀌는 속도 변화가, 발이 공으로 향하는
        // 방향(approach)과 휘두르는 세기다. 평면이 코트 정면이 아니면 공도 그 평면을 따라 나간다.
        const swing = {
            x: heading.x * forwardSpeed,
            y: Math.min(kick.speed, verticalSpeed),
            z: heading.z * forwardSpeed,
        };
        const delta = this._sub(swing, incoming);
        const approach = this._unit(
            delta,
            this._unit(this._v(heading.x, -kick.downward, heading.z)),
        );
        const transfer = kick.effectiveFootMass / (kick.effectiveFootMass + s.ballMass);
        // 타격 능력치(effects.power)는 접촉 순간의 발 속도 목표에 곱한다. 곱하는 자리는 여기 하나이고, 접근 속도(closingSpeed)·스트로크 길이·
        // 스트로크 시작점·따라 차기 속도는 모두 이 velocity에서 나온다. 다리 길이와 발 힘 상한은 그대로라 못 내는 만큼은 못 낸다.
        const strikeSpeed =
            (this._length(delta) / ((1 + s.ballRestitution) * transfer)) * (1 + p.effects.power);
        const { normal, surface } = this.aimedContact(p, impact, approach, aim);
        // 발은 조준과 상관없이 approach 방향 그대로 공으로 간다. 조준은 닿는 면(normal·surface)만 바꾼다.
        const velocity = this._add(incoming, this._mul(approach, strikeSpeed));
        // Choose the in-plane toe direction towards the contact from the hip.
        // This keeps the ankle/shin behind the actual instep. A fixed world-down
        // toe direction can put the shin directly in front of a descending ball.
        const hip = this._point(p.root, this._v(p.kick.side === 'L' ? -0.12 : 0.12, -0.06, 0));
        const predictedHip = this._add(hip, this._mul(this._bodyVelocity(p), lead));
        predictedHip.y -= 0.5 * s.gravity * lead * lead;
        const heldTime = Math.min(lead, this._pendingJumpHold(p));
        predictedHip.y += s.jumpHoldAcceleration * heldTime * (lead - 0.5 * heldTime);
        const limb = this._sub(impact, predictedHip);
        const previous = p.kick.airPlan?.contact?.forward;
        const preferred = previous;
        const tangent = this._sub(limb, this._mul(normal, this._dot(limb, normal)));
        const fallback = this._unit(
            this._sub(
                preferred || this._v(0, 1, 0),
                this._mul(normal, this._dot(preferred || this._v(0, 1, 0), normal)),
            ),
            this._v(0, 0, 1),
        );
        let forward = this._length(tangent) < 0.1 ? fallback : this._unit(tangent);
        // Crossing hip height must not suddenly reverse the toes by 180 degrees.
        // Keep the chosen instep hemisphere throughout this physical swing.
        if (previous && this._dot(forward, previous) < 0) forward = this._mul(forward, -1);
        return { impact, surface, velocity, normal, approach, forward };
    }

    /** 지상 발 선택: 공의 몸 기준 옆 위치(localX, 오른쪽 +)가 주발 반대쪽으로 groundOffset 넘어야 반대 발. */
    _groundSide(localX) {
        const { side, groundOffset } = this.settings.dominantFoot,
            toward = side === 'R' ? 1 : -1;
        return localX * toward < -groundOffset ? (side === 'R' ? 'L' : 'R') : side;
    }

    /** 공중 발 선택: 반대 발 발바닥이 공에 airMargin(m) 넘게 더 가까울 때만 반대 발. distances는 { L, R } 거리(m). */
    _airSide(distances) {
        const { side, airMargin } = this.settings.dominantFoot,
            other = side === 'R' ? 'L' : 'R';
        return distances[other] < distances[side] - airMargin ? other : side;
    }

    _motionVector(value, axis, mirror = 1) {
        const side = { x: -axis.z, y: 0, z: axis.x };
        return this._add(
            this._mul(axis, value.forward),
            this._add(
                this._v(0, value.height ?? value.up ?? 0, 0),
                this._mul(side, value.lateral * mirror),
            ),
        );
    }

    /**
     * 엉덩이의 lead초 뒤 예상 자리: 지금 몸 속도로 가고 중력으로 떨어지며, 점프를 누르고 있는 동안은 위로 가속한다(_pendingJumpHold).
     * 몸 회전으로 엉덩이 앵커가 도는 몫은 넣지 않는다.
     */
    _airHipAt(p, hip, lead) {
        const s = this.settings,
            predicted = this._add(hip, this._mul(this._bodyVelocity(p), lead));
        predicted.y -= 0.5 * s.gravity * lead * lead;
        const heldTime = Math.min(lead, this._pendingJumpHold(p));
        predicted.y += s.jumpHoldAcceleration * heldTime * (lead - 0.5 * heldTime);
        return predicted;
    }

    /**
     * 공이 엉덩이 예상 자리에서 다리 닿는 거리의 reachRatio배 안으로 처음 들어오는 시각(초). 공과 엉덩이는 둘 다 중력으로 움직이는 자유 물체라
     * 계산은 표본(arrivalStep)마다 두 예상 자리의 거리를 본다. 들어오지 못하면 가장 가까워지는 시각이다.
     */
    _airArrival(p, hip) {
        const s = this.settings,
            contact = s.airKick.contact,
            ball = this.ball.translation(),
            velocity = this.ball.linvel(),
            radius = this._legReach(p, p.kick.side) * contact.reachRatio;
        let best = contact.arrivalMin,
            bestDistance = Infinity;
        for (
            let time = contact.arrivalMin;
            time <= contact.arrivalMax + 1e-9;
            time += contact.arrivalStep
        ) {
            const at = this._add(ball, this._mul(velocity, time));
            at.y -= 0.5 * s.gravity * time * time;
            const distance = this._length(this._sub(at, this._airHipAt(p, hip, time)));
            if (distance <= radius) return time;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = time;
            }
        }
        return best;
    }

    _motionQuery(p, axis, preheld = false) {
        const root = p.root,
            suffix = p.kick.side,
            mirror = suffix === 'L' ? -1 : 1;
        const hip = this._point(root, { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
        const ankle = this._point(p.byName['foot' + suffix].body, this._v(0, 0.065, -0.085));
        const side = { x: -axis.z, y: 0, z: axis.x };
        const local = (vector) => ({
            forward: this._dot(vector, axis),
            height: vector.y,
            lateral: this._dot(vector, side) * mirror,
        });
        const relative = this._sub(this.ball.translation(), hip);
        const velocity = this._sub(this.ball.linvel(), root.velocityAtPoint(hip));
        const up = this._rotate(root.rotation(), this._v(0, 1, 0));
        const reach = this.settings.airKick.reach;
        // 접촉 시각: 공이 (엉덩이 예상 기준) 다리가 닿는 범위 안에 들어오는 때. 높이만 보지 않고 옆으로 먼 공도 거리로 본다.
        const arrival = this._airArrival(p, hip);
        return {
            ball: local(relative),
            foot: local(this._sub(ankle, hip)),
            velocity: local(velocity),
            body: { up: up.y, forward: this._dot(up, axis), spin: this._dot(root.angvel(), side) },
            timeToContact: arrival,
            preheld,
            legLength: reach,
        };
    }

    /**
     * 공중 발차기의 발 목표. 계획이 없으면 먼저 세우고(_beginAirPlan), 매 물리 걸음 다리 상태 → 접촉 예측 →
     * 공격 평면 조향 → 타격 전환 → 동작 위상 → 접촉 기하 → 마지막 스트로크 길이 → 발목 궤적 → 다리 길이 제한 →
     * 계획 기록 순으로 계산한다. 이 묶음은 Rapier에 쓰지 않고, 읽기 순서는 하나의 메서드였을 때와 같다.
     */
    _airFootTarget(p, dt, continuingGroundKick, preference, kickAim, response) {
        const ballPos = this.ball.translation(),
            ballVel = this.ball.linvel();
        if (!p.kick.airPlan)
            this._beginAirPlan(
                p,
                ballPos,
                ballVel,
                continuingGroundKick,
                preference,
                kickAim,
                response,
            );
        const plan = p.kick.airPlan;
        const leg = this._airKickLeg(p);
        const aim = this._aimAirContact(p, plan, ballPos, ballVel, dt, kickAim);
        this._steerAirAxis(p, plan, leg.hip, aim.contact, dt);
        const surface = this._enterAirStrike(plan, leg, aim);
        this._advanceAirMotion(p, plan, dt);
        const geometry = this._airContactGeometry(p, plan, leg, aim, surface);
        const terminal = this._airTerminalDuration(p, plan, leg, aim, geometry);
        const path = this._airPrepPath(plan, leg, aim, geometry, terminal, dt);
        this._airStrokePath(plan, aim, geometry, terminal, path);
        const limit = this._limitAirReach(p, plan, leg, geometry, path, dt);
        return this._recordAirPlan(p, plan, aim.contact, geometry, path, limit);
    }

    /** 공격 평면의 축: 팀 방향(toward)과 접촉점의 옆 치우침(lateral, 상한 있음). */
    _airPlanAxis(p, contact) {
        const kick = this.settings.airKick,
            root = p.root;
        const lateral = this._clamp(
            (contact.impact.z - root.translation().z) /
                Math.max(
                    kick.lateral.minDistance,
                    Math.abs(contact.impact.x - root.translation().x),
                ),
            -kick.lateral.max,
            kick.lateral.max,
        );
        return this._unit(this._v(p.toward, 0, lateral));
    }

    /** 두 발 앞꿈치에서 접촉점까지의 거리(찰 발 고르기용). */
    _airFootDistances(p, contact) {
        const kick = this.settings.airKick;
        const distances = {};
        for (const side of ['L', 'R']) {
            const sole = this._point(
                p.byName['foot' + side].body,
                this._v(0, 0.055, kick.forefoot),
            );
            distances[side] = this._length(this._sub(contact.impact, sole));
        }
        return distances;
    }

    /** 동작 클립과 시작 위상을 고르고, 시작 위상을 접촉 위상 앞(phaseMargin)으로 당긴 자세를 다시 읽는다. */
    _selectAirMotion(p, axis, preheld, preference) {
        const settings = this.settings.airKick.motion;
        const query = this._motionQuery(p, axis, preheld);
        const selection = this.motionMatcher.select(query, preference);
        let pose = this.motionMatcher.sample(selection.id, selection.phase);
        selection.phase = Math.min(
            selection.phase,
            Math.max(0, pose.contactPhase - settings.phaseMargin),
        );
        pose = this.motionMatcher.sample(selection.id, selection.phase);
        return { query, selection, pose };
    }

    /** 동작 클립 몸 회전축(찰 발 쪽으로 거울)과 시작 각도, 시작 각도를 되돌리는 회전. */
    _airPlanRotation(pose, mirror, axis) {
        const rotationAxis = this._unit(
            this._motionVector(
                {
                    forward: pose.body.axis.forward * mirror,
                    up: pose.body.axis.up * mirror,
                    lateral: pose.body.axis.lateral,
                },
                axis,
            ),
        );
        const initialAngle = pose.body.angle;
        const unrotate = {
            ...this._mul(rotationAxis, -Math.sin(initialAngle / 2)),
            w: Math.cos(initialAngle / 2),
        };
        return { rotationAxis, initialAngle, unrotate };
    }

    /** 공중 발차기 계획을 세운다: 찰 발, 공격 평면, 동작 클립과 시작 위상, 준비 시간, 몸 회전 기준과 그 기준 궤적. */
    _beginAirPlan(p, ballPos, ballVel, continuingGroundKick, preference, kickAim, response) {
        const s = this.settings,
            kick = s.airKick,
            root = p.root,
            settings = kick.motion;
        const contact = this._airContact(p, ballPos, ballVel, kick.leadTime, kickAim);
        const axis = this._airPlanAxis(p, contact);
        const distances = this._airFootDistances(p, contact);
        if (!continuingGroundKick) p.kick.side = this._airSide(distances);
        const preheld = continuingGroundKick,
            mirror = p.kick.side === 'L' ? -1 : 1;
        const { query, selection, pose } = this._selectAirMotion(p, axis, preheld, preference);
        const { rotationAxis, initialAngle, unrotate } = this._airPlanRotation(pose, mirror, axis);
        const ankle = this._point(p.byName['foot' + p.kick.side].body, this._v(0, 0.065, -0.085));
        const remaining = this._clamp(
            query.timeToContact,
            kick.contact.preparationTime,
            kick.contact.horizon,
        );
        p.kick.airPlan = {
            phase: preheld ? 'align' : 'lift',
            entry: preheld ? 'downward' : 'swing',
            axis,
            remaining,
            motion: {
                ...selection,
                pose,
                age: 0,
                preheld,
                preference,
                selection: { confidence: selection.confidence, score: selection.score },
                startPoint: { ...ankle },
                startVelocity: {
                    ...p.byName['foot' + p.kick.side].body.velocityAtPoint(ankle),
                },
                duration: remaining,
                startPhase: selection.phase,
                point: { ...ankle },
                reachError: 0,
                adaptation: 0,
                adaptationLimit: kick.reach * settings.adaptation,
            },
            rotation: {
                axis: rotationAxis,
                start: this._qmul(unrotate, root.rotation()),
                angle: initialAngle,
                previous: { ...root.rotation() },
                target: initialAngle,
            },
            body: this._airBodyTurn(p, pose, rotationAxis, remaining, response),
            response,
        };
    }

    /** 차는 다리의 엉덩이·발바닥·발목 위치와 속도. */
    _airKickLeg(p) {
        const kick = this.settings.airKick,
            root = p.root,
            foot = p.byName['foot' + p.kick.side].body;
        const mirror = p.kick.side === 'L' ? -1 : 1;
        const hip = this._point(root, { x: p.kick.side === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
        const hipVelocity = root.velocityAtPoint(hip);
        const sole = this._point(foot, this._v(0, 0.055, kick.forefoot));
        const soleVelocity = foot.velocityAtPoint(sole);
        const currentAnkle = this._point(foot, this._v(0, 0.065, -0.085));
        return { mirror, hip, hipVelocity, sole, soleVelocity, currentAnkle };
    }

    /** 남은 준비 시간을 줄이고 이번 물리 걸음의 예상 접촉과 접촉 순간 공 속도를 정한다. 스트로크에 들어서면 고정한다. */
    _aimAirContact(p, plan, ballPos, ballVel, dt, kickAim) {
        const s = this.settings,
            kick = s.airKick;
        plan.remaining = Math.max(0, plan.remaining - dt);
        // A held input has one finite preparation deadline. The foot starts moving
        // immediately; neither an unreachable clearance pose nor a clip phase can
        // keep moving that deadline away while the ball passes the player.
        const preparingBefore = plan.phase === 'lift' || plan.phase === 'align';
        const lead = Math.max(dt, plan.remaining + dt);
        // The terminal stroke retains its predicted impact and face. A foot that
        // is already swinging must pass through that point, not chase a moving
        // endpoint with an unrelated downward velocity.
        const contact =
            plan.strokeContact ||
            (plan.phase === 'follow' && plan.contact) ||
            this._airContact(p, ballPos, ballVel, lead, kickAim);
        const incomingAtImpact = plan.strokeIncoming || {
            x: ballVel.x,
            y: ballVel.y - s.gravity * lead,
            z: ballVel.z,
        };
        if (!plan.strokeContact && plan.remaining <= kick.contact.strokeTime) {
            plan.strokeContact = structuredClone(contact);
            plan.strokeIncoming = { ...incomingAtImpact };
        }
        return { preparingBefore, lead, contact, incomingAtImpact };
    }

    /** 공격 평면을 예상 접촉 쪽으로 제한된 속도로 돌린다. 맞은 뒤(follow)에는 평면을 고정한다. */
    _steerAirAxis(p, plan, hip, contact, dt) {
        const kick = this.settings.airKick;
        const lateral = this._clamp(
            (contact.impact.z - hip.z) /
                Math.max(kick.lateral.minDistance, Math.abs(contact.impact.x - hip.x)),
            -kick.lateral.max,
            kick.lateral.max,
        );
        const heading = Math.atan2(p.toward, lateral),
            previousHeading = Math.atan2(plan.axis.x, plan.axis.z);
        const headingError = Math.atan2(
            Math.sin(heading - previousHeading),
            Math.cos(heading - previousHeading),
        );
        const headingStep = this._clamp(
            headingError,
            (-kick.speed * dt) / (kick.reach * 2),
            (kick.speed * dt) / (kick.reach * 2),
        );
        // A hit freezes the attack plane as well as the face. Otherwise chasing
        // the departing ball can turn a genuine downward contact into a scoop.
        if (plan.phase !== 'follow') plan.axis = this._rotate(this._yaw(headingStep), plan.axis);
    }

    /** 준비 중인 발이 시간이 다 됐거나 공 아래 제동 가능한 자리에 오면 타격 단계로 넘긴다. 공 표면 접촉점을 돌려준다. */
    _enterAirStrike(plan, leg, aim) {
        const s = this.settings,
            kick = s.airKick;
        const { sole, soleVelocity } = leg;
        const { preparingBefore, contact } = aim;
        const surface = contact.surface;
        const normalGap = this._dot(this._sub(surface, sole), contact.normal);
        const upwardSpeed = Math.max(0, soleVelocity.y - contact.velocity.y);
        const brakingDistance = Math.min(
            kick.preparation,
            (upwardSpeed * upwardSpeed * kick.trackingMass) / (2 * kick.force),
        );
        if (
            preparingBefore &&
            (plan.remaining <= kick.contact.strokeTime ||
                (sole.y + brakingDistance >= surface.y + kick.clearance &&
                    normalGap > 0 &&
                    this._length(this._sub(surface, sole)) < kick.preparation * 2))
        )
            plan.phase = 'strike';
        return surface;
    }

    /** 동작 클립 위상을 진행하되 단계별 상한을 넘지 않게 한다. 몸 회전은 클립 각도가 아니라 계획의 기준 궤적(plan.body)을 따른다. */
    _advanceAirMotion(p, plan, dt) {
        const settings = this.settings.airKick.motion,
            motion = plan.motion,
            axis = plan.axis;
        const previousPose = motion.pose;
        const query = this._motionQuery(p, axis, motion.preheld);
        query.timeToContact = Math.max(dt, plan.remaining);
        this.motionMatcher.advance(motion, query, dt);
        const cap =
            plan.phase === 'follow'
                ? 1
                : previousPose.contactPhase +
                  (plan.phase === 'strike' ? settings.phaseMargin : -settings.phaseMargin);
        motion.phase = Math.min(motion.phase, cap);
        motion.pose = this.motionMatcher.sample(motion.id, motion.phase);
    }

    /**
     * 공중 차기의 접촉 조건을 다리 계획 좌표로(_tossContactJoints, 지상과 같은 계산). 몸은 회전 기준 궤적(plan.body)이 접촉 시각에 낼 방향·각속도로 돌고,
     * 엉덩이는 자유 낙하(점프 누름 가속 포함)로 간다. 공중에서는 몸과 다리가 같이 떨어져 다리 모델에 중력이 걸리지 않는다(모델 gravity 0).
     */
    _airContactJoints(p, suffix, plan, target, remaining) {
        const turn = plan.body,
            rotation = plan.rotation,
            angle = turn.end.angle,
            now = p.root.rotation(),
            contactRotation = this._qmul(
                { ...this._mul(rotation.axis, Math.sin(angle / 2)), w: Math.cos(angle / 2) },
                rotation.start,
            ),
            angularVelocity = this._mul(rotation.axis, turn.end.rate);
        const anchor = this._hipAnchor(suffix),
            hip = this._point(p.root, anchor);
        // 엉덩이: 몸 중심은 자유 낙하하고 앵커는 접촉 때 방향으로 돈다.
        const fall = this._sub(this._airHipAt(p, hip, remaining), hip),
            turned = this._sub(this._rotate(contactRotation, anchor), this._rotate(now, anchor));
        const held = Math.min(remaining, this._pendingJumpHold(p)),
            bodyVelocity = this._add(
                this._bodyVelocity(p),
                this._v(
                    0,
                    -this.settings.gravity * remaining + this.settings.jumpHoldAcceleration * held,
                    0,
                ),
            );
        const travel = {
            offset: this._add(fall, turned),
            velocity: this._add(
                bodyVelocity,
                this._cross(angularVelocity, this._rotate(contactRotation, anchor)),
            ),
        };
        const joints = this._tossContactJoints(p, suffix, target, travel, {
            rotation: contactRotation,
            angularVelocity,
        });
        return { joints, rotation: contactRotation };
    }

    /**
     * 다리 관절 계획이 접촉 때 낼 수 있는 발의 접근 속도(공 쪽으로 다가가는 속도, m/s). 접촉 조건은 desiredContact와 원하던 접촉 발 속도이고,
     * 남은 시간 안에 구동 한계(모터 최대 토크·발-골반 힘·발 속도 한계)로 못 내면 legPlanSolve가 속도를 줄여 낼 수 있는 값을 준다.
     * 스트로크에 들어서면(plan.strokeContact) 그때 값을 고정한다.
     */
    _airPlannedClosing(p, plan, leg, aim, desiredContact, incomingAtImpact) {
        if (plan.plannedClosing !== undefined) return plan.plannedClosing;
        const suffix = p.kick.side,
            contact = aim.contact;
        const { joints, rotation } = this._airContactJoints(
            p,
            suffix,
            plan,
            { ankle: desiredContact, velocity: contact.velocity },
            Math.max(0, aim.lead),
        );
        // 구동은 공중 차기가 실제로 거는 것이다(계획 전용 값 없음): 엉덩이 모터는 꺼져 있어(_driveJointKick의 공중 엉덩이) 엉덩이는 발-골반 힘 airKick.force가
        // 맡고, 발 속도 한계는 접촉 속도 상한이며, 몸과 다리가 같이 떨어져 중력은 걸리지 않는다. 지상의 엉덩이 모터 최대 토크를 쓰면 낼 수 있는 접촉을
        // 못 낸다고 잘못 판정한다(접촉 직전 걸음의 40~50%).
        const model = this._legPlanModel(p, suffix, p.root.rotation(), plan.response ?? 1, {
            force: this.settings.airKick.force,
            hipTorque: 0,
            maxFootSpeed: this.settings.airKick.contact.maxSpeed,
            gravity: 0,
        });
        const state = this._legJointState(p, suffix, p.root.rotation(), p.root.angvel(), model);
        // 풀이는 가장 긴 휘두르기 길이(legPlan.maxTime) 안에서만 한다: 지상은 그보다 일찍 누르면 기다렸다가 휘두르는데, 공중은 접촉이 더 먼 걸음에도
        // 마지막 휘두르기가 그 길이 안이라고 본다(더 긴 곡선은 시작 속도가 큰 채 한참 떠돌아 한계를 넘는 것으로 잘못 판정된다).
        const solved = legPlanSolve(
            model,
            state,
            joints,
            Math.min(Math.max(0, aim.lead), this.settings.legPlan.maxTime),
            this.settings.legPlan,
        );
        const velocity = this._add(
            joints.hipVelocity,
            this._rotate(
                rotation,
                legAnkleVelocity(model, solved.end.position, solved.end.velocity),
            ),
        );
        const closing = this._dot(this._sub(velocity, incomingAtImpact), contact.approach);
        if (plan.strokeContact) plan.plannedClosing = closing;
        return closing;
    }

    /** 클립의 접촉 자세, 공 표면에 맞출 발목 위치, 클립 대비 보정량, 발이 공으로 가는 방향(approach)의 접근 속도. */
    _airContactGeometry(p, plan, leg, aim, surface) {
        const kick = this.settings.airKick,
            motion = plan.motion,
            axis = plan.axis;
        const { mirror, hip } = leg;
        const { contact, incomingAtImpact } = aim;
        // One held input keeps its clip and phase. Only finite residual warping
        // follows the ball; no per-frame reclassification can flap between kicks.
        const contactPose = this.motionMatcher.sample(motion.id, motion.pose.contactPhase);
        const referenceContact = this._mul(
            this._motionVector(contactPose.foot, axis, mirror),
            kick.reach,
        );
        const ankleOffset = this._add(
            this._mul(contact.normal, 0.065 - 0.055),
            this._mul(contact.forward, -0.085 - kick.forefoot),
        );
        const desiredContact = this._add(surface, ankleOffset);
        const error = this._sub(this._sub(desiredContact, hip), referenceContact);
        const correction = this._limit(error, motion.adaptationLimit);
        const strikeVelocity = contact.velocity;
        const wantedClosing = Math.max(
            kick.contact.minClosingSpeed,
            this._dot(this._sub(strikeVelocity, incomingAtImpact), contact.approach),
        );
        // 계획이 약속하는 접근 속도: 다리 관절 계획이 접촉 때 낼 수 있는 만큼까지만(_airPlannedClosing).
        const closingSpeed = Math.max(
            kick.contact.minClosingSpeed,
            Math.min(
                wantedClosing,
                this._airPlannedClosing(p, plan, leg, aim, desiredContact, incomingAtImpact),
            ),
        );
        return { contactPose, ankleOffset, desiredContact, correction, closingSpeed };
    }

    /** 마지막 스트로크 길이. 다리가 닿는 시간과 유한한 힘으로 낼 수 있는 시간 사이에서 고르고 스트로크에 들어서면 고정한다. */
    _airTerminalDuration(p, plan, leg, aim, geometry) {
        const s = this.settings,
            kick = s.airKick;
        const { hip } = leg;
        const { lead, contact, incomingAtImpact } = aim;
        const { desiredContact, closingSpeed } = geometry;
        // Estimate the time at which the ball-relative preparation point enters
        // the actual hip workspace. Both free bodies share gravity here; pending
        // jump support is included in the predicted hip, as in the contact query.
        const bodyVelocity = this._bodyVelocity(p);
        const futureHip = this._add(hip, this._mul(bodyVelocity, lead));
        futureHip.y -= 0.5 * s.gravity * lead * lead;
        const heldTime = Math.min(lead, this._pendingJumpHold(p));
        futureHip.y += s.jumpHoldAcceleration * heldTime * (lead - 0.5 * heldTime);
        const futureHipVelocity = this._add(
            bodyVelocity,
            this._v(0, -s.gravity * lead + s.jumpHoldAcceleration * heldTime, 0),
        );
        const relativeEnd = this._sub(desiredContact, futureHip);
        const relativeApproach = this._add(
            this._sub(incomingAtImpact, futureHipVelocity),
            this._mul(contact.approach, closingSpeed * 0.5),
        );
        const qa = this._dot(relativeApproach, relativeApproach);
        const qb = -2 * this._dot(relativeEnd, relativeApproach);
        const radius = this._legReach(p, p.kick.side);
        const qc = this._dot(relativeEnd, relativeEnd) - radius * radius;
        const discriminant = qb * qb - 4 * qa * qc;
        const reachTime =
            qa > 1e-6 && discriminant >= 0
                ? Math.max(0, (-qb + Math.sqrt(discriminant)) / (2 * qa))
                : qc <= 0
                  ? kick.contact.terminalMax
                  : 0;
        const reachStart =
            qa > 1e-6 && discriminant >= 0
                ? Math.max(0, (-qb - Math.sqrt(discriminant)) / (2 * qa))
                : 0;
        const forceTime = (kick.trackingMass * closingSpeed) / kick.force;
        const terminalMin = Math.max(kick.contact.terminalMin, forceTime, reachStart);
        const terminalMax = Math.min(kick.contact.terminalMax, reachTime);
        // Reach supplies an upper bound, while finite acceleration supplies a
        // lower bound. An empty interval cannot promise the requested impact;
        // retain the bounded stroke and let the real workspace/force caps apply.
        const terminal =
            plan.terminalDuration ||
            this._clamp(terminalMax, kick.contact.terminalMin, kick.contact.terminalMax);
        if (plan.strokeContact && !plan.terminalDuration) {
            plan.terminalDuration = terminal;
            plan.terminalFeasible = terminalMin <= terminalMax;
        }
        return terminal;
    }

    /** 시작점에서 스트로크 시작점까지의 3차 에르미트 준비 궤적(위치·속도·가속도)과 클립 모양의 호. */
    _airPrepPath(plan, leg, aim, geometry, terminal, dt) {
        const s = this.settings,
            kick = s.airKick,
            motion = plan.motion,
            axis = plan.axis;
        const { mirror } = leg;
        const { contact, incomingAtImpact } = aim;
        const { contactPose, ankleOffset, closingSpeed } = geometry;
        const duration = motion.duration,
            elapsed = motion.age;
        const prepDuration = Math.max(dt, duration - terminal);
        const prepBall = this._sub(contact.impact, this._mul(incomingAtImpact, terminal));
        prepBall.y -= 0.5 * s.gravity * terminal * terminal;
        // 스트로크 시작점: 그때의 공에서 접촉점(공 반지름만큼 normal 반대)까지 간 뒤, 발이 오는 방향(approach)으로 남은 접근 거리만큼 뒤.
        const prepPoint = this._add(
            this._sub(
                this._sub(prepBall, this._mul(contact.normal, s.ballRadius)),
                this._mul(contact.approach, 0.5 * closingSpeed * terminal),
            ),
            ankleOffset,
        );
        const prepVelocity = this._add(incomingAtImpact, this._v(0, s.gravity * terminal, 0));
        const u = this._clamp(elapsed / prepDuration, 0, 1),
            u2 = u * u,
            u3 = u2 * u;
        const startPoint = motion.startPoint,
            startVelocity = motion.startVelocity;
        let rawAnkle = this._add(
            this._add(
                this._mul(startPoint, 2 * u3 - 3 * u2 + 1),
                this._mul(startVelocity, prepDuration * (u3 - 2 * u2 + u)),
            ),
            this._add(
                this._mul(prepPoint, -2 * u3 + 3 * u2),
                this._mul(prepVelocity, prepDuration * (u3 - u2)),
            ),
        );
        let desiredVelocity = this._add(
            this._add(
                this._mul(startPoint, (6 * u2 - 6 * u) / prepDuration),
                this._mul(startVelocity, 3 * u2 - 4 * u + 1),
            ),
            this._add(
                this._mul(prepPoint, (-6 * u2 + 6 * u) / prepDuration),
                this._mul(prepVelocity, 3 * u2 - 2 * u),
            ),
        );
        let acceleration = this._add(
            this._add(
                this._mul(startPoint, (12 * u - 6) / (prepDuration * prepDuration)),
                this._mul(startVelocity, (6 * u - 4) / prepDuration),
            ),
            this._add(
                this._mul(prepPoint, (-12 * u + 6) / (prepDuration * prepDuration)),
                this._mul(prepVelocity, (6 * u - 2) / prepDuration),
            ),
        );
        if (!motion.arc) {
            const startPose = this.motionMatcher.sample(motion.id, motion.startPhase);
            const middlePose = this.motionMatcher.sample(
                motion.id,
                (motion.startPhase + motion.pose.contactPhase) * 0.5,
            );
            const chordMiddle = this._mul(
                this._add(
                    this._motionVector(startPose.foot, axis, mirror),
                    this._motionVector(contactPose.foot, axis, mirror),
                ),
                kick.reach * 0.5,
            );
            motion.arc = this._limit(
                this._sub(
                    this._mul(this._motionVector(middlePose.foot, axis, mirror), kick.reach),
                    chordMiddle,
                ),
                kick.clearance,
            );
        }
        rawAnkle = this._add(rawAnkle, this._mul(motion.arc, 16 * u2 * (1 - u) * (1 - u)));
        desiredVelocity = this._add(
            desiredVelocity,
            this._mul(motion.arc, (16 * (2 * u - 6 * u2 + 4 * u3)) / prepDuration),
        );
        acceleration = this._add(
            acceleration,
            this._mul(motion.arc, (16 * (2 - 12 * u + 12 * u2)) / (prepDuration * prepDuration)),
        );
        return { prepDuration, rawAnkle, desiredVelocity, acceleration };
    }

    /** 스트로크 구간이면 공을 따라가며 접근 속도를 쌓는 궤적으로, 접촉 뒤면 타격 속도로 밀고 나가는 궤적으로 바꾼다. */
    _airStrokePath(plan, aim, geometry, terminal, path) {
        const s = this.settings,
            kick = s.airKick,
            motion = plan.motion;
        const { contact, incomingAtImpact } = aim;
        const { ankleOffset, desiredContact, closingSpeed } = geometry;
        const strikeVelocity = contact.velocity;
        const duration = motion.duration,
            elapsed = motion.age;
        if (elapsed >= path.prepDuration && elapsed < duration) {
            const remaining = duration - elapsed;
            const relativeGap =
                closingSpeed * remaining - (0.5 * closingSpeed * remaining * remaining) / terminal;
            const movingBall = this._sub(contact.impact, this._mul(incomingAtImpact, remaining));
            movingBall.y -= 0.5 * s.gravity * remaining * remaining;
            path.rawAnkle = this._add(
                this._sub(
                    this._sub(movingBall, this._mul(contact.normal, s.ballRadius)),
                    this._mul(contact.approach, relativeGap),
                ),
                ankleOffset,
            );
            path.desiredVelocity = this._add(
                this._add(incomingAtImpact, this._v(0, s.gravity * remaining, 0)),
                this._mul(contact.approach, closingSpeed * (1 - remaining / terminal)),
            );
            path.acceleration = this._add(
                this._v(0, -s.gravity, 0),
                this._mul(contact.approach, closingSpeed / terminal),
            );
        } else if (elapsed >= duration) {
            const follow = Math.min(elapsed - duration, kick.contact.strokeTime);
            const fraction = follow / kick.contact.strokeTime;
            path.rawAnkle = this._add(
                desiredContact,
                this._mul(strikeVelocity, follow * (1 - 0.5 * fraction)),
            );
            path.desiredVelocity = this._mul(strikeVelocity, 1 - fraction);
            path.acceleration =
                fraction < 1 ? this._mul(strikeVelocity, -1 / kick.contact.strokeTime) : this._v();
        }
    }

    /**
     * 발목 목표를 다리 길이 범위 안으로 넣고, 다음 물리 걸음에 범위를 벗어날 속도면 속도를 투영한다.
     * 범위가 궤적을 바꾸거나 스트로크 전이면 가속도 피드포워드를 끈다.
     */
    _limitAirReach(p, plan, leg, geometry, path, dt) {
        const { hip, hipVelocity, currentAnkle } = leg;
        const { desiredContact } = geometry;
        // The fixed contact orientation defines the ankle offset. Its terminal
        // angular velocity is zero, so the contact and ankle share one tangent.
        // Actual foot spin remains feedback for the separate torque controller.
        const reach = this._legReach(p, p.kick.side);
        const minReach = this._legMinReach(p, p.kick.side);
        const contactDistance = this._length(this._sub(desiredContact, hip));
        const relativeAnkle = this._sub(path.rawAnkle, hip),
            distance = this._length(relativeAnkle);
        // The visible leg supports the preparation path as well as its contact.
        // Requesting only the endpoint would retract it during a wider wind-up.
        plan.requestedReach = Math.max(contactDistance, distance);
        const direction = this._unit(relativeAnkle, this._v(0, 1, 0));
        const ankle = this._add(hip, this._mul(direction, this._clamp(distance, minReach, reach)));
        const current = this._sub(currentAnkle, hip);
        const nextAnkle = this._add(
            current,
            this._mul(this._sub(path.desiredVelocity, hipVelocity), dt),
        );
        const nextDistance = this._length(nextAnkle);
        if (nextDistance > reach || nextDistance < minReach) {
            path.desiredVelocity = this._add(
                hipVelocity,
                this._mul(
                    this._sub(
                        this._mul(
                            this._unit(nextAnkle, direction),
                            this._clamp(nextDistance, minReach, reach),
                        ),
                        current,
                    ),
                    1 / dt,
                ),
            );
        }
        // Feed-forward is only an effective-mass approximation. Disable it when
        // the endpoint is still being retargeted or a reach constraint projects
        // this path; the bounded contact-point PD remains authoritative.
        if (
            !plan.strokeContact ||
            distance > reach ||
            nextDistance > reach ||
            distance < minReach ||
            nextDistance < minReach
        )
            path.acceleration = null;
        return { ankle, reach, contactDistance };
    }

    /**
     * 이번 물리 걸음 결과를 동작·계획에 기록하고 발 목표를 돌려준다. 공으로 다가가는 속도는 마지막 스트로크(_airStrokePath)의 시계 하나가 정한다
     * (v0.29.0. 그전에는 공이 발등 앞 2r + clearance 안에 들면 발등 밀기가 법선 힘을 바꿔 계획 시계보다 먼저 휘둘렀다).
     */
    _recordAirPlan(p, plan, contact, geometry, path, limit) {
        const motion = plan.motion;
        const { correction } = geometry;
        const { ankle, reach, contactDistance } = limit;
        motion.point = { ...path.rawAnkle };
        motion.reachError = Math.max(0, contactDistance - reach);
        motion.adaptation = this._length(correction);
        motion.correction = correction;
        if (plan.phase !== 'follow') {
            plan.contact = contact;
            plan.contactAt = this.time;
        }
        plan.point = ankle;
        plan.normal = contact.normal;
        plan.forward = contact.forward;
        return {
            target: ankle,
            velocity: path.desiredVelocity,
            acceleration: path.acceleration,
            ankle,
            normal: contact.normal,
            forward: contact.forward,
        };
    }

    /**
     * 지상 토스(받기·세트)의 발 목표. 계획이 없으면 세우고(_beginReceivePlan. 공 도착 strokeLeadMs 안에서만 불린다: _armGroundToss),
     * 맞은 뒤 따라 차기가 끝났으면 발을 거두고, 아니면 받기 종류에 맞는 궤적을 고른다.
     */
    _receiveFootTarget(p, input, ballPos, ballVel, body, dt) {
        const toss = this.settings.groundToss;
        // Once committed, retain the stroke instead of replanning around the outgoing ball.
        if (!p.kick.receivePlan) this._beginReceivePlan(p, input, ballPos, ballVel, body);
        const plan = p.kick.receivePlan;
        if (
            p.receive?.hitAt !== null &&
            p.receive?.hitAt !== undefined &&
            this.time - p.receive.hitAt >= toss.followThrough
        )
            return this._retractReceiveFoot(p, plan, dt);
        if (plan.joints) return this._jointTossPath(p, plan, body, dt);
        if (p.receive?.mode !== 'slide') return this._dynamicReceivePath(p, plan, ballVel, dt);
        if (plan.attackSet) return this._cushionReceivePath(plan, dt);
        return this._strokeReceivePath(p, plan, ballVel, dt);
    }

    /**
     * 받기 계획: 접촉 조건(_tossContact)과 발이 거기까지 가는 길. 서서 차는 토스(서브·세트·쿠션 받기)는 다리 관절 계획이다: 지금 관절 상태에서
     * 접촉 관절 상태(joints.end)까지의 길이와 낼 수 있는 접촉 속도를 legPlanSolve가 정하고, joints가 걸음마다 나아가는 기준 상태다(_jointTossPath).
     * 몸을 던지는 받기(런지·슬라이드)는 발 중심의 시작점·시작 속도에서 가는 기존 발 궤적이다.
     */
    _beginReceivePlan(p, input, ballPos, ballVel, body) {
        const dynamicReceive = !!p.receive && p.receive.mode !== 'cushion';
        const contact = this._tossContact(p, input, ballPos, ballVel, !dynamicReceive);
        const plan = {
            duration: contact.duration,
            startedAt: this.time,
            normal: contact.normal,
            approach: contact.approach,
            forward: contact.forward,
            point: contact.point,
            velocity: contact.velocity,
            attackSet: contact.attacking,
            dynamicReceive,
            incoming: contact.incoming,
        };
        p.kick.receivePlan = plan;
        if (dynamicReceive) {
            const foot = p.byName['foot' + p.kick.side].body;
            const ankle = this._point(foot, this._v(0, 0.065, -0.085));
            // Every pass drives the ankle. Curves use foot-centre coordinates;
            // subtract the same contact anchor offset at the starting boundary.
            plan.start = this._sub(ankle, this._ankleOffset(plan));
            plan.startVelocity = { ...foot.velocityAtPoint(ankle) };
            return;
        }
        // 관절 계획은 이 골반 방향을 기준으로 세운다. 휘두르는 동안 골반이 기울어도 다리는 세계 좌표에서 이 방향 기준으로 간다(_jointTossAnkle).
        plan.rotation = { ...body.rootRotation };
        const suffix = p.kick.side,
            { rootRotation, muscleResponse } = body;
        const model = this._legPlanModel(p, suffix, rootRotation, muscleResponse);
        const state = this._legJointState(p, suffix, rootRotation, body.rootAngularVelocity, model);
        const contactJoints = this._groundContactJoints(
            p,
            suffix,
            plan,
            plan.duration,
            rootRotation,
        );
        const solved = legPlanSolve(
            model,
            state,
            contactJoints,
            plan.duration,
            this.settings.legPlan,
        );
        plan.duration = solved.duration;
        // 계획의 발 속도는 낼 수 있는 속도다: 끝 상태의 관절 각속도가 내는 발목 속도에 그때의 엉덩이 속도 예상을 더한다.
        plan.velocity = this._add(
            contactJoints.hipVelocity,
            this._rotate(
                rootRotation,
                legAnkleVelocity(model, solved.end.position, solved.end.velocity),
            ),
        );
        plan.joints = {
            position: state.position,
            velocity: state.velocity,
            acceleration: [0, 0, 0],
            // 기준 상태의 시각. 계획이 돌지 않은 걸음(차기 구동이 빠진 걸음)이 있어도 기준은 시각으로 나아가 같은 곡선 위에 있다.
            at: this.time,
            end: solved.end,
        };
    }

    /** 발 중심에서 발목 관절까지(접촉면 방향 기준). 계획의 발 중심 좌표를 발목 좌표로 옮길 때 더한다. */
    _ankleOffset(contact) {
        return this._add(this._mul(contact.normal, 0.065), this._mul(contact.forward, -0.085));
    }

    /**
     * 지상 토스의 접촉 조건: 공 도착 예측, 원하는 패스 속도, 그 속도를 낼 접촉면 방향(normal)·발 속도(velocity), 발 방향(forward), 발 중심 자리(point).
     * standing이면 서서 차는 토스(계획 길이 = 공 도착까지), 아니면 몸을 던지는 받기(계획 길이 ≤ strokeLeadMs)다.
     */
    _tossContact(p, input, ballPos, ballVel, standing) {
        const toss = this.settings.groundToss;
        const pass = this._predictReceivePass(p, input, ballPos, ballVel, standing);
        const { duration, incoming, impact, attacking } = pass;
        const { normal, surface, approach, velocity } = this._receiveStrike(
            p,
            pass.wanted,
            incoming,
            impact,
            input.aim,
        );
        // A slide points the toes along the extended leg, leaving the ankle
        // behind the instep. A fixed net-facing foot twists the knee sideways
        // and exposes its narrow edge when the save is far to either side.
        const heading =
            p.receive?.mode === 'slide'
                ? this._sub(impact, p.root.translation())
                : this._v(p.toward, 0, 0);
        const forward = this._unit(
            this._sub(heading, this._mul(normal, this._dot(heading, normal))),
        );
        // 발 중심: 발등(위로 0.055)이 접촉점에 닿고 앞꿈치(forefoot)가 맞는 자리.
        const point = this._sub(
            this._sub(surface, this._mul(normal, 0.055)),
            this._mul(forward, toss.forefoot),
        );
        return { duration, incoming, attacking, normal, approach, velocity, forward, point };
    }

    /**
     * 차는 다리의 관절 계획 모델(leg-plan.js): 실제 몸 부위의 질량·길이·관성, 실제 모터 설정(_motorGains)의 최대 토크, 발-골반 힘의 상한과
     * 힘-속도 한계(_driveJointKick이 거는 값과 같다), 무릎 경첩 범위, 다리가 닿는 거리. 계획에만 쓰는 값은 없다.
     */
    _legPlanModel(p, suffix, rootRotation, muscleResponse, actuation = null) {
        const s = p.settings;
        const upper = p.byName['upperLeg' + suffix],
            lower = p.byName['lowerLeg' + suffix],
            scale = p.legs[suffix].scale;
        const joint = (name) => p.joints.find((item) => item.name === name + suffix);
        const strength = s.drive.kickLegStrength.ground * muscleResponse,
            knee = joint('knee');
        return legPlanModel({
            upper: upper.restLength * scale,
            lower: lower.restLength * scale,
            upperMass: upper.mass,
            lowerMass: lower.mass,
            footMass: p.byName['foot' + suffix].mass,
            upperInertia: upper.body.principalInertia().x,
            lowerInertia: lower.body.principalInertia().x,
            hipTorque: actuation?.hipTorque ?? this._motorGains(joint('hip'), strength).cap,
            kneeTorque: this._motorGains(knee, strength).cap,
            footForce: (actuation?.force ?? s.groundKickForce) * muscleResponse,
            maxFootSpeed: actuation?.maxFootSpeed ?? this.settings.groundToss.maxFootSpeed,
            kneeMin: knee.joint.limitsMin(),
            kneeMax: knee.joint.limitsMax(),
            reachMin: this._legMinReach(p, suffix),
            reachMax: this._legReach(p, suffix),
            gravity: actuation ? actuation.gravity : s.gravity,
            down: this._rotate(this._conj(rootRotation), this._v(0, -1, 0)),
        });
    }

    /** 차는 다리의 지금 관절 각·각속도(leg-plan.js 좌표: 엉덩이 굽힘·벌림, 무릎). 몸체의 상대 회전과 상대 각속도에서 읽는다. */
    _legJointState(p, suffix, rootRotation, rootAngularVelocity, model) {
        const upper = p.byName['upperLeg' + suffix].body,
            lower = p.byName['lowerLeg' + suffix].body;
        const upperRotation = upper.rotation(),
            upperInverse = this._conj(upperRotation);
        let hip = this._qmul(this._conj(rootRotation), upperRotation);
        if (hip.w < 0) hip = { x: -hip.x, y: -hip.y, z: -hip.z, w: -hip.w };
        const pitch = 2 * Math.asin(this._clamp(hip.x, -1, 1)),
            spread = 2 * Math.asin(this._clamp(hip.z, -1, 1));
        // 상대 각속도(허벅지 좌표) ω에서 상대 사원수의 변화율 ½ q ⊗ ω를 얻고, 허수부 = sin(각/2)를 미분해 각속도로 바꾼다.
        const omega = this._rotate(upperInverse, this._sub(upper.angvel(), rootAngularVelocity));
        const rateX = 0.5 * (hip.w * omega.x + hip.y * omega.z - hip.z * omega.y),
            rateZ = 0.5 * (hip.w * omega.z + hip.x * omega.y - hip.y * omega.x);
        const bend = this._qmul(upperInverse, lower.rotation());
        const knee = 2 * Math.atan2(bend.x * Math.sign(bend.w || 1), Math.abs(bend.w));
        const kneeRate = this._rotate(upperInverse, this._sub(lower.angvel(), upper.angvel())).x;
        const inside = knee > model.kneeMin && knee < model.kneeMax;
        return {
            position: [pitch, spread, this._clamp(knee, model.kneeMin, model.kneeMax)],
            velocity: [
                (2 * rateX) / Math.max(1e-6, Math.cos(pitch / 2)),
                (2 * rateZ) / Math.max(1e-6, Math.cos(spread / 2)),
                inside ? kneeRate : 0,
            ],
        };
    }

    /**
     * 지금부터 time초 뒤까지 엉덩이가 가는 거리(offset)와 그때의 엉덩이 속도(velocity)의 예상(세계 좌표). 차는 선수는 디딤발로 서서 차므로, 지금 몸 속도
     * (차는 다리를 뺀 몸, _supportVelocity)의 수평 성분이 이동 제어(_groundMovement)의 movementAcceleration 비율로 0까지 줄어든다고 본다.
     * 수직은 서 있는 높이를 유지한다고 본다. 이동 입력은 넣지 않는다: 누르는 순간의 입력은 휘두르는 동안 바뀌어(AI는 차기 시작하면 멈춘다) 예상을 더 틀리게 한다.
     */
    _hipTravel(p, suffix, time) {
        const velocity = this._supportVelocity(p, suffix),
            rate = p.settings.movementAcceleration,
            decay = Math.exp(-rate * time);
        velocity.y = 0;
        return {
            offset: this._mul(velocity, (1 - decay) / rate),
            velocity: this._mul(velocity, decay),
        };
    }

    /**
     * 접촉 조건을 다리 계획의 좌표로 바꾼다: 접촉 순간 발목 자리(target.ankle)와 발 속도(target.velocity, 둘 다 세계 좌표)를, 접촉 때의 엉덩이 예상
     * (travel: 지금 엉덩이에서 간 거리 offset과 그때의 속도 velocity)과 몸 예상(body: 접촉 순간의 골반 방향 rotation과 각속도 angularVelocity) 기준
     * 골반 좌표로 옮긴다. 서서 차는 지상 토스는 몸이 돌지 않아 지금 방향·각속도 0이고, 공중 차기는 몸 회전 기준 궤적의 접촉 순간 값이다 — 한 계산이다.
     * 발 속도는 발목이 엉덩이 둘레를 도는 몫(swing)과 엉덩이에서 멀어지거나 가까워지는 몫(reach)으로 나눠 준다(legPlanSolve가 못 내는 몫을 reach부터 줄인다).
     * hipVelocity는 접촉 때 엉덩이 예상 속도에 몸 회전이 발목 자리에서 내는 속도를 더한 세계 좌표 속도다(발 속도 = hipVelocity + 골반 좌표 다리 속도를 세계로 돌린 것).
     */
    _tossContactJoints(p, suffix, target, travel, body) {
        const hip = this._point(p.root, this._hipAnchor(suffix)),
            inverse = this._conj(body.rotation);
        const offset = this._sub(this._sub(target.ankle, hip), travel.offset),
            spin = this._cross(body.angularVelocity, offset);
        const ankle = this._rotate(inverse, offset),
            velocity = this._rotate(
                inverse,
                this._sub(this._sub(target.velocity, travel.velocity), spin),
            );
        const outward = this._unit(ankle),
            away = this._mul(outward, this._dot(velocity, outward));
        return {
            ankle,
            swing: this._sub(velocity, away),
            reach: away,
            hipVelocity: this._add(travel.velocity, spin),
        };
    }

    /** 서서 차는 지상 토스의 접촉 조건: 접촉 발목 자리·속도, 엉덩이 예상(_hipTravel), 몸은 지금 방향에서 돌지 않는다. */
    _groundContactJoints(p, suffix, contact, remaining, rootRotation) {
        return this._tossContactJoints(
            p,
            suffix,
            {
                ankle: this._add(contact.point, this._ankleOffset(contact)),
                velocity: contact.velocity,
            },
            this._hipTravel(p, suffix, remaining),
            { rotation: rootRotation, angularVelocity: this._v() },
        );
    }

    /**
     * 서서 차는 지상 토스의 휘두르기 길이(초): 지금 관절 상태에서 접촉 관절 상태까지 가는 곡선이 구동 한계(모터 최대 토크·발-골반 힘·발 속도 한계)를
     * 가장 덜 쓰는 길이다(legPlanSolve의 lead, minPlanTime ~ strokeLeadMs 안). 휘두르기 시작(_strokeDue)이 쓴다.
     */
    _strokeLead(p, input) {
        const rootRotation = p.root.rotation(),
            suffix = this._kickSide(p, true, p.root.translation(), rootRotation);
        const strike = this._tossContact(
            p,
            input,
            this.ball.translation(),
            this.ball.linvel(),
            true,
        );
        const model = this._legPlanModel(
            p,
            suffix,
            rootRotation,
            1 - this._reactionWeight(p) * p.settings.drive.reaction.muscleLoss,
        );
        const state = this._legJointState(p, suffix, rootRotation, p.root.angvel(), model);
        const contact = this._groundContactJoints(p, suffix, strike, strike.duration, rootRotation);
        return legPlanSolve(model, state, contact, Infinity, this.settings.legPlan).lead;
    }

    /**
     * 지상 토스(받기·세트·서브)의 발이 공 도착보다 가장 일찍 움직이기 시작하는 시간(초). 이보다 일찍 누르면 결과가 같고, 늦게 누르면 남은 시간만큼만 휘두른다.
     * AI가 누를 시각을 정할 때 읽는다.
     */
    groundTossLead() {
        return this.settings.groundToss.strokeLeadMs / 1000;
    }

    /**
     * 관절 계획의 한 걸음. 두 가지를 따로 낸다.
     * - 앞먹임: 계획이 세운 관절 기준 궤적(joints: 각·각속도·각가속도)에서만 낸다. 기준 상태를 접촉 관절 상태(joints.end)로 가는 곡선(legCurve) 위에서 걸음 끝 시각까지
     *   나아가고(기준 상태의 시각 joints.at부터. 구동이 빠진 걸음이 있어도 같은 곡선 위다), 그 상태가 요구하는 토크를 모터 몫과 발-골반 힘 몫으로 나눈다(legActuation). 이 궤적은 계획 때 한계 검사를 거친 매끄러운 곡선이다(한계 안의 계획을 못 찾으면 원래 요청 그대로이고, 그때는 실제로 거는 토크·힘이 상한에서 잘린다).
     *   접촉 시각 뒤에는 기준이 끝 상태에 머문다: followThrough 동안은 접촉 순간의 각·각속도·각가속도 그대로이고(발이 계획보다 조금 늦게 닿아도 앞먹임이
     *   접촉 순간의 값으로 이어진다), 그 뒤에는 각속도·각가속도가 0이다. 끝 상태는 계획이 정한 값이다. 관절 각을 접촉 뒤로 늘여 가지 않는다
     *   (관절 좌표를 각속도로 늘이면 엉덩이 회전이 좌표가 나타낼 수 있는 영역 |굽힘| + |벌림| ≤ π를 벗어난다). 따라 차기는 발목 목표가 맡는다
     *   (_jointTossAnkle: 접촉점에서 계획의 발 속도로 곧게). 기준 다리는 계획 때의 골반 방향(plan.rotation)에서 본 것이라 모델의 중력 방향과
     *   발-골반 힘 방향도 그 방향 기준이다.
     * - 되먹임 목표: 기준은 계획을 세울 때의 골반 방향과 내다본 엉덩이 기준이라, 실제 골반이 다르게 움직인 만큼 발목 목표를 고치고(_jointTossAnkle), 발등이
     *   계획 속도로 닿게 발의 회전 몫을 빼고(_groundStrokeVelocity), 다리가 닿는 거리 안으로 자른다(_reachLimited). 그 하나의 발목 목표(자리·속도)에서
     *   모터 기준(관절 각·각속도)과 발-골반 힘의 목표가 같이 나온다. 고친 목표를 미분해 앞먹임을 만들지 않는다: 몸 움직임으로 고치는 몫과 그 가속은 되먹임이 맡는다.
     * 돌려주는 값: 모터 기준(joints: 관절 각·각속도와 모터 앞먹임 토크), 발목 목표(target·velocity, 세계 좌표), 발-골반 힘 앞먹임(force).
     */
    _jointTossPath(p, plan, body, dt) {
        const toss = this.settings.groundToss,
            suffix = p.kick.side,
            joints = plan.joints;
        const { pos, vel, rootRotation, rootAngularVelocity, muscleResponse } = body;
        const model = this._legPlanModel(p, suffix, plan.rotation, muscleResponse);
        const elapsed = this.time - plan.startedAt,
            remaining = plan.duration - elapsed,
            after = elapsed + dt - plan.duration;
        if (remaining > dt)
            legPlanAdvance(
                joints,
                joints.end,
                plan.startedAt + plan.duration - joints.at,
                this.time + dt - joints.at,
            );
        else
            for (let j = 0; j < 3; j++) {
                joints.position[j] = joints.end.position[j];
                const following = after < toss.followThrough;
                joints.velocity[j] = following ? joints.end.velocity[j] : 0;
                joints.acceleration[j] = following ? joints.end.acceleration[j] : 0;
            }
        joints.at = this.time + dt;
        const knee = this._clamp(joints.position[2], model.kneeMin, model.kneeMax);
        if (knee !== joints.position[2]) {
            joints.position[2] = knee;
            joints.velocity[2] = 0;
            joints.acceleration[2] = 0;
        }
        // 앞먹임: 기준 궤적의 관절 상태가 요구하는 토크를 모터와 발-골반 힘에 나눈다.
        const actuation = { motor: [0, 0, 0], force: this._v() };
        legActuation(
            model,
            joints.position,
            joints.velocity,
            legTorques(model, joints.position, joints.velocity, joints.acceleration),
            actuation,
        );
        // 걸음 끝의 엉덩이 예상 자리(풀린 속도로 한 걸음)와 몸 속도.
        const hip = this._point(p.root, this._hipAnchor(suffix)),
            hipVelocity = this._add(vel, this._cross(rootAngularVelocity, this._sub(hip, pos))),
            frame = {
                hip: this._add(hip, this._mul(hipVelocity, dt)),
                velocity: this._supportVelocity(p, suffix),
            };
        const ankle = this._jointTossAnkle(p, plan, model, frame, after);
        // 계획의 접촉 속도는 발등의 속도다. 발이 돌고 있으면 발등과 발목의 속도가 다르므로 그 차이를 발목 목표에서 뺀다(접촉 직전 strokeTime 동안 점점 크게).
        const foot = p.byName['foot' + suffix];
        ankle.velocity = this._groundStrokeVelocity(
            p,
            foot,
            this._point(foot.body, this._v(0, 0.065, -0.085)),
            ankle.velocity,
            dt,
        );
        // 지금 골반 좌표의 발목 목표: 골반이 도는 속도만큼 상대 속도를 빼고, 다리가 닿는 거리 안으로 자른다. 모터와 발-골반 힘이 이 같은 목표를 따른다.
        const inverse = this._conj(rootRotation),
            reach = this._reachLimited(
                model,
                this._rotate(inverse, ankle.offset),
                this._rotate(
                    inverse,
                    this._sub(ankle.velocity, this._cross(rootAngularVelocity, ankle.offset)),
                ),
            );
        const position = legJoints(model, reach.offset),
            velocity = legJointVelocity(model, position, reach.velocity),
            offset = this._rotate(rootRotation, reach.offset);
        return {
            target: this._add(frame.hip, offset),
            velocity: this._add(
                frame.velocity,
                this._add(
                    this._rotate(rootRotation, reach.velocity),
                    this._cross(rootAngularVelocity, offset),
                ),
            ),
            normal: plan.normal,
            joints: { position, velocity, torque: actuation.motor },
            // 다리가 거의 곧으면 모터의 모자란 몫을 내는 발목 힘이 끝없이 커진다. 실제로 걸 수 있는 크기까지만 앞먹인다.
            force: this._limit(this._rotate(plan.rotation, actuation.force), model.footForce),
        };
    }

    /**
     * 엉덩이 기준 발목 자리·속도(골반 좌표)를 다리가 닿는 거리(reachMin ~ reachMax) 안으로 자른다. 거리 밖이면 그 거리의 자리로 옮기고,
     * 거리 밖으로 더 나가는 속도 몫을 뺀다(다리는 그 이상 펴지거나 접히지 못한다).
     */
    _reachLimited(model, offset, velocity) {
        const length = this._length(offset);
        if (length < 1e-9) return { offset, velocity };
        const outward = this._mul(offset, 1 / length),
            leaving = this._dot(velocity, outward);
        // 한계에 닿았거나 넘은 자리에서는 그 밖으로 나가는 속도 몫이 없다(한계에 정확히 있는 자리도 같다).
        const blocked =
            (length >= model.reachMax && leaving > 0) || (length <= model.reachMin && leaving < 0);
        return {
            offset: this._mul(outward, this._clamp(length, model.reachMin, model.reachMax)),
            velocity: blocked ? this._sub(velocity, this._mul(outward, leaving)) : velocity,
        };
    }

    /**
     * 걸음 끝 시각의 발목 목표: 엉덩이에서 발목까지의 벡터(offset)와 엉덩이에 대한 발목 속도(velocity). 모두 세계 좌표 축이다.
     * after는 걸음 끝이 접촉 시각을 지난 시간(초, 음수면 아직 전)이다.
     * 접촉 전: 기준 발목(관절 기준의 순기구학)을 계획을 세울 때의 골반 방향(plan.rotation)으로 놓는다. 골반이 기울거나 돌아도 다리는 세계 좌표에서 계획한 방향으로 간다.
     *   거기에, 지금 다시 내다본 접촉 순간의 발목 자리·속도(실제 엉덩이 기준)와 계획 때 내다본 것의 차이를 더한다. 더하는 비율은 진행도 u의 3u² − 2u³로
     *   0에서 1까지 매끄럽게 커진다. 그래서 몸이 계획과 다르게 움직여도 접촉 시각에는 발목이 세계 좌표의 접촉점·접촉 속도에 맞고, 남은 시간이 줄어도 고치는 양이
     *   급해지지 않는다(끝점을 걸음마다 다시 풀면 남은 시간에 반비례해 가속이 커진다).
     * 접촉 뒤: 세계 좌표의 접촉점에서 계획의 발 속도로 곧게 나아간 자리. followThrough 뒤에는 그 자리에 멈춘다. 다리가 닿는 거리 밖으로 나가는 몫은
     *   _reachLimited가 자르고, 관절 목표는 그 자리의 역기구학이라 늘 유효한 관절 각이다.
     */
    _jointTossAnkle(p, plan, model, frame, after) {
        const suffix = p.kick.side,
            joints = plan.joints,
            toss = this.settings.groundToss;
        const contact = this._add(plan.point, this._ankleOffset(plan)),
            planned = (local) => this._rotate(plan.rotation, local);
        const reached = planned(legAnkle(model, joints.end.position)),
            stroke = planned(legAnkleVelocity(model, joints.end.position, joints.end.velocity));
        if (after >= 0)
            // 접촉 뒤: 세계 좌표의 접촉점에서 계획의 발 속도(엉덩이 속도 예상 + 엉덩이에 대한 발목 속도)로 followThrough 동안 곧게 나아가다 멈춘다.
            return {
                offset: this._sub(
                    this._add(
                        contact,
                        this._mul(plan.velocity, Math.min(after, toss.followThrough)),
                    ),
                    frame.hip,
                ),
                velocity: this._sub(
                    after < toss.followThrough ? plan.velocity : this._v(),
                    frame.velocity,
                ),
            };
        const travel = this._hipTravel(p, suffix, -after);
        const shift = this._sub(this._sub(this._sub(contact, frame.hip), travel.offset), reached);
        const rate = this._sub(this._sub(plan.velocity, travel.velocity), stroke);
        const u = 1 + after / plan.duration,
            weight = u * u * (3 - 2 * u),
            weightRate = (6 * u * (1 - u)) / plan.duration;
        return {
            offset: this._add(planned(legAnkle(model, joints.position)), this._mul(shift, weight)),
            velocity: this._add(
                planned(legAnkleVelocity(model, joints.position, joints.velocity)),
                this._add(this._mul(rate, weight), this._mul(shift, weightRate)),
            ),
        };
    }

    /** 받는 발의 접촉 높이: 슬라이드는 그 받기 점 높이, 나머지는 groundToss.contactHeight. */
    _receiveHeight(p) {
        return p.receive?.mode === 'slide' && p.receive.phase !== 'recover'
            ? p.receive.point.y
            : this.settings.groundToss.contactHeight;
    }

    /** 공이 받는 발의 접촉 높이로 내려오기까지 남은 시간(초, 포물선). */
    _receiveArrival(p, ballPos, ballVel) {
        const g = this.settings.gravity;
        const disc = ballVel.y * ballVel.y + 2 * g * (ballPos.y - this._receiveHeight(p));
        return (ballVel.y + Math.sqrt(Math.max(0, disc))) / g;
    }

    /** 공이 접촉 높이에 오는 시각·위치·속도와, 목표 선수에게 보낼 패스에 필요한 공 속도. */
    _predictReceivePass(p, input, ballPos, ballVel, standing) {
        const s = this.settings,
            toss = this.settings.groundToss;
        const height = this._receiveHeight(p);
        // 계획 길이 = 지금부터 공 도착까지(최소 minPlanTime). 일찍 누른 발은 기다렸다가(_armGroundToss) 시작한다.
        // 몸을 던지는 받기는 strokeLeadMs를 넘지 않는다.
        const duration = this._clamp(
            this._receiveArrival(p, ballPos, ballVel),
            toss.minPlanTime,
            standing ? Infinity : toss.strokeLeadMs / 1000,
        );
        const incoming = { x: ballVel.x, y: ballVel.y - s.gravity * duration, z: ballVel.z };
        const impact = this._add(ballPos, this._mul(ballVel, duration));
        impact.y -= 0.5 * s.gravity * duration * duration;
        const attacking = takrawIsAttacker(input.tossTarget.playerId);
        // 서브 목표(playerId -1)는 동료에게 주는 패스가 아니라 상대 코트 바닥으로 보내는 공이다: 꼭짓점 serveApex를 지나 serveHeight로 내려오는 포물선.
        const serving = input.tossTarget.playerId === -1;
        const goalHeight = serving ? toss.serveHeight : attacking ? toss.attackHeight : height;
        const apex = serving
            ? Math.max(toss.serveApex, impact.y + 0.6)
            : attacking
              ? toss.attackApex
              : toss.receiveApex;
        const upSpeed = Math.sqrt(2 * s.gravity * Math.max(toss.minRise, apex - impact.y));
        const flight =
            (upSpeed +
                Math.sqrt(
                    Math.max(0, upSpeed * upSpeed + 2 * s.gravity * (impact.y - goalHeight)),
                )) /
            s.gravity;
        const wanted = {
            x: (input.tossTarget.x - impact.x) / flight,
            y: upSpeed,
            z: (input.tossTarget.z - impact.z) / flight,
        };
        return { duration, incoming, impact, attacking, wanted };
    }

    /**
     * 받기·세트·서브의 발: 가운데를 맞혔을 때 공이 목표 선수(또는 서브 목표)로 가는 속도 변화가 발이 공으로 향하는 방향(approach)과
     * 세기다. 닿는 면은 그 방향과 조준으로 aimedContact가 정하고, 발의 유효 질량·반발로 그 세기를 낼 발 속도를 approach 방향으로 낸다.
     */
    _receiveStrike(p, wanted, incoming, impact, aim) {
        const s = this.settings,
            toss = this.settings.groundToss;
        // Precontact foot targets only; no ball impulse or velocity assignment.
        // The estimated collision normal and speed guide the articulated foot;
        // its finite reach, force, orientation and actual collision decide the pass.
        const delta = this._sub(wanted, incoming),
            approach = this._unit(delta, this._v(0, 1, 0));
        const contactFoot = p.byName['foot' + p.kick.side];
        const mass = contactFoot.body.mass(),
            extent = contactFoot.halfExtents;
        const pitchInertia = (mass * (extent.y * extent.y + extent.z * extent.z)) / 3;
        const contactMass = 1 / (1 / mass + (toss.forefoot * toss.forefoot) / pitchInertia);
        const transfer = contactMass / (contactMass + s.ballMass);
        const strikeSpeed = this._length(delta) / ((1 + s.ballRestitution) * transfer);
        const { normal, surface } = this.aimedContact(p, impact, approach, aim);
        const velocity = this._add(incoming, this._mul(approach, strikeSpeed));
        return { normal, surface, approach, velocity };
    }

    /** 따라 차기를 마친 발을 엉덩이 아래 뒤쪽으로 거둔다. */
    _retractReceiveFoot(p, plan, dt) {
        const s = this.settings,
            toss = this.settings.groundToss;
        // Finish the bounded physical follow-through, then retract below the
        // hip. A held button must not sweep through the departing ball again.
        const root = p.root.translation(),
            direction = p.receive.direction;
        const target = {
            x: root.x - direction.x * toss.retract.back,
            y: toss.retract.height,
            z: root.z - direction.z * toss.retract.back,
        };
        const velocity = this._sub(
            this._bodyVelocity(p),
            this._mul(
                direction,
                (toss.followThrough * s.groundKickSpeed) / Math.max(dt, toss.strokeTime),
            ),
        );
        return { target, velocity, normal: plan.normal };
    }

    /** 몸을 던지는 받기(슬라이드 제외): 준비 궤적 → 공을 따라가며 접근 속도를 쌓는 스트로크 → 따라 차기, 발등 밀기 제어. */
    _dynamicReceivePath(p, plan, ballVel, dt) {
        const s = this.settings,
            toss = this.settings.groundToss;
        const elapsed = this.time - plan.startedAt + dt,
            terminal = Math.min(toss.strokeTime, plan.duration * 0.5);
        // 발은 조준과 상관없이 approach 방향으로 공에 다가간다(조준은 닿는 면만 바꾼다).
        const prepDuration = Math.max(dt, plan.duration - terminal),
            closing = this._dot(this._sub(plan.velocity, plan.incoming), plan.approach);
        const prep = this._sub(
            this._sub(plan.point, this._mul(plan.incoming, terminal)),
            this._mul(plan.approach, closing * terminal * 0.5),
        );
        prep.y -= 0.5 * s.gravity * terminal * terminal;
        const incoming = this._add(plan.incoming, this._v(0, s.gravity * terminal, 0));
        const u = this._clamp(elapsed / prepDuration, 0, 1),
            u2 = u * u,
            u3 = u2 * u;
        let target = this._add(
            this._add(
                this._mul(plan.start, 2 * u3 - 3 * u2 + 1),
                this._mul(plan.startVelocity, prepDuration * (u3 - 2 * u2 + u)),
            ),
            this._add(
                this._mul(prep, -2 * u3 + 3 * u2),
                this._mul(incoming, prepDuration * (u3 - u2)),
            ),
        );
        let velocity = this._add(
            this._add(
                this._mul(plan.start, (6 * u2 - 6 * u) / prepDuration),
                this._mul(plan.startVelocity, 3 * u2 - 4 * u + 1),
            ),
            this._add(
                this._mul(prep, (-6 * u2 + 6 * u) / prepDuration),
                this._mul(incoming, 3 * u2 - 2 * u),
            ),
        );
        if (elapsed >= prepDuration && elapsed < plan.duration) {
            const remaining = plan.duration - elapsed;
            target = this._sub(
                this._sub(plan.point, this._mul(plan.incoming, remaining)),
                this._mul(
                    plan.approach,
                    closing * remaining - (0.5 * closing * remaining * remaining) / terminal,
                ),
            );
            target.y -= 0.5 * s.gravity * remaining * remaining;
            velocity = this._add(
                this._add(plan.incoming, this._v(0, s.gravity * remaining, 0)),
                this._mul(plan.approach, closing * (1 - remaining / terminal)),
            );
        } else if (elapsed >= plan.duration) {
            const follow = Math.min(elapsed - plan.duration, toss.followThrough),
                fraction = follow / toss.followThrough;
            target = this._add(plan.point, this._mul(plan.velocity, follow * (1 - 0.5 * fraction)));
            velocity = this._mul(plan.velocity, 1 - fraction);
        }
        const contactDrive =
            p.receive?.hitAt === null && elapsed < plan.duration + toss.followThrough
                ? this._instepDrive(
                      p,
                      plan.normal,
                      Math.max(0, this._dot(this._sub(plan.velocity, ballVel), plan.normal)),
                      toss.forefoot,
                      s.receive,
                  )
                : null;
        return { target, velocity, normal: plan.normal, contactDrive };
    }

    /** 슬라이드로 올리는 세트: 끝점 속도를 패스 속도로 둔 하나의 연속 접근 궤적. */
    _cushionReceivePath(plan, dt) {
        const toss = this.settings.groundToss;
        // Cushion receptions and high sets share a continuous approach, with
        // endpoint velocity for the intended pass instead of a late hard swing.
        const elapsed = this.time - plan.startedAt + dt;
        const duration = plan.duration;
        const point = plan.point;
        const u = this._clamp(elapsed / duration, 0, 1),
            u2 = u * u,
            u3 = u2 * u;
        const start = plan.start,
            initialVelocity = plan.startVelocity,
            endVelocity = plan.velocity;
        let target = this._add(
            this._add(
                this._mul(start, 2 * u3 - 3 * u2 + 1),
                this._mul(initialVelocity, (u3 - 2 * u2 + u) * duration),
            ),
            this._add(
                this._mul(point, -2 * u3 + 3 * u2),
                this._mul(endVelocity, (u3 - u2) * duration),
            ),
        );
        let velocity = this._add(
            this._add(
                this._mul(start, (6 * u2 - 6 * u) / duration),
                this._mul(initialVelocity, 3 * u2 - 4 * u + 1),
            ),
            this._add(
                this._mul(point, (-6 * u2 + 6 * u) / duration),
                this._mul(endVelocity, 3 * u2 - 2 * u),
            ),
        );
        let acceleration = this._add(
            this._add(
                this._mul(start, (12 * u - 6) / (duration * duration)),
                this._mul(initialVelocity, (6 * u - 4) / duration),
            ),
            this._add(
                this._mul(point, (-12 * u + 6) / (duration * duration)),
                this._mul(endVelocity, (6 * u - 2) / duration),
            ),
        );
        if (elapsed >= plan.duration) {
            const follow = Math.min(elapsed - plan.duration, toss.followThrough);
            target = this._add(plan.point, this._mul(plan.velocity, follow));
            velocity = elapsed - plan.duration < toss.followThrough ? plan.velocity : this._v();
            acceleration = this._v();
        }
        return { target, velocity, acceleration, normal: plan.normal };
    }

    /** 나머지 받기(슬라이드): 접촉 직전 짧은 스트로크로 패스 속도까지 가속한다. */
    _strokeReceivePath(p, plan, ballVel, dt) {
        const s = this.settings,
            toss = this.settings.groundToss;
        // A plan created after recovery starts now, retaining the first-physics-step drive.
        const elapsed = this.time - plan.startedAt + dt;
        const stroke = Math.min(toss.strokeTime, plan.duration * toss.strokeFraction);
        const beforeStroke = plan.duration - stroke;
        const clock = this._clamp(elapsed - beforeStroke, 0, stroke);
        const prep = this._sub(plan.point, this._mul(plan.velocity, 0.5 * stroke));
        let target = this._add(prep, this._mul(plan.velocity, (0.5 * clock * clock) / stroke));
        let velocity = this._mul(plan.velocity, clock / stroke);
        if (elapsed > beforeStroke && elapsed < plan.duration) {
            velocity = this._add(
                velocity,
                this._mul(plan.velocity, toss.accelerationMass / (stroke * toss.velocityGain)),
            );
        }
        if (elapsed >= plan.duration) {
            target = this._add(
                plan.point,
                this._mul(plan.velocity, Math.min(elapsed - plan.duration, toss.followThrough)),
            );
        }
        const contactDrive =
            plan.dynamicReceive &&
            p.receive?.hitAt === null &&
            elapsed < plan.duration + toss.followThrough
                ? this._instepDrive(
                      p,
                      plan.normal,
                      Math.max(0, this._dot(this._sub(plan.velocity, ballVel), plan.normal)),
                      toss.forefoot,
                      s.receive,
                  )
                : null;
        return { target, velocity, normal: plan.normal, contactDrive };
    }

    _receiveImpact(p, partName, before) {
        const s = p.settings,
            sample = before.players[p.id].parts[partName];
        const relative = this._sub(before.ballVelocity, sample.velocity);
        const speed = Math.min(this._length(before.ballVelocity), this._length(relative));
        const incoming = before.lastBallTouch
            ? before.lastBallTouch.team !== p.team
            : before.ballVelocity.x * p.toward < -0.5;
        const closing = this._dot(
            relative,
            this._unit(this._sub(sample.position, before.ballPosition)),
        );
        // Only a fast incoming reception loses actuator strength. Own-team sets and
        // airborne attacking kicks do not trigger this response. No impact is added.
        if (
            !incoming ||
            p.kick.mode === 'air' ||
            before.ballPosition.x * p.toward > 0.2 ||
            speed <= s.receptionMinSpeed ||
            closing < 2
        )
            return 0;
        const severity =
            Math.pow(
                this._clamp(
                    (speed - s.receptionMinSpeed) /
                        Math.max(0.1, s.receptionFullSpeed - s.receptionMinSpeed),
                    0,
                    1,
                ),
                0.65,
            ) *
            (1 - p.effects.defense);
        const duration = 0.2 + (s.receptionMaxDuration - 0.2) * severity;
        p.reaction = {
            remaining: Math.max(p.reaction.remaining, duration),
            duration: Math.max(p.reaction.duration, duration),
            severity: Math.max(p.reaction.remaining > 0 ? p.reaction.severity : 0, severity),
            incomingSpeed: speed,
        };
        return severity;
    }

    /**
     * 이번 틱을 잘게(simulation.kickStepMs 걸음) 돌려야 하는지. 버튼을 누르고 있다는 사실이 아니라 걸음 크기에 민감한 구간에만 참이다. 어느 선수든
     * - 발차기·점프 버튼을 누르기 시작했거나 발차기 버튼을 뗀 틱이거나(이 틱 첫 걸음에 차기 계획 시작, 도약 충격량과 첫 추진, 다리 거두기 전환이 들어간다),
     * - 차는 발이 공에 닿을 예정이 창(simulation.fineContactWindowMs) 안이거나(_kickContactIn),
     * - 공을 맞힌 뒤 따라 차기 시간(groundToss.followThrough) 안일 때.
     * 지상 토스(슬라이드 받기 제외)는 발이 공 도착 strokeLeadMs 전에야 움직이므로(_armGroundToss), 계획이 없는 동안은 누름·뗌 틱과 700 ms 창을 치지 않고
     * 공 도착이 strokeLeadMs + 한 틱 안인 틱부터 잘게 돈다. 휘두르기 길이는 걸음마다 자세에 따라 다시 계산되지만 strokeLeadMs를 넘지 않으므로,
     * 가장 긴 길이를 기준으로 삼으면 휘두르기는 늘 잘게 도는 틱 안에서 시작된다(그 틱에 계산한 길이를 쓰면 틱 안에서 자세가 바뀌어 굵은 걸음에 시작하는 일이 있었다).
     * 도착 시간은 휘두르기 시작 판정(_strokeDue)과 같은 계산(_receiveArrival)이다.
     * 그래서 일찍 누른 시각도, 기다리다 뗀 시각도 걸음 크기를 바꾸지 않는다.
     * 버튼을 누른 채 공이 멀리 있거나 이미 맞히고 지나간 동안, 도약 뒤 떠 있는 동안은 굵은 걸음이다(v0.26.3).
     * 물리 상태와 이번 틱 입력만 읽으므로 같은 상태·입력이면 늘 같은 답이다(롤백·리플레이에서 같은 걸음으로 다시 돈다).
     */
    fineStepNeeded(inputs = []) {
        const follow = this.settings.groundToss.followThrough,
            window = this.settings.fineContactWindowSeconds,
            tick = this.settings.tickSeconds;
        for (const p of this.players) {
            const input = inputs[p.id];
            // 계획이 아직 없는 지상 토스: 누르고 있거나(이 틱에 누르기 시작하는 것 포함) 기다리다 이 틱에 뗀 것. 발이 아직 디딤발이라 누름·뗌 틱에 바뀌는 것이 없다.
            // 슬라이드는 누른 걸음에 몸을 던지므로 빼고 이전 조건을 그대로 쓴다.
            const waiting =
                this._tossing(input) &&
                !p.kick.receivePlan &&
                !input.jump &&
                !input.jumpPressed &&
                input.receive?.mode !== 'slide' &&
                p.receive?.mode !== 'slide' &&
                (p.kick.mode === 'ground' ||
                    (!!input.kick && p.kick.mode === 'none' && p.grounded));
            if (
                input?.jumpPressed ||
                this.time - p.lastTouch < follow ||
                (waiting
                    ? this._receiveArrival(p, this.ball.translation(), this.ball.linvel()) <=
                      this.settings.groundToss.strokeLeadMs / 1000 + tick
                    : input?.kickPressed ||
                      (p.kick.held && !input?.kick) ||
                      this._kickContactIn(p) <= window)
            )
                return true;
        }
        return false;
    }

    /**
     * 차는 발이 공에 닿기까지 남은 시간(초)의 예측. 차는 중이 아니거나 닿을 예정이 없으면 Infinity다.
     * 공중 차기는 계획의 남은 준비 시간(airPlan.remaining)이고, 맞힌 뒤(follow)에는 예정이 없다.
     * 지상 차기는 공이 접촉 높이(groundToss.contactHeight)로 내려오기까지의 포물선 시간이다(받기 계획 _predictReceivePass와 같은 식).
     * 이미 그 아래에서 떠 있는 공은 0이고, 바닥에 놓인 공과 그 시간 안에 몸이 닿지 못할 자리로 오는 공은 예정이 없다. 맞고 올라간 공은 다시 내려올 때까지 멀다.
     */
    _kickContactIn(p) {
        if (p.kick.mode === 'air') {
            const plan = p.kick.airPlan;
            return plan && plan.phase !== 'follow' ? plan.remaining : Infinity;
        }
        if (p.kick.mode !== 'ground') return Infinity;
        const s = this.settings,
            ball = this.ball.translation(),
            velocity = this.ball.linvel();
        const drop = ball.y - s.groundToss.contactHeight;
        const time =
            drop > 0
                ? (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * s.gravity * drop)) /
                  s.gravity
                : ball.y > s.ballRadius * 2
                  ? 0
                  : Infinity;
        if (time === Infinity) return time;
        // 그 시간 안에 몸이 갈 수 있는 거리(슬라이딩 속도)와 뻗은 다리 길이로도 공이 오는 자리에 못 닿으면 예정이 없다.
        const root = p.root.translation(),
            reach =
                p.settings.receive.slideReach * p.settings.legStretch.maxScale +
                p.settings.movementSpeed * p.settings.receive.slide.speed * time;
        const away = Math.hypot(
            ball.x + velocity.x * time - root.x,
            ball.z + velocity.z * time - root.z,
        );
        return away <= reach ? time : Infinity;
    }

    step(dt, inputs = []) {
        this.restoredSnapshotBytes = null;
        // maxStepMs(config/physics.js)는 tickRate가 아니라 Rapier 한 번 적분에 허용하는 가장 긴 시간(검증한 한 걸음)이다. 이보다 긴 dt는 잘라서 적분한다(그만큼 시간이 버려진다).
        // 게임의 물리 한 걸음 simulation.stepMs가 이 상한을 넘으면 물리 생성이 실패한다(조용히 느려지지 않게). tickRate를 더 낮출 때 이 값을 함께 검증해 올린다.
        // 잘못된 dt(0·NaN)일 때는 게임 한 걸음(stepSeconds)을 쓴다.
        const h =
            Number.isFinite(dt) && dt > 0
                ? Math.min(dt, this.settings.maxStepSeconds)
                : this.settings.stepSeconds;
        this.world.integrationParameters.dt = h;
        const driven = this._sweptVelocities();
        for (const p of this.players) this._drivePlayer(p, inputs[p.id] || {}, h);
        const before = this._captureBefore();
        const started = this._resolveStartBallContacts(driven, h);
        const sweep = this._captureSweep();
        this.world.step(this.queue);
        this.time += h;
        const events = [],
            contactStarts = [...this.ballContacts.values()].filter(
                (contact) => contact.kind === 'player' && !contact.confirmed,
            );
        const confirmedTouches = new Set();
        // A start event may precede a CCD impulse. Pending contacts stay in the
        // active map until separation; transient start/stop pairs also survive in
        // this step's candidates so the force queue can still confirm their hit.
        const candidates = new Map(this.ballContacts),
            impulses = new Set();
        this._finishStartBallContacts(started, h, sweep);
        for (const { p, part } of started)
            this._recordSweptContact(p, part, contactStarts, candidates, impulses);
        this._sweepBallContacts(sweep, h, contactStarts, candidates, impulses);
        this._drainCollisions(events, contactStarts, candidates, before);
        this._collectBallImpulses(candidates, impulses);
        this._confirmTouches(impulses, candidates, contactStarts, confirmedTouches);
        this._emitTouches(events, contactStarts, confirmedTouches, before);
        return events;
    }

    /** world.step 직전의 공·선수 상태. 접촉 반응(_receiveImpact)·착지 속도·블로킹이 충돌 전 값을 읽는다. */
    _captureBefore() {
        return {
            ballPosition: { ...this.ball.translation() },
            ballVelocity: { ...this.ball.linvel() },
            lastBallTouch: this.lastBallTouch,
            players: this.players.map((p) => ({
                velocity: { ...p.root.linvel() },
                parts: Object.fromEntries(
                    p.parts.map((part) => [
                        part.name,
                        {
                            position: { ...part.body.translation() },
                            velocity: { ...part.body.velocityAtPoint(this.ball.translation()) },
                        },
                    ]),
                ),
            })),
        };
    }

    /** 공과의 접촉을 걸음 사이 경로로 직접 푸는 부위(config/physics.js ballContact.parts: 발·정강이). */
    _sweptPart(name) {
        return this.settings.ballContact.parts.some((prefix) => name.startsWith(prefix));
    }

    /** 구동 충격을 주기 전의 발·정강이 속도(직전 걸음 끝 값). _resolveStartBallContacts가 구동 한 칸 몫만 더할 때 쓴다. */
    _sweptVelocities() {
        const out = new Map();
        for (const p of this.players)
            for (const part of p.parts)
                if (this._sweptPart(part.name))
                    out.set(part, {
                        linear: { ...part.body.linvel() },
                        angular: { ...part.body.angvel() },
                    });
        return out;
    }

    /**
     * 걸음 안 비율 s에 처음 닿은 새 접촉을 풀 걸음 안 비율. v0.19.12(60틱 × 물리 걸음 2, Rapier)는 발이 CCD에 걸리지 않아 공에 들어간 뒤
     * 다음 걸음 시작(1000/120 ms 격자)에야 겹친 자리로 접촉을 풀었다. 그래서 걸음 시작부터 ballContact.delayMs 칸 경계 중 처음 닿은 뒤 첫 경계에서 푼다.
     * 1이면 이 걸음 끝 = 다음 걸음 시작이다. 걸음이 한 칸이면 늘 다음 걸음 시작이라 v0.19.12와 같다.
     */
    _contactDueFraction(s, h) {
        const cell = this.settings.ballContact.delayMs / 1000;
        return Math.min(1, (Math.ceil((s * h) / cell - 1e-9) * cell) / h);
    }

    /**
     * 걸음 시작(구동 충격 뒤, world.step 전)에 공과 겹친 새 접촉을 찾는다. v0.19.12의 Rapier는 겹친 다음 걸음에 이 접촉을 관절과 한 솔버에서 풀었다:
     * 반발 목표(접근 속도 × e)는 걸음 시작(구동 충격 뒤) 속도로 정하고, 그 목표를 관절이 푼 걸음 끝 발 속도에 대해 맞췄다.
     * 여기서는 접촉점(부위 국소)·법선·목표 분리 속도만 정하고, 충격은 world.step 뒤 _finishStartBallContacts가 준다.
     * 걸음이 한 칸(ballContact.delayMs)보다 길면 구동 충격 중 한 칸 몫만 접근 속도에 넣는다(Rapier가 본 속도는 직전 걸음 끝 + 한 칸 구동이다).
     */
    _resolveStartBallContacts(driven, h) {
        const radius = this.settings.ballRadius,
            share = Math.min(1, this.settings.ballContact.delayMs / 1000 / h),
            ball = this.ball,
            center = { ...ball.translation() },
            ballVelocity = { ...ball.linvel() },
            ballAngular = { ...ball.angvel() },
            ballCollider = this.world.getCollider(this.ballColliderHandle),
            found = [];
        for (const p of this.players)
            for (const part of p.parts) {
                if (!this._sweptPart(part.name) || this.ballContacts.has(part.colliderHandle))
                    continue;
                const body = part.body,
                    position = body.translation(),
                    rotation = body.rotation();
                const contact = this._shapeDistance(part, center, position, rotation);
                if (contact.distance > radius) continue;
                const before = driven.get(part),
                    blend = (u, v) => this._add(u, this._mul(this._sub(v, u), share));
                const linear = blend(before.linear, body.linvel()),
                    angular = blend(before.angular, body.angvel());
                const lever = this._sub(contact.point, position),
                    n = contact.normal,
                    arm = this._mul(n, -radius);
                const closing = this._dot(
                    this._sub(
                        this._add(ballVelocity, this._cross(ballAngular, arm)),
                        this._add(linear, this._cross(angular, lever)),
                    ),
                    n,
                );
                if (closing >= 0) continue;
                const restitution = Math.max(
                    ballCollider.restitution(),
                    this.world.getCollider(part.colliderHandle).restitution(),
                );
                found.push({
                    p,
                    part,
                    local: this._rotate(this._conj(rotation), lever),
                    normal: n,
                    separation: -restitution * closing,
                });
            }
        return found;
    }

    /**
     * _resolveStartBallContacts가 찾은 접촉에 world.step 뒤 충격을 준다. 충격 뒤 공과 걸음 끝 부위 접촉점의 상대 속도가 법선으로는 목표 분리 속도,
     * 접선으로는 0(마찰 원뿔 안)이 되게 푼다. 공은 이 걸음 내내 새 속도로 움직인 것으로 위치를 고친다(Rapier도 걸음 처음에 속도를 풀고 적분했다).
     */
    _finishStartBallContacts(found, h, sweep) {
        const radius = this.settings.ballRadius,
            ball = this.ball,
            mass = ball.mass(),
            inertia = 0.4 * mass * radius * radius;
        for (const item of found) {
            const body = item.part.body,
                rotation = body.rotation(),
                lever = this._rotate(rotation, item.local),
                point = this._add(body.translation(), lever);
            const ballVelocity = { ...ball.linvel() },
                ballAngular = { ...ball.angvel() };
            const impulse = this._ballContactImpulse(
                item.part,
                rotation,
                { normal: item.normal },
                lever,
                this._add(body.linvel(), this._cross(body.angvel(), lever)),
                ballVelocity,
                ballAngular,
                true,
                item.separation,
            );
            if (!impulse) continue;
            const change = this._mul(impulse, 1 / mass),
                arm = this._mul(item.normal, -radius);
            ball.setLinvel(this._add(ballVelocity, change), true);
            ball.setTranslation(this._add(ball.translation(), this._mul(change, h)), true);
            ball.setAngvel(
                this._add(ballAngular, this._mul(this._cross(arm, impulse), 1 / inertia)),
                true,
            );
            body.applyImpulseAtPoint(this._mul(impulse, -1), point, true);
            // 이 걸음의 경로 접촉(_sweepBallContacts)은 공이 처음부터 새 속도였던 것으로 보고, 이 부위는 다시 풀지 않는다.
            sweep.ball.linear = this._add(sweep.ball.linear, change);
            sweep.resolved.add(item.part);
        }
    }

    /**
     * 공과 부위 접촉의 공 쪽 충격(반발 + 마찰). contact.normal은 부위에서 공 쪽 법선, partVelocity는 부위 접촉점 속도.
     * separation(목표 분리 속도)을 주면 반발 목표 대신 그 값을 쓴다. 없으면 떨어지는 중일 때 null. 반발은 새 접촉에만(Rapier 결합 규칙 Max), 마찰은 평균. 질량은 공과 그 부위 두 몸체의 일반화 역질량이다.
     */
    _ballContactImpulse(
        part,
        rotation,
        contact,
        lever,
        partVelocity,
        ballVelocity,
        ballAngular,
        fresh,
        separation,
    ) {
        const radius = this.settings.ballRadius,
            n = contact.normal,
            arm = this._mul(n, -radius);
        const relative = this._sub(
            this._add(ballVelocity, this._cross(ballAngular, arm)),
            partVelocity,
        );
        const closing = this._dot(relative, n);
        if (separation === undefined && closing >= 0) return null;
        const ballCollider = this.world.getCollider(this.ballColliderHandle),
            partCollider = this.world.getCollider(part.colliderHandle);
        const restitution = fresh
                ? Math.max(ballCollider.restitution(), partCollider.restitution())
                : 0,
            friction = (ballCollider.friction() + partCollider.friction()) / 2;
        const ballMass = this.ball.mass(),
            ballInertia = 0.4 * ballMass * radius * radius;
        // 한 번에 푸는 3축 충격: 충격 뒤 상대 속도가 법선으로는 반발(-e × 접근), 접선으로는 0이 되게 한다(Rapier가 접촉·마찰·관절을 한 솔버에서
        // 같이 풀어 나오는 결과). 응답 행렬은 공(질량·회전) + 부위(_jointedResponse)이고, 법선 충격이 접선 속도를 바꾸는 몫도 들어간다.
        // 접선 충격이 마찰 원뿔(μ × 법선 충격)을 넘으면 원뿔 끝으로 줄인다.
        const response = this._jointedResponse(part, rotation, lever),
            spin = (radius * radius) / ballInertia;
        const k = response.slice();
        const axes = ['x', 'y', 'z'];
        for (let r = 0; r < 3; r++)
            for (let c = 0; c < 3; c++)
                k[r * 3 + c] +=
                    (r === c ? 1 / ballMass + spin : 0) - spin * n[axes[r]] * n[axes[c]];
        const inverse = this._mat3Inverse(k);
        if (!inverse) return null;
        const wanted = this._sub(this._mul(n, separation ?? -restitution * closing), relative);
        let impulse = this._mat3Apply(inverse, wanted);
        const normalImpulse = this._dot(impulse, n);
        if (normalImpulse <= 0) return null;
        const tangential = this._sub(impulse, this._mul(n, normalImpulse)),
            tangentSize = this._length(tangential),
            cone = friction * normalImpulse;
        if (tangentSize > cone)
            impulse = this._add(
                this._mul(n, normalImpulse),
                this._mul(tangential, cone / tangentSize),
            );
        return impulse;
    }

    /** world.step 직전의 공과 발·정강이 자세·속도(걸음 시작). 걸음 끝은 world.step 뒤 Rapier 값이다. */
    _captureSweep() {
        const ball = this.ball;
        const pose = (body) => ({
            position: { ...body.translation() },
            rotation: { ...body.rotation() },
            linear: { ...body.linvel() },
            angular: { ...body.angvel() },
        });
        const parts = [];
        for (const p of this.players)
            for (const part of p.parts)
                if (this._sweptPart(part.name)) parts.push({ p, part, start: pose(part.body) });
        return { ball: pose(ball), parts, resolved: new Set() };
    }

    /**
     * 공 중심 center에서 부위 형상(상자·캡슐, 자세 position·rotation)까지의 거리. 안쪽이면 음수(가장 얕은 면까지의 깊이).
     * point는 형상 표면의 가장 가까운 점, normal은 그 점에서 공 쪽을 향하는 단위 법선(월드)이다.
     */
    _shapeDistance(part, center, position, rotation) {
        const local = this._rotate(this._conj(rotation), this._sub(center, position));
        let point, normal, distance;
        if (part.shape === 'box') {
            const e = part.halfExtents;
            const q = {
                x: this._clamp(local.x, -e.x, e.x),
                y: this._clamp(local.y, -e.y, e.y),
                z: this._clamp(local.z, -e.z, e.z),
            };
            const d = this._sub(local, q),
                length = this._length(d);
            if (length > 1e-9) {
                distance = length;
                normal = this._mul(d, 1 / length);
                point = q;
            } else {
                // 중심이 상자 안: 가장 얕은 면으로 나간다.
                let axis = 'x',
                    depth = e.x - Math.abs(local.x);
                for (const key of ['y', 'z']) {
                    const value = e[key] - Math.abs(local[key]);
                    if (value < depth) {
                        axis = key;
                        depth = value;
                    }
                }
                const sign = local[axis] < 0 ? -1 : 1;
                distance = -depth;
                normal = { x: 0, y: 0, z: 0, [axis]: sign };
                point = { ...local, [axis]: sign * e[axis] };
            }
        } else {
            // 캡슐: 국소 y축 선분(±halfHeight)과 반지름.
            const axisPoint = {
                x: 0,
                y: this._clamp(local.y, -part.halfHeight, part.halfHeight),
                z: 0,
            };
            const d = this._sub(local, axisPoint),
                length = this._length(d);
            normal = length > 1e-9 ? this._mul(d, 1 / length) : { x: 1, y: 0, z: 0 };
            distance = length - part.radius;
            point = this._add(axisPoint, this._mul(normal, part.radius));
        }
        return {
            distance,
            point: this._add(position, this._rotate(rotation, point)),
            normal: this._rotate(rotation, normal),
            local: point,
        };
    }

    /** 걸음 안 비율 s(0~1)의 부위 자세: 위치는 직선, 회전은 정규화한 선형 보간(nlerp). 속도는 걸음 끝 값을 쓴다(_sweepBallContacts). */
    _sweepPose(entry, s) {
        const a = entry.start,
            b = entry.end;
        const lerp = (u, v) => ({
            x: u.x + (v.x - u.x) * s,
            y: u.y + (v.y - u.y) * s,
            z: u.z + (v.z - u.z) * s,
        });
        const q0 = a.rotation;
        let q1 = b.rotation;
        if (q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w < 0)
            q1 = { x: -q1.x, y: -q1.y, z: -q1.z, w: -q1.w };
        const q = {
            x: q0.x + (q1.x - q0.x) * s,
            y: q0.y + (q1.y - q0.y) * s,
            z: q0.z + (q1.z - q0.z) * s,
            w: q0.w + (q1.w - q0.w) * s,
        };
        const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
        return {
            position: lerp(a.position, b.position),
            rotation: { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n },
        };
    }

    /**
     * 공과 부위 하나가 [from, 1] 구간에서 처음 닿는 걸음 비율. 공 경로 ballAt(s), 부위 경로 _sweepPose로 거리 함수를 표본으로 훑고
     * 처음 닿은 칸을 이분법으로 좁힌다. from에서 이미 겹쳐 있으면 from이다. 닿지 않으면 null.
     */
    _firstContact(entry, ballAt, from) {
        const c = this.settings.ballContact,
            radius = this.settings.ballRadius;
        const gap = (s) => {
            const pose = this._sweepPose(entry, s);
            return (
                this._shapeDistance(entry.part, ballAt(s), pose.position, pose.rotation).distance -
                radius
            );
        };
        if (gap(from) <= 0) return from;
        // 표본 간격: 공과 부위의 상대 이동(회전은 형상 크기만큼의 호)이 sampleSpacing m를 넘지 않게.
        const a = entry.start,
            b = entry.end;
        const relative = this._length(
            this._sub(
                this._sub(ballAt(1), ballAt(from)),
                this._sub(b.position, this._sweepPose(entry, from).position),
            ),
        );
        const turn =
            2 *
            Math.sqrt(
                Math.max(
                    0,
                    1 -
                        Math.pow(
                            a.rotation.x * b.rotation.x +
                                a.rotation.y * b.rotation.y +
                                a.rotation.z * b.rotation.z +
                                a.rotation.w * b.rotation.w,
                            2,
                        ),
                ),
            );
        const reach =
            entry.part.shape === 'box'
                ? this._length(entry.part.halfExtents)
                : entry.part.halfHeight + entry.part.radius;
        const samples = this._clamp(
            Math.ceil((relative + turn * reach) / c.sampleSpacing),
            1,
            c.maxSamples,
        );
        let low = from;
        for (let k = 1; k <= samples; k++) {
            const high = from + ((1 - from) * k) / samples;
            if (gap(high) > 0) {
                low = high;
                continue;
            }
            let hi = high;
            for (let i = 0; i < c.bisection; i++) {
                const mid = (low + hi) / 2;
                if (gap(mid) > 0) low = mid;
                else hi = mid;
            }
            return hi;
        }
        return null;
    }

    /**
     * 발·정강이와 공의 접촉을 걸음 사이 경로로 직접 푼다. world.step은 이 쌍을 거른 채(충돌 그룹) 걸음 끝까지 적분했으므로,
     * 걸음 시작·끝 자세를 이어 처음 닿는 순간(TOI)·접촉점·법선을 찾고, 그 순간의 상대 속도로 반발(Rapier 결합 규칙 Max)·마찰(평균) 충격을
     * 공과 부위에 준 뒤 남은 걸음 동안 공을 다시 적분한다. 접촉은 Rapier 접촉과 같은 터치 확정 경로(contactStarts·candidates·impulses)로 넘긴다.
     * 같은 걸음에 다른 부위에 이어 닿을 수 있어 ballContact.maxContacts번까지 되풀이한다. 상태는 공·부위 Rapier 값과 ballContacts뿐이다.
     */
    _sweepBallContacts(sweep, h, contactStarts, candidates, impulses) {
        const c = this.settings.ballContact,
            radius = this.settings.ballRadius,
            g = this.settings.gravity;
        const ball = this.ball,
            ballCollider = this.world.getCollider(this.ballColliderHandle);
        const pose = (body) => ({
            position: { ...body.translation() },
            rotation: { ...body.rotation() },
            linear: { ...body.linvel() },
            angular: { ...body.angvel() },
        });
        for (const entry of sweep.parts) entry.end = pose(entry.part.body);
        // 공 경로: 걸음 시작·끝 위치를 잇는 직선(25 ms 안의 중력 휨은 3 mm 정도). 접촉 뒤에는 새 속도로 남은 걸음을 다시 적분한다.
        let path = {
            from: 0,
            start: sweep.ball.position,
            end: { ...ball.translation() },
            v0: sweep.ball.linear,
            v1: { ...ball.linvel() },
        };
        const ballAt = (s) => {
            const u = path.from >= 1 ? 1 : (s - path.from) / (1 - path.from);
            return {
                x: path.start.x + (path.end.x - path.start.x) * u,
                y: path.start.y + (path.end.y - path.start.y) * u,
                z: path.start.z + (path.end.z - path.start.z) * u,
            };
        };
        const ballVelocityAt = (s) => {
            const u = path.from >= 1 ? 1 : (s - path.from) / (1 - path.from);
            return {
                x: path.v0.x + (path.v1.x - path.v0.x) * u,
                y: path.v0.y + (path.v1.y - path.v0.y) * u,
                z: path.v0.z + (path.v1.z - path.v0.z) * u,
            };
        };
        const hit = new Set(sweep.parts.filter((entry) => sweep.resolved.has(entry.part)));
        let angular = { ...ball.angvel() };
        for (let round = 0; round < c.maxContacts; round++) {
            let best = null;
            for (const entry of sweep.parts) {
                if (hit.has(entry)) continue;
                const s = this._firstContact(entry, ballAt, path.from);
                if (s !== null && (!best || s < best.s)) best = { entry, s };
            }
            if (!best) break;
            const { entry } = best;
            hit.add(entry);
            let s = best.s;
            if (!this.ballContacts.has(entry.part.colliderHandle)) {
                // 새 접촉은 처음 닿은 순간이 아니라 그 뒤 첫 칸 경계(ballContact.delayMs 격자)에서 푼다(_contactDueFraction).
                // 경계가 걸음 끝이면 이 걸음에는 공이 부위 안으로 들어간 채 두고, 다음 걸음 시작에 겹친 자리로 푼다(_resolveStartBallContacts).
                const due = this._contactDueFraction(s, h);
                if (due >= 1 - 1e-9) continue;
                s = due;
            }
            const part = entry.part,
                at = this._sweepPose(entry, s),
                center = ballAt(s);
            const contact = this._shapeDistance(part, center, at.position, at.rotation),
                n = contact.normal;
            // 부위 속도는 걸음 끝 값이다. Rapier는 걸음 처음에 관절·제약으로 속도를 푼 뒤 그 속도로 위치를 적분하므로(반암시 오일러) 걸음 안에서
            // 부위가 실제로 움직인 속도가 그것이다. 걸음 시작 값은 발 PD·발 방향 충격을 막 받고 관절이 아직 풀지 않은 속도라, 걸음이 길수록
            // 실제 움직임과 멀어진다(25 ms 서브에서 발 각속도 약 39 rad/s 대 걸음 끝 약 23 rad/s).
            const partVelocity = this._add(
                entry.end.linear,
                this._cross(entry.end.angular, this._sub(contact.point, at.position)),
            );
            const ballVelocity = ballVelocityAt(s);
            // 공 표면 접촉점의 속도(회전 포함) - 부위 접촉점 속도.
            const arm = this._mul(n, -radius);
            const relative = this._sub(
                this._add(ballVelocity, this._cross(angular, arm)),
                partVelocity,
            );
            const closing = this._dot(relative, n);
            const partCollider = this.world.getCollider(part.colliderHandle);
            // 반발은 새로 닿는 접촉에만 준다(Rapier도 이어지는 접촉점에는 반발을 걸지 않는다). 계수는 결합 규칙 Max, 마찰은 평균.
            const fresh = !this.ballContacts.has(part.colliderHandle);
            const restitution = fresh
                    ? Math.max(ballCollider.restitution(), partCollider.restitution())
                    : 0,
                friction = (ballCollider.friction() + partCollider.friction()) / 2;
            const ballMass = ball.mass(),
                ballInertia = 0.4 * ballMass * radius * radius,
                lever = this._sub(contact.point, at.position);
            const penetration = radius - contact.distance;
            if (closing >= 0) {
                // 떨어지는 중인 접촉: 충격은 없고, 걸음 시작에 겹쳐 있었다면 겹친 만큼만 밀어낸다.
                if (penetration > c.slop) {
                    const push = this._mul(n, penetration);
                    path = {
                        ...path,
                        start: this._add(path.start, push),
                        end: this._add(path.end, push),
                    };
                }
                this._recordSweptContact(entry.p, part, contactStarts, candidates, null);
                continue;
            }
            // 법선 충격: 닿는 순간의 접근 속도를 반발 계수만큼 되돌린다. 질량은 Rapier 접촉 제약과 같은 두 몸체의 일반화 역질량이다
            // (공 1/m, 부위 1/m + 회전 관성 항. 관절로 이어진 부위는 넣지 않는다: Rapier도 접촉 한 건을 두 몸체 사이에서만 푼다).
            const normalImpulse =
                (-(1 + restitution) * closing) /
                (1 / ballMass + this._inverseMassAt(part.body, at.rotation, lever, n));
            let impulse = this._mul(n, normalImpulse);
            const tangent = this._sub(relative, this._mul(n, closing)),
                slip = this._length(tangent);
            if (slip > 1e-9) {
                // 미끄러짐을 멈추는 충격(공 회전 관성 포함)과 마찰 원뿔(μ × 법선 충격) 중 작은 쪽.
                const tangentMass =
                    1 /
                    (1 / ballMass +
                        (radius * radius) / ballInertia +
                        this._inverseMassAt(
                            part.body,
                            at.rotation,
                            lever,
                            this._mul(tangent, 1 / slip),
                        ));
                const amount = Math.min(slip * tangentMass, friction * normalImpulse);
                impulse = this._add(impulse, this._mul(tangent, -amount / slip));
            }
            const nextVelocity = this._add(ballVelocity, this._mul(impulse, 1 / ballMass));
            angular = this._add(angular, this._mul(this._cross(arm, impulse), 1 / ballInertia));
            // 공을 접촉면 밖(반지름 거리)에 두고 남은 걸음을 새 속도로 적분한다.
            const placed = this._add(contact.point, this._mul(n, radius)),
                rest = (1 - s) * h;
            path = {
                from: s,
                start: placed,
                end: {
                    x: placed.x + nextVelocity.x * rest,
                    y: placed.y + nextVelocity.y * rest - 0.5 * g * rest * rest,
                    z: placed.z + nextVelocity.z * rest,
                },
                v0: nextVelocity,
                v1: { x: nextVelocity.x, y: nextVelocity.y - g * rest, z: nextVelocity.z },
            };
            // 반작용: 접촉점의 부위 국소 위치를 걸음 끝 자세로 옮겨 그 점에 반대 충격을 준다.
            const endPoint = this._add(
                entry.end.position,
                this._rotate(entry.end.rotation, contact.local),
            );
            part.body.applyImpulseAtPoint(this._mul(impulse, -1), endPoint, true);
            this._recordSweptContact(entry.p, part, contactStarts, candidates, impulses);
        }
        if (hit.size) {
            ball.setTranslation(path.end, true);
            ball.setLinvel(path.v1, true);
            ball.setAngvel(angular, true);
        }
        // 떨어진 접촉은 접촉 묶음에서 뺀다(Rapier 접촉의 끝 이벤트에 해당).
        const final = { ...ball.translation() };
        for (const entry of sweep.parts) {
            const handle = entry.part.colliderHandle,
                active = this.ballContacts.get(handle);
            if (!active || hit.has(entry)) continue;
            const pose = entry.end;
            const gap =
                this._shapeDistance(entry.part, final, pose.position, pose.rotation).distance -
                radius;
            if (gap > c.separation) this.ballContacts.delete(handle);
        }
    }

    /** 직접 푼 접촉을 Rapier 접촉 이벤트와 같은 자리에 넣는다: 새 접촉이면 시작, 충격이 있으면 터치 후보. */
    _recordSweptContact(p, part, contactStarts, candidates, impulses) {
        const handle = part.colliderHandle;
        let contact = this.ballContacts.get(handle);
        if (!contact) {
            contact = {
                ...this.colliderMeta.get(handle),
                confirmed: this._episodeConfirmed(p.id),
            };
            this.ballContacts.set(handle, contact);
            contactStarts.push(contact);
        }
        candidates.set(handle, contact);
        impulses?.add(handle);
    }

    /** 3×3 행렬(행 우선 9개 배열)과 벡터의 곱. */
    _mat3Apply(m, v) {
        return {
            x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
            y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
            z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
        };
    }

    /** 몸체(자세 rotation)의 점 rA 속도가 점 rB 충격에 바뀌는 행렬 (1/m)E - [rA]× I⁻¹ [rB]× (r은 질량 중심 기준). */
    _pointResponse(body, rotation, rA, rB) {
        const frame = this._qmul(rotation, body.principalInertiaLocalFrame()),
            inertia = body.principalInertia(),
            mass = body.mass();
        const out = new Array(9);
        const axes = [
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: 1 },
        ];
        axes.forEach((e, column) => {
            const torque = this._rotate(this._conj(frame), this._cross(rB, e));
            const w = this._rotate(frame, {
                x: torque.x / inertia.x,
                y: torque.y / inertia.y,
                z: torque.z / inertia.z,
            });
            const v = this._add(this._mul(e, 1 / mass), this._cross(w, rA));
            out[column] = v.x;
            out[3 + column] = v.y;
            out[6 + column] = v.z;
        });
        return out;
    }

    /**
     * 공이 부위의 점 (질량 중심 + lever)을 칠 때 그 점의 속도 응답 행렬(일반화 역질량). 발은 발목 관절(점 구속)로 정강이와 이어진 두 몸체로 본다.
     * v0.19.12의 Rapier는 접촉과 관절을 한 솔버에서 같이 풀어, 공이 본 발의 질량에 정강이 몫이 들어갔다. 그 밖의 부위는 그 몸체 하나다.
     */
    _jointedResponse(part, rotation, lever) {
        const body = part.body;
        const own = this._pointResponse(body, rotation, lever, lever);
        if (!part.name.startsWith('foot')) return own;
        const suffix = part.name.slice(4),
            p = this.players.find((player) => player.byName[part.name] === part),
            joint = p?.joints.find((item) => item.name === 'ankle' + suffix),
            leg = p?.byName['lowerLeg' + suffix];
        if (!joint || !leg) return own;
        const center = body.translation();
        const anchor = this._add(center, this._rotate(rotation, joint.restAnchor2)),
            fromFoot = this._sub(anchor, center),
            fromLeg = this._sub(anchor, leg.body.translation()),
            legRotation = leg.body.rotation();
        const faa = this._pointResponse(body, rotation, fromFoot, fromFoot),
            laa = this._pointResponse(leg.body, legRotation, fromLeg, fromLeg),
            fac = this._pointResponse(body, rotation, fromFoot, lever),
            fca = this._pointResponse(body, rotation, lever, fromFoot);
        const k = faa.map((value, index) => value + laa[index]);
        const inverse = this._mat3Inverse(k);
        if (!inverse) return own;
        const product = (a, b) => {
            const out = new Array(9);
            for (let r = 0; r < 3; r++)
                for (let c = 0; c < 3; c++)
                    out[r * 3 + c] =
                        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
            return out;
        };
        const correction = product(fca, product(inverse, fac));
        return own.map((value, index) => value - correction[index]);
    }

    /** 3×3 역행렬(행 우선). 특이하면 null. */
    _mat3Inverse(m) {
        const [a, b, c, d, e, f, g, h, i] = m;
        const A = e * i - f * h,
            B = -(d * i - f * g),
            C = d * h - e * g;
        const det = a * A + b * B + c * C;
        if (Math.abs(det) < 1e-12) return null;
        const r = 1 / det;
        return [
            A * r,
            -(b * i - c * h) * r,
            (b * f - c * e) * r,
            B * r,
            (a * i - c * g) * r,
            -(a * f - c * d) * r,
            C * r,
            -(a * h - b * g) * r,
            (a * e - b * d) * r,
        ];
    }

    /**
     * 몸체의 점 (질량 중심 + lever)에서 방향 direction으로 본 일반화 역질량 1/m + (r×d)·I⁻¹(r×d).
     * I⁻¹은 Rapier 주관성 모멘트(principalInertia, 국소 축 principalInertiaLocalFrame)를 자세 rotation으로 돌린 값이다.
     */
    _inverseMassAt(body, rotation, lever, direction) {
        const w = this._cross(lever, direction),
            frame = this._qmul(rotation, body.principalInertiaLocalFrame()),
            inertia = body.principalInertia();
        const local = this._rotate(this._conj(frame), w);
        const scaled = { x: local.x / inertia.x, y: local.y / inertia.y, z: local.z / inertia.z };
        return 1 / body.mass() + this._dot(w, this._rotate(frame, scaled));
    }

    /** 이 선수의 지금 공 접촉이 이미 터치로 확정됐는지. */
    _episodeConfirmed(playerId) {
        return [...this.ballContacts.values()].some(
            (contact) =>
                contact.kind === 'player' && contact.playerId === playerId && contact.confirmed,
        );
    }

    /** 충돌 시작·끝 이벤트로 공 접촉 목록, 착지 이벤트, 네트 접촉 이벤트를 갱신한다. */
    _drainCollisions(events, contactStarts, candidates, before) {
        this.queue.drainCollisionEvents((a, b, started) => {
            const ma = this.colliderMeta.get(a),
                mb = this.colliderMeta.get(b);
            if (!ma || !mb) return;
            if (ma.kind === 'ball' || mb.kind === 'ball') {
                const otherHandle = ma.kind === 'ball' ? b : a,
                    other = ma.kind === 'ball' ? mb : ma;
                if (started) {
                    const contact = {
                        ...other,
                        confirmed:
                            other.kind === 'player' && this._episodeConfirmed(other.playerId),
                    };
                    this.ballContacts.set(otherHandle, contact);
                    candidates.set(otherHandle, contact);
                    contactStarts.push(contact);
                } else this.ballContacts.delete(otherHandle);
            }
            const player = ma.kind === 'player' ? ma : mb.kind === 'player' ? mb : null;
            if (started && player && (ma.kind === 'floor' || mb.kind === 'floor')) {
                const p = this.players[player.playerId];
                if (p.landArmed && p.airTime > this.settings.drive.landing.airTime) {
                    const position = { ...p.byName[player.part].body.translation(), y: 0 };
                    this.world.contactPair(
                        this.world.getCollider(a),
                        this.world.getCollider(b),
                        (manifold) => {
                            if (manifold.numSolverContacts() > 0)
                                Object.assign(position, manifold.solverContactPoint(0));
                        },
                    );
                    events.push({
                        type: 'land',
                        playerId: p.id,
                        team: p.team,
                        part: player.part,
                        position,
                        speed: Math.max(0, -before.players[p.id].velocity.y),
                    });
                    p.landArmed = false;
                    p.freeTime = 0;
                }
            }
            const net = ma.kind === 'net' || mb.kind === 'net';
            if (player && net) {
                const key = a < b ? a + ':' + b : b + ':' + a;
                if (started && !this.netContacts.has(key))
                    events.push({ type: 'net', playerId: player.playerId, team: player.team });
                if (started) this.netContacts.add(key);
                else this.netContacts.delete(key);
            }
        });
    }

    /** 공을 실제로 민 선수 충돌체를 impulses에 모은다: 접촉 힘 이벤트, 그다음 후보 접촉의 솔버 충격량. */
    _collectBallImpulses(candidates, impulses) {
        this.queue.drainContactForceEvents((force) => {
            if (!(force.totalForceMagnitude() > 0)) return;
            const a = force.collider1(),
                b = force.collider2();
            if (a === this.ballColliderHandle) this._confirmImpulse(b, candidates, impulses);
            else if (b === this.ballColliderHandle) this._confirmImpulse(a, candidates, impulses);
        });
        const ballCollider = this.world.getCollider(this.ballColliderHandle);
        for (const [handle, other] of candidates) {
            if (other.kind !== 'player') continue;
            this.world.contactPair(ballCollider, this.world.getCollider(handle), (manifold) => {
                if (manifold.numSolverContacts() === 0) return;
                for (let i = 0; i < manifold.numContacts(); i++) {
                    if (manifold.contactImpulse(i) > 0) {
                        this._confirmImpulse(handle, candidates, impulses);
                        break;
                    }
                }
            });
        }
    }

    _confirmImpulse(handle, candidates, impulses) {
        const other = this.colliderMeta.get(handle);
        if (other?.kind !== 'player') return;
        impulses.add(handle);
        if (!candidates.has(handle))
            candidates.set(handle, { ...other, confirmed: this._episodeConfirmed(other.playerId) });
    }

    /** 충격량이 있는 접촉을 터치로 확정한다. 공중 발차기의 실제 발 접촉은 준비를 마친다(strike → follow). */
    _confirmTouches(impulses, candidates, contactStarts, confirmedTouches) {
        for (const handle of impulses) {
            const contact = candidates.get(handle),
                p = this.players[contact.playerId];
            // Air completion and public touches share the actual solver observation,
            // while a shin/body hit cannot finish this active foot's preparation.
            if (
                p.kick.mode === 'air' &&
                p.kick.held &&
                p.kick.airPlan?.phase === 'strike' &&
                contact.part === 'foot' + p.kick.side
            )
                p.kick.airPlan.phase = 'follow';
            if (contact.confirmed) continue;
            contact.confirmed = true;
            // Consume the whole ongoing player contact, including a real impact
            // suppressed by the existing 65 ms cooldown. A later limb cannot turn
            // that same continuous contact into a delayed extra touch.
            for (const active of this.ballContacts.values()) {
                if (active.kind === 'player' && active.playerId === p.id) active.confirmed = true;
            }
            confirmedTouches.add(contact);
            if (!contactStarts.includes(contact)) contactStarts.push(contact);
        }
    }

    /** 바닥 접촉과 확정된 선수 터치를 이벤트로 낸다. 터치는 받기 반응·리시브 접촉 시각·블로킹 되받아치기를 함께 반영한다. */
    _emitTouches(events, contactStarts, confirmedTouches, before) {
        const sent = new Set();
        for (const other of contactStarts) {
            const position = { ...this.ball.translation() };
            if (other.kind === 'floor') {
                if (!sent.has('ground')) events.push({ type: 'ground', position });
                sent.add('ground');
            } else if (other.kind === 'player' && !sent.has(other.playerId)) {
                if (!confirmedTouches.has(other)) continue;
                const p = this.players[other.playerId];
                if (this.time - p.lastTouch < 0.065) continue;
                const part = p.byName[other.part];
                const reactionSeverity = this._receiveImpact(p, other.part, before);
                if (p.receive && p.receive.phase !== 'recover' && p.receive.hitAt === null) {
                    p.receive.hitAt = this.time;
                    p.receive.phase = 'contact';
                }
                const block = this._blockReturn(p, other.part, position, before);
                if (block) this._deflectBlockedBall(p, block, position);
                events.push({
                    type: 'touch',
                    playerId: p.id,
                    team: p.team,
                    part: other.part,
                    position,
                    speed: this._length(this.ball.linvel()),
                    footVelocity: { ...part.body.velocityAtPoint(position) },
                    incomingSpeed: this._length(before.ballVelocity),
                    reactionSeverity,
                });
                p.lastTouch = this.time;
                sent.add(other.playerId);
                this.lastBallTouch = { playerId: p.id, team: p.team, time: this.time };
            }
        }
    }

    /** 블로킹 되받아치기 속도를 공에 주고, 발이 계속 내려가며 공을 다시 밀지 못하도록 공을 접촉면 밖으로 살짝 옮긴다. */
    _deflectBlockedBall(p, block, position) {
        const length = this._length(block),
            settings = this.settings.block;
        // 네트 쪽으로 옮길 때는 네트 앞 netGap 안으로 들어가지 않게 한다.
        const room =
            block.x * p.toward > 0
                ? Math.max(0, -position.x * p.toward - settings.netGap) / (block.x * p.toward)
                : Infinity;
        const gap = Math.min(settings.separation / length, room);
        this.ball.setLinvel(block, true);
        this.ball.setTranslation(
            {
                x: position.x + block.x * gap,
                y: position.y + block.y * gap,
                z: position.z + block.z * gap,
            },
            true,
        );
    }

    // 블로킹 되받아치기 속도. 조건: 공중 + 발차기 누름 + 다리/발 접촉 + 공이 우리 코트 쪽 네트 앞 zone m 안,
    // minHeight 이상에서 minIncoming 이상으로 우리 쪽으로 오는 중. 현재 상태만으로 정해지므로 저장할 값이 없다.
    _blockReturn(p, part, position, before) {
        const s = this.settings.block;
        if (
            !s?.enabled ||
            p.grounded ||
            !p.kick.held ||
            !s.parts.some((name) => part.startsWith(name))
        )
            return null;
        const x = position.x * p.toward,
            incoming = before.ballVelocity,
            towardUs = incoming.x * p.toward;
        if (x > 0 || x < -s.zone || position.y < s.minHeight || towardUs > -s.minIncoming)
            return null;
        const speed = this._clamp(this._length(incoming) * s.speedRatio, s.minSpeed, s.maxSpeed);
        const forward = Math.max(0.5, speed),
            flight = Math.max(0.03, -x / forward);
        const clearance = this.config.court.netHeight + this.settings.ballRadius + s.netClearance;
        const up = (clearance - position.y) / flight + 0.5 * this.settings.gravity * flight;
        return { x: p.toward * forward, y: Math.max(0.5, up), z: incoming.z * 0.3 };
    }

    getEntities() {
        const entities = [];
        for (const p of this.players)
            for (const part of p.parts) {
                const pos = part.body.translation(),
                    q = part.body.rotation();
                entities.push({
                    id: part.id,
                    kind: 'body',
                    part: part.name,
                    team: p.team,
                    shape: part.shape,
                    radius: part.radius,
                    halfHeight: part.halfHeight,
                    halfExtents: part.halfExtents,
                    restHalfHeight: part.restGeometry.halfHeight,
                    x: pos.x,
                    y: pos.y,
                    z: pos.z,
                    qx: q.x,
                    qy: q.y,
                    qz: q.z,
                    qw: q.w,
                });
            }
        const pos = this.ball.translation(),
            q = this.ball.rotation();
        entities.push({
            id: 'ball',
            kind: 'ball',
            part: 'ball',
            team: -1,
            shape: 'sphere',
            radius: this.settings.ballRadius,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            qx: q.x,
            qy: q.y,
            qz: q.z,
            qw: q.w,
        });
        return entities;
    }

    save() {
        return {
            version: 3,
            time: this.time,
            // A received checkpoint is already validated by Rapier restoration and
            // the game's handle/geometry checks. Reuse its exact bytes until stepping;
            // GameKit's deterministic bootstrap verifier requires byte identity.
            snapshot: this.restoredSnapshotBytes?.slice() ?? this.world.takeSnapshot(),
            ballHandle: this.ball.handle,
            ballColliderHandle: this.ballColliderHandle,
            floorHandle: this.floorHandle,
            colliderMeta: [...this.colliderMeta.entries()].map(([h, m]) => [h, { ...m }]),
            ballContacts: [...this.ballContacts.entries()].map(([h, m]) => [h, { ...m }]),
            netContacts: [...this.netContacts],
            lastBallTouch: this.lastBallTouch ? { ...this.lastBallTouch } : null,
            players: this.players.map((p) => ({
                id: p.id,
                athlete: structuredClone(p.athlete),
                receive: structuredClone(p.receive),
                state: p.state,
                grounded: p.grounded,
                contacts: [...p.contacts],
                jump: { ...p.jump },
                kick: structuredClone(p.kick),
                gait: p.gait,
                airTime: p.airTime,
                supportAge: p.supportAge,
                recoveryTime: p.recoveryTime,
                lastTouch: p.lastTouch,
                desiredYaw: p.desiredYaw,
                freeTime: p.freeTime,
                landArmed: p.landArmed,
                reaction: { ...p.reaction },
                locomotionActive: p.locomotionActive,
                legs: { L: { ...p.legs.L }, R: { ...p.legs.R } },
                partHandles: p.parts.map((part) => ({
                    name: part.name,
                    body: part.body.handle,
                    collider: part.colliderHandle,
                    shape: part.shape,
                    restGeometry: structuredClone(part.restGeometry),
                    geometry:
                        part.shape === 'box'
                            ? { halfExtents: { ...part.halfExtents } }
                            : part.shape === 'capsule'
                              ? { radius: part.radius, halfHeight: part.halfHeight }
                              : { radius: part.radius },
                })),
                joints: p.joints.map((j) => ({
                    name: j.name,
                    handle: j.handle,
                    target: [...j.target],
                    restAnchor1: { ...j.restAnchor1 },
                    restAnchor2: { ...j.restAnchor2 },
                })),
            })),
        };
    }

    load(data) {
        // Clone and validate incoming controller metadata before changing live
        // bodies. Failed restores must leave the current game usable.
        data = structuredClone(data);
        this._validateSnapshot(data);
        const profiles = data.players.map((saved, id) => this._athleteProfile(saved.athlete, id));
        const restore = this._prepareRestore(data);
        this._commitRestore(restore, data);
        this.setAthletes(profiles);
        // The restored world is equivalent to this exact received snapshot.
        // Preserve the original on-the-wire identity only until its first mutation.
        this.restoredSnapshotBytes = restore.receivedSnapshot;
    }

    /** 스냅샷의 모양(version 3, 선수 6명의 리시브·다리·신체·관절 기록)을 검사한다. 틀리면 아무것도 바꾸지 않고 던진다. */
    _validateSnapshot(data) {
        if (
            !data ||
            data.version !== 3 ||
            !data.snapshot ||
            !Number.isFinite(data.time) ||
            data.time < 0 ||
            !Array.isArray(data.players) ||
            data.players.length !== 6 ||
            Array.from(data.players).some((saved, id) => this._savedPlayerInvalid(saved, id))
        ) {
            throw new Error(
                '올바르지 않은 물리 스냅샷 (선수와 리시브 상태가 포함된 version 3 필요)',
            );
        }
    }

    /** 저장된 선수 하나의 모양이 틀렸는지(id·리시브·접촉·점프·발차기·다리·신체·관절 순서로 본다). */
    _savedPlayerInvalid(saved, id) {
        return (
            !saved ||
            saved.id !== id ||
            !snapshotReceive(saved.receive) ||
            !Array.isArray(saved.contacts) ||
            !saved.jump ||
            !saved.kick ||
            !saved.legs ||
            this._savedLegsInvalid(saved) ||
            this._savedPartsInvalid(saved, id) ||
            this._savedJointsInvalid(saved, id)
        );
    }

    /** 다리 늘이기 배율(scale·targetScale)이 1 이상 최대 배율 이하인지 본다. 틀리면 true. */
    _savedLegsInvalid(saved) {
        return ['L', 'R'].some((suffix) => {
            const leg = saved.legs[suffix];
            return (
                !leg ||
                ['scale', 'targetScale'].some(
                    (key) =>
                        !Number.isFinite(leg[key]) ||
                        leg[key] < 1 ||
                        leg[key] > this.settings.legStretch.maxScale + 1e-10,
                )
            );
        });
    }

    /** 신체 기록(이름 중복 없음, 모양·핸들·형상)이 지금 선수의 신체와 맞는지 본다. 틀리면 true. */
    _savedPartsInvalid(saved, id) {
        return (
            !Array.isArray(saved.partHandles) ||
            saved.partHandles.length !== this.players[id].parts.length ||
            new Set(saved.partHandles.map((part) => part?.name)).size !==
                saved.partHandles.length ||
            Array.from(saved.partHandles).some(
                (part) =>
                    !part ||
                    !this.players[id].parts.some(
                        (item) => item.name === part.name && item.shape === part.shape,
                    ) ||
                    !Number.isFinite(part.body) ||
                    !Number.isFinite(part.collider) ||
                    !snapshotGeometry(part.geometry, part.shape) ||
                    !snapshotGeometry(part.restGeometry, part.shape),
            )
        );
    }

    /** 관절 기록(이름 중복 없음, 핸들·목표 3개·기준점)이 지금 선수의 관절과 맞는지 본다. 틀리면 true. */
    _savedJointsInvalid(saved, id) {
        return (
            !Array.isArray(saved.joints) ||
            saved.joints.length !== this.players[id].joints.length ||
            new Set(saved.joints.map((joint) => joint?.name)).size !== saved.joints.length ||
            Array.from(saved.joints).some(
                (joint) =>
                    !joint ||
                    !this.players[id].joints.some((item) => item.name === joint.name) ||
                    !Number.isFinite(joint.handle) ||
                    !Array.isArray(joint.target) ||
                    joint.target.length !== 3 ||
                    !Array.from(joint.target).every(Number.isFinite) ||
                    !snapshotVector(joint.restAnchor1) ||
                    !snapshotVector(joint.restAnchor2),
            )
        );
    }

    /**
     * 받은 월드를 새로 복원하고 공·바닥·신체·관절 핸들을 묶어 둔다. 지금 월드는 건드리지 않으며,
     * 핸들이 맞지 않으면 새 월드만 해제하고 던진다.
     */
    _prepareRestore(data) {
        const receivedSnapshot = new Uint8Array(data.snapshot);
        const nextWorld = this.serializer.deserializeAll(receivedSnapshot.slice());
        if (!nextWorld) throw new Error('물리 스냅샷 복원 실패');
        let prepared, nextQueue, nextBall, nextColliderMeta, nextBallContacts, nextNetContacts;
        try {
            nextBall = nextWorld.getRigidBody(data.ballHandle);
            if (
                !nextBall ||
                nextBall.handle !== data.ballHandle ||
                nextWorld.getCollider(data.ballColliderHandle)?.handle !==
                    data.ballColliderHandle ||
                nextWorld.getCollider(data.floorHandle)?.handle !== data.floorHandle
            )
                throw new Error('스냅샷 공 또는 바닥 핸들이 유효하지 않습니다.');
            nextColliderMeta = new Map(data.colliderMeta);
            nextBallContacts = new Map(
                data.ballContacts.map(([handle, contact]) => [handle, { ...contact }]),
            );
            nextNetContacts = new Set(data.netContacts);
            prepared = data.players.map((saved) => ({
                parts: saved.partHandles.map((h) => {
                    const body = nextWorld.getRigidBody(h.body);
                    if (
                        !body ||
                        body.handle !== h.body ||
                        nextWorld.getCollider(h.collider)?.handle !== h.collider
                    )
                        throw new Error('스냅샷 신체 핸들이 유효하지 않습니다.');
                    return { body, saved: h };
                }),
                joints: saved.joints.map((h) => {
                    const current = this.players[saved.id].joints.find(
                        (item) => item.name === h.name,
                    );
                    let joint = nextWorld.getImpulseJoint(h.handle);
                    if (!joint || joint.handle !== h.handle)
                        throw new Error('스냅샷 관절 핸들이 유효하지 않습니다.');
                    if (!current.hinge && typeof joint.configureMotorPosition !== 'function')
                        joint = new this.R.SphericalImpulseJoint(
                            nextWorld.impulseJoints.raw,
                            nextWorld.bodies,
                            h.handle,
                        );
                    return { joint, saved: h };
                }),
            }));
            nextQueue = new this.R.EventQueue(true);
        } catch (error) {
            nextWorld.free();
            throw error;
        }
        return {
            receivedSnapshot,
            world: nextWorld,
            queue: nextQueue,
            ball: nextBall,
            colliderMeta: nextColliderMeta,
            ballContacts: nextBallContacts,
            netContacts: nextNetContacts,
            players: prepared,
        };
    }

    /** 준비한 월드로 바꾸고 선수 제어 상태와 신체·관절 바인딩을 스냅샷 값으로 되돌린다. 여기서부터는 실패하지 않는다. */
    _commitRestore(restore, data) {
        // All body/joint bindings and controller data are ready before the swap.
        this.world.free();
        this.world = restore.world;
        this.queue.free();
        this.queue = restore.queue;
        this.time = data.time;
        this.ball = restore.ball;
        this.ballColliderHandle = data.ballColliderHandle;
        this.floorHandle = data.floorHandle;
        this.colliderMeta = restore.colliderMeta;
        this.ballContacts = restore.ballContacts;
        this.netContacts = restore.netContacts;
        this.lastBallTouch = data.lastBallTouch ? { ...data.lastBallTouch } : null;
        for (const saved of data.players) {
            const p = this.players[saved.id],
                binding = restore.players[saved.id];
            for (const key of [
                'state',
                'grounded',
                'gait',
                'airTime',
                'supportAge',
                'recoveryTime',
                'lastTouch',
                'desiredYaw',
            ])
                p[key] = saved[key];
            p.contacts = [...saved.contacts];
            p.jump = { ...saved.jump };
            p.kick = saved.kick;
            p.receive = saved.receive;
            p.freeTime = saved.freeTime || 0;
            p.landArmed = !!saved.landArmed;
            p.locomotionActive = !!saved.locomotionActive;
            p.legs = { L: { ...saved.legs.L }, R: { ...saved.legs.R } };
            p.reaction = saved.reaction
                ? { ...saved.reaction }
                : { remaining: 0, duration: 0, severity: 0, incomingSpeed: 0 };
            for (const { body, saved: h } of binding.parts) {
                const part = p.byName[h.name];
                part.body = body;
                part.colliderHandle = h.collider;
                part.restGeometry = h.restGeometry;
                Object.assign(part, h.geometry);
                if (/^(upperLeg|lowerLeg)/.test(part.name))
                    part.restLength = 2 * (part.restGeometry.halfHeight + part.restGeometry.radius);
            }
            p.root = p.byName.pelvis.body;
            for (const { joint, saved: h } of binding.joints) {
                const j = p.joints.find((item) => item.name === h.name);
                j.handle = h.handle;
                j.target = [...h.target];
                j.restAnchor1 = { ...h.restAnchor1 };
                j.restAnchor2 = { ...h.restAnchor2 };
                j.joint = joint;
            }
        }
    }

    dispose() {
        this.restoredSnapshotBytes = null;
        this.queue.free();
        this.world.free();
        this.serializer.free();
        this.players.length = 0;
        this.colliderMeta.clear();
        this.ballContacts.clear();
        this.netContacts.clear();
    }
}

export { TakrawPhysics };
