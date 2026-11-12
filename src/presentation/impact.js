import { ObjectPool } from '@bloom-gamekit/object-pool';
import * as deterministic from '@bloom-gamekit/deterministic';
import { takrawEventUnits } from '../simulation/random.js';
import { TAKRAW_CONFIG, TAKRAW_TIMING_GRADES } from '../config/game.js';
import { TakrawParticleCloud } from './instanced-effects.js';

const FOOT_PART = /^(foot|lowerLeg)/;
const RIM_OPACITY = 0.85; // 입자 테두리의 불투명도(본체는 1)

/**
 * 접촉의 종류(표시 전용). 시뮬레이션 이벤트와 그 스텝 뒤 경기 상태(touches·play)만 읽는다.
 * body: 발·정강이가 아닌 몸, serve: 서브 차기(play.reason), drive: 공격 의도의 접촉(play.kind attack·return),
 * receive: 공을 가진 팀의 첫 터치, set: 둘째 터치, ground: 공이 바닥에 닿음. 스파이크·타이밍 등급은 impactStyleKey가 먼저 고른다.
 * 서브가 아닌 발 접촉이 clutchHeight보다 낮으면 clutch(아슬아슬한 받아내기)다.
 */
function takrawContactKind(event, state, clutchHeight = TAKRAW_CONFIG.visual.impact.clutchHeight) {
    if (event.type === 'ground') return { kind: 'ground', clutch: false };
    if (!FOOT_PART.test(event.part || '')) return { kind: 'body', clutch: false };
    const play = state?.play;
    const kind =
        play?.reason === 'serve'
            ? 'serve'
            : play?.kind === 'attack' || play?.kind === 'return'
              ? 'drive'
              : state?.touches === 1
                ? 'receive'
                : 'set';
    return { kind, clutch: kind !== 'serve' && event.position.y < clutchHeight };
}

/** 접촉 payload가 쓰는 연출 이름. 스파이크 > 타이밍 등급 > 바닥 > 접촉 종류(아슬아슬한 받아내기는 save). 런타임의 이벤트 수명 계산도 이 함수를 쓴다. */
function impactStyleKey(styles, payload) {
    if (payload?.spike && styles.spike) return 'spike';
    const grade = payload?.timing?.grade;
    if (grade && grade !== TAKRAW_TIMING_GRADES.normal && styles[grade]) return grade;
    if (payload?.kind === 'ground') return 'ground';
    if (payload?.clutch && payload.kind !== 'body') return 'save';
    if (styles[payload?.kind]) return payload.kind;
    return TAKRAW_TIMING_GRADES.normal;
}

/**
 * 접촉 효과의 단일 소유자: 쇼크웨이브 파동 값, 공 눌림, 반짝임·그림자·히트스톱 값, 카메라 진동량, 스파이크 속성 입자 구름.
 * - 수명과 모양은 presentation-events 저널이 알려 주는 경과 시간(ageMs)의 함수다.
 *   프레임 간격을 누적하지 않으므로 프레임 속도, 롤백 재확정, 두 피어의 화면에서 같은 모습이 된다.
 * - 입자 방향은 접촉 이벤트의 tick·sequence에서 만든 시드 난수로 정한다. Math.random을 쓰지 않는다.
 * - 효과 노드는 object-pool로 재사용한다. 장면 객체를 만들지 않고 시뮬레이션 시간도 건드리지 않는다.
 */
class TakrawImpactEffects {
    constructor({ THREE, scene, config, reducedMotion = () => false }) {
        this.THREE = THREE;
        this.scene = scene;
        this.impact = config.visual.impact;
        this.styles = config.visual.impact.styles;
        this.shakeCap = config.visual.shakeCap;
        this.seed = config.visual.effectSeed;
        this.reducedMotion = reducedMotion;
        this.streakGeometry = new THREE.BoxGeometry(0.026, 0.026, 1);
        this.axisZ = new THREE.Vector3(0, 0, 1);
        this.axisUp = new THREE.Vector3(0, 1, 0);
        this.cloudDirection = new THREE.Vector3();
        this.deformation = { axis: new THREE.Vector3(), amount: 0 };
        this.camera = null;
        this.ballMask = { value: new THREE.Vector3() };
        this.elementConfig = config.visual.impactElements;
        this.elements = []; // 팀 번호 → 속성 id. 뷰가 학교를 정할 때 setElements로 채운다.
        this.shapeGeometries = this.createShapeGeometries();
        // 구름은 모양·속성과 무관하게 인스턴스 레이어 한 쌍(테두리·본체)으로 그린다(DEV-034). 칸은 노드 8개가 동시에 겹쳐도 넘치지 않는 수다.
        this.cloud = new TakrawParticleCloud({
            THREE,
            scene,
            geometries: this.shapeGeometries,
            mask: this.ballMask,
            capacity: this.elementConfig.maxParticles * 8,
        });
        this.quaternion = new THREE.Quaternion();
        this.spin = new THREE.Quaternion();
        this.bodyMatrix = new THREE.Matrix4();
        this.rimMatrix = new THREE.Matrix4();
        this.position = new THREE.Vector3();
        this.scale = new THREE.Vector3();
        this.nodes = [];
        this.active = new Set();
        this.pool = new ObjectPool(
            () => this.createNode(),
            (node) => this.resetNode(node),
            16,
        );
    }

    createNode() {
        const T = this.THREE;
        // 위치만 담는 그룹(장면에 올리지 않는다). 입자는 장면 객체가 아니라 cloud의 인스턴스로 그린다.
        const group = new T.Group();
        group.visible = false;
        const particles = [];
        for (let i = 0; i < this.elementConfig.maxParticles; i++) {
            particles.push({
                shape: 'dot',
                color: 0,
                angle: 0,
                vx: 0,
                vy: 0,
                vz: 0,
                g: 0,
                size: 0,
                start: 0,
                life: 1,
                spin: 0,
                roll: 0,
                grow: 1,
                flicker: false,
                swirl: 0,
                radius: 0,
                direction: new T.Vector3(0, 0, 1),
                length: 1,
            });
        }
        const node = {
            group,
            particles,
            colors: Array.from({ length: 4 }, () => new T.Color()),
            edge: new T.Color(),
            particleTime: 0,
            particleCount: 0,
            style: null,
            strength: 1,
            life: 1,
            hold: 0,
            displayHold: 0,
            shake: null,
            fov: 0,
            squash: 0,
            squashDecay: 13,
            squashFreq: 34,
            squashAxis: new T.Vector3(),
            waveStrength: 0,
            shadeStrength: 0,
            waveScale: 1,
            flashFrames: false,
            groundPulse: false,
            playerId: -1,
            part: '',
            elementForward: new T.Vector3(),
            age: 0,
        };
        this.nodes.push(node);
        return node;
    }

    /** 로딩 단계에서 효과 노드(입자·재질)를 미리 만들어 둔다. 동시에 겹치는 접촉 수만큼 만들어 장면에 올린다(DEV-032). */
    warm(count) {
        const nodes = Array.from({ length: count }, () => this.pool.acquire());
        for (const node of nodes) this.pool.release(node);
    }

    resetNode(node) {
        node.group.visible = false;
        node.style = null;
        node.shake = null;
        node.age = 0;
        node.particleCount = 0;
        node.displayHold = 0;
    }

    /** 팀 번호별 학교 속성 id를 정한다(스파이크 연출을 고르는 유일한 입력). */
    setElements(ids) {
        this.elements = [...ids];
    }

    /** 공의 화면 원판(그리는 버퍼 픽셀: 중심 x·y와 반지름)을 알려 준다. 입자 구름은 이 원판 안에 그리지 않는다. */
    setBallMask(x, y, radius) {
        this.ballMask.value.set(x, y, radius);
    }

    /** 접촉 이벤트 payload로 효과를 시작한다. 반환한 노드를 update·reconcile·release에 전달한다. */
    start(payload) {
        const node = this.pool.acquire();
        this.active.add(node);
        node.age = 0;
        this.configure(node, payload);
        this.apply(node, 0);
        return node;
    }

    /**
     * 득점 리플레이용 시작: 화면 이펙트(파동·명암, 반짝임, 눌림, 속성 구름)만 켜고 표시 히트스톱·진동·화면 확대는 끈다.
     * 경과 시간은 호출자가 재생 시각으로 update에 넘긴다.
     */
    startReplay(payload) {
        const node = this.start(payload);
        node.displayHold = 0;
        node.shake = null;
        node.fov = 0;
        return node;
    }

    /** 같은 이벤트가 재실행으로 다시 확정될 때 호출한다. 경과 시간은 유지하고 모양만 갱신한다. */
    reconcile(node, payload) {
        this.configure(node, payload);
        this.apply(node, node.age);
    }

    update(node, ageMs) {
        node.age = ageMs;
        this.apply(node, ageMs);
    }

    release(node) {
        if (!this.active.delete(node)) return;
        this.pool.release(node);
    }

    /** 접촉 세기(1이 기준): 접촉 속도로 연속 변한다. 세기 원천은 style.intensity가 고른다. */
    strengthOf(style, payload) {
        const s = this.impact.intensity;
        if (!style.intensity) return 1;
        const foot = payload.footVelocity
            ? Math.hypot(payload.footVelocity.x, payload.footVelocity.y, payload.footVelocity.z)
            : 0;
        const speed =
            style.intensity === 'incoming'
                ? payload.incomingSpeed || 0
                : style.intensity === 'foot'
                  ? foot * s.footWeight
                  : payload.speed || 0;
        return Math.min(s.max, Math.max(s.min, speed / s.referenceSpeed));
    }

    configure(node, payload) {
        const key = impactStyleKey(this.styles, payload),
            style = this.styles[key];
        const reduced = this.reducedMotion();
        const strength = this.strengthOf(style, payload);
        node.style = style;
        node.strength = strength;
        node.life = style.life * Math.sqrt(strength);
        // 물체 자체 반응(표시 전용): 켜진 것만 이 노드에 기록하고 view가 경과 시간으로 읽는다. 동작 줄이기에서는 왜곡·히트스톱·진동·반짝임·눌림을 끈다.
        node.playerId = payload.playerId ?? -1;
        node.part = payload.part ?? '';
        node.flashFrames = !reduced && key !== 'body';
        node.groundPulse = !reduced && payload.kind === 'ground';
        node.waveStrength = reduced ? 0 : (style.wave || 0) * strength;
        node.shadeStrength = reduced ? 0 : (style.shade || 0) * strength;
        node.waveScale = style.waveScale * this.impact.wave.reach * Math.sqrt(strength);
        node.fov = reduced ? 0 : (style.fovPunch || 0) * strength;
        node.squash = reduced ? 0 : Math.min(0.42, (style.squash || 0) * strength);
        node.squashDecay = style.squashDecay ?? 13;
        node.squashFreq = style.squashFreq ?? 34;
        const fv0 = payload.footVelocity,
            fl0 = fv0 ? Math.hypot(fv0.x, fv0.y, fv0.z) : 0;
        if (style.squashAxis === 'up') node.squashAxis.copy(this.axisUp);
        else
            node.squashAxis.set(
                fl0 > 0.5 ? fv0.x / fl0 : 0,
                fl0 > 0.5 ? fv0.y / fl0 : 0,
                fl0 > 0.5 ? fv0.z / fl0 : 0,
            );
        node.hold = reduced ? 0 : style.hold;
        node.displayHold = reduced ? 0 : (style.displayHold || 0) * 1000;
        node.shake = style.shake && !reduced ? style.shake : null;
        node.group.position.set(payload.position.x, payload.position.y, payload.position.z);
        // tick과 sequence가 같으면 두 피어와 재확정에서 같은 방향이 나온다.
        const unit = takrawEventUnits(deterministic, this.seed, payload);
        this.configureElement(node, payload, unit, reduced);
    }

    /** 스파이크이고 팀 학교에 속성이 있으면 속성 입자 구름을 시드 난수로 배치한다. 구름은 공이 나가는 쪽(발 속도 방향)의 반대편에만 둔다. */
    configureElement(node, payload, unit, reduced) {
        const element = payload.spike
            ? this.elementConfig.byElement[this.elements[payload.team === 1 ? 1 : 0]]
            : null;
        node.particleCount = 0;
        if (!element) return;
        const f = payload.footVelocity,
            fl = f ? Math.hypot(f.x, f.y, f.z) : 0;
        // 방향이 없으면 위쪽을 앞으로 본다.
        if (fl > 0.5) node.elementForward.set(f.x / fl, f.y / fl, f.z / fl);
        else node.elementForward.set(0, 1, 0);
        node.edge.setHex(element.edge);
        element.colors.forEach((color, index) => node.colors[index].setHex(color));
        let index = 0;
        for (const part of element.parts) {
            const count = reduced ? Math.floor(part.n * 0.4) : part.n;
            for (let k = 0; k < count && index < node.particles.length; k++, index++) {
                const particle = node.particles[index],
                    angle = unit() * Math.PI * 2,
                    lift = unit();
                const speed = part.speed * (0.6 + unit() * 0.8),
                    up = part.dir === 'flat' ? 0 : part.up * (0.4 + lift * 0.8);
                particle.shape = part.shape;
                particle.color = part.c;
                particle.angle = angle;
                particle.vx = Math.cos(angle) * speed;
                particle.vz = Math.sin(angle) * speed;
                particle.vy = up;
                if (part.dir === 'up') {
                    particle.vx *= 0.45;
                    particle.vz *= 0.45;
                }
                particle.g = part.g;
                particle.size = part.size * (0.7 + unit() * 0.6);
                particle.start = (part.delay || 0) * this.elementConfig.life;
                particle.life = part.life * this.elementConfig.life * (0.8 + unit() * 0.2);
                particle.spin = part.spin * (unit() < 0.5 ? -1 : 1);
                particle.roll = unit() * Math.PI * 2;
                particle.grow = part.grow || 1;
                particle.flicker = !!part.flicker && !reduced;
                particle.swirl =
                    part.dir === 'swirl' ? (2.2 + unit() * 2) * (unit() < 0.5 ? -1 : 1) : 0;
                particle.radius = part.dir === 'swirl' ? 0.12 + unit() * 0.12 : 0;
                // 방향이 있는 모양(streak·bolt)은 접촉점에서 바깥으로 향한다. 발 속도가 있으면 그 축 쪽으로 기울인다.
                const dx = particle.vx + (fl > 0.5 ? f.x / fl : 0) * 0.6,
                    dy = particle.vy + (fl > 0.5 ? f.y / fl : 0) * 0.6,
                    dz = particle.vz + (fl > 0.5 ? f.z / fl : 0) * 0.6;
                const size = Math.hypot(dx, dy, dz) || 1;
                particle.direction.set(dx / size, dy / size, dz / size);
                particle.length = part.size * (0.7 + unit() * 0.6);
            }
        }
        node.particleCount = index;
    }

    /** 경과 시간으로 입자 구름이 보이는지와 그 시각을 정한다. 정지 구간(hold)에는 첫 모습을 유지한다. 입자는 drawCloud가 그린다. */
    apply(node, ageMs) {
        if (!node.style) return;
        const t = Math.max(0, ageMs - node.hold * 1000) / 1000;
        node.group.visible = node.particleCount > 0 && t < this.elementConfig.life;
        node.particleTime = t;
    }

    /** 프레임마다 한 번: 보이는 노드의 입자를 모양별 인스턴스 버퍼에 쓴다. 드로우콜은 입자 수와 무관하다. */
    drawCloud() {
        const cloud = this.cloud;
        cloud.begin();
        for (const node of this.active)
            if (node.group.visible && node.particleCount)
                this.writeParticles(node, node.particleTime);
        cloud.end();
    }

    /** 속성 입자의 위치·크기·방향을 경과 시간 t(초)로 정해 인스턴스에 쓴다. 시작 전과 끝난 뒤에는 쓰지 않는다. */
    writeParticles(node, t) {
        const cloud = this.elementConfig.cloud,
            margin = this.elementConfig.ballMargin,
            grow = this.elementConfig.rim,
            forward = node.elementForward,
            origin = node.group.position,
            { position, scale, quaternion, spin } = this;
        for (let i = 0; i < node.particleCount; i++) {
            const particle = node.particles[i],
                local = t - particle.start,
                progress = local / particle.life;
            if (
                local < 0 ||
                progress >= 1 ||
                (particle.flicker && Math.floor(local * 32 + i) % 3 === 0)
            )
                continue;
            let x = particle.vx * local + Math.cos(particle.angle) * margin,
                z = particle.vz * local + Math.sin(particle.angle) * margin;
            if (particle.swirl) {
                // 접촉점 둘레를 돌며 퍼진다.
                const a = Math.atan2(particle.vz, particle.vx) + particle.swirl * local,
                    r = particle.radius + Math.hypot(particle.vx, particle.vz) * local * 0.8;
                x = Math.cos(a) * (r + margin);
                z = Math.sin(a) * (r + margin);
            }
            const y = particle.vy * local - 0.5 * particle.g * local * local;
            position.set(x, y, z);
            // 구름 크기·거리를 줄이되 공 표면에서 시작하는 간격(ballMargin)은 지키고, 공이 나가는 쪽으로 간 입자는 반대편으로 접어 넣는다.
            const length = position.length() || 1;
            position.multiplyScalar(cloud + (margin * (1 - cloud)) / length);
            const ahead = position.dot(forward);
            if (ahead > 0) position.addScaledVector(forward, -2 * ahead);
            let direction = particle.direction;
            if (direction.dot(forward) > 0) {
                direction = this.cloudDirection.copy(direction);
                direction.addScaledVector(forward, -2 * direction.dot(forward));
            }
            position.add(origin);
            const lengthwise = particle.shape === 'streak' || particle.shape === 'bolt';
            let size;
            if (lengthwise) {
                // 길이 방향(z)으로 뻗는 모양: 머리가 먼저 나가고 꼬리가 줄어든다.
                size = Math.max(0.001, particle.length * cloud * (1 - progress));
                scale.set(1, 1, size);
                quaternion.setFromUnitVectors(this.axisZ, direction);
            } else {
                size = Math.max(
                    0.001,
                    particle.size *
                        cloud *
                        (1 + (particle.grow - 1) * progress) *
                        (1 - progress * progress),
                );
                scale.setScalar(size);
                if (this.camera) quaternion.copy(this.camera.quaternion);
                else quaternion.identity();
                spin.setFromAxisAngle(this.axisZ, particle.roll + particle.spin * local);
                quaternion.multiply(spin);
            }
            this.bodyMatrix.compose(position, quaternion, scale);
            // 테두리: 본체와 같은 위치·방향에서 모양만 rim 배율로 키운다. 길이 방향 모양은 굵기만 키운다.
            if (lengthwise) scale.set(grow * 2, grow * 2, size * 1.06);
            else scale.setScalar(size * grow);
            this.rimMatrix.compose(position, quaternion, scale);
            this.cloud.add(
                particle.shape,
                this.bodyMatrix,
                this.rimMatrix,
                node.colors[particle.color],
                node.edge,
                RIM_OPACITY,
            );
        }
    }

    /** 접촉 순간(flash.ms 동안) 밝아져야 하는 물체 이름을 keys(Set)에 더한다: 공 'ball'과 닿은 부위 'p{선수}:{부위}'. */
    collectFlash(keys) {
        for (const node of this.active) {
            if (!node.flashFrames || node.age >= this.impact.flash.ms) continue;
            keys.add('ball');
            if (node.playerId >= 0 && node.part) keys.add(`p${node.playerId}:${node.part}`);
        }
    }

    /** 공 그림자 반응: 바닥 튕김 직후 0→1→0으로 오르내리는 값(여러 개면 가장 큰 값). */
    shadowPulse() {
        let best = 0;
        for (const node of this.active) {
            if (!node.groundPulse) continue;
            const q = node.age / 1000 / this.impact.shadow.life;
            if (q < 1) best = Math.max(best, Math.sin(Math.PI * q));
        }
        return best;
    }

    /**
     * 지금 퍼지는 쇼크웨이브를 out(미리 만든 { x, y, z, radius, width, distort, shade } 배열)에 채우고 개수를 돌려준다.
     * 반지름·수명은 visual.impact.wave와 style을 따르고, 세기는 끝으로 갈수록 0이 된다. 넘치면 가장 오래된 것을 버린다.
     * distort: 밀림(화면 높이 비율, 세기에 가파르게 묶임), shade: 명암 세기(왜곡과 따로 정한다).
     */
    waves(out) {
        const wave = this.impact.wave;
        let count = 0;
        for (const node of this.active) {
            if (node.waveStrength <= 0) continue;
            const q = node.age / 1000 / (node.life * wave.lifeShare);
            if (!(q < 1)) continue;
            const radius =
                wave.radius * (wave.start + node.waveScale * (1 - (1 - q) ** wave.growth));
            const fade = 1 - q ** wave.fade,
                level = node.waveStrength / node.strength; // style.wave(접촉 세기 제외)
            const slot = out[count++ % out.length];
            slot.x = node.group.position.x;
            slot.y = node.group.position.y;
            slot.z = node.group.position.z;
            slot.radius = radius;
            slot.width = radius * wave.width;
            slot.distort = wave.amount * level ** wave.distortPower * node.strength * fade;
            slot.shade = node.shadeStrength * fade;
        }
        return Math.min(count, out.length);
    }

    /**
     * 카메라 진동 변위(CSS px)를 out에 쓴다. 여러 접촉이 겹쳐도 합산하지 않고 가장 센 하나만 쓰며 shakeCap을 넘지 않는다.
     * 단위가 px라 화면 크기와 무관하게 같은 체감이다. 화면 좌표 변환은 뷰가 맡는다.
     */
    shake(out) {
        out.x = 0;
        out.y = 0;
        let best = null,
            bestStrength = 0;
        for (const node of this.active) {
            const shake = node.shake,
                elapsed = node.age / 1000;
            if (!shake || elapsed >= shake.duration) continue;
            const strength =
                Math.min(this.shakeCap, shake.amplitude) * (1 - elapsed / shake.duration) ** 2;
            if (strength > bestStrength) {
                best = node;
                bestStrength = strength;
            }
        }
        if (best) {
            const elapsed = best.age / 1000;
            out.x = Math.sin(elapsed * 95) * bestStrength;
            out.y = Math.cos(elapsed * 113) * bestStrength;
        }
        return out;
    }

    /** 활성 효과의 화면 확대 비율(시야각을 줄이는 양)을 합산해 돌려준다. 맞은 직후 가장 크고 제곱으로 빠르게 줄어든다. */
    punch() {
        let amount = 0;
        for (const node of this.active) {
            if (!node.fov) continue;
            const elapsed = Math.max(0, node.age - node.hold * 1000) / 1000,
                duration = Math.max(0.12, node.style.life * 0.6);
            if (elapsed < duration)
                amount = Math.max(amount, node.fov * (1 - elapsed / duration) ** 2);
        }
        return amount;
    }

    /**
     * 표시 전용 히트스톱의 포즈 고정 비율(0~1). 1이면 내 화면의 선수·공 포즈를 멈춘 그대로 두고,
     * 0과 1 사이면 멈춘 포즈에서 지금 포즈로 따라잡는 중이다. 시뮬레이션·입력·네트워크·효과 시계는 멈추지 않는다.
     */
    poseHold() {
        let hold = 0;
        for (const node of this.active) {
            if (!node.displayHold) continue;
            const h = node.displayHold,
                catchUp = h * this.impact.displayCatchUp;
            const value =
                node.age < h ? 1 : node.age < h + catchUp ? (1 - (node.age - h) / catchUp) ** 2 : 0;
            hold = Math.max(hold, value);
        }
        return hold;
    }

    /**
     * 공의 눌림(squash)을 { axis, amount }로 돌려준다. 가장 센 활성 접촉 하나만 쓴다.
     * amount > 0: axis(맞은 방향)로 눌리고 수직으로 퍼진다. 눌렸다가 살짝 늘어나며 0으로 돌아온다. 외형만 바꾸며 collider·판정은 건드리지 않는다.
     */
    deform() {
        const out = this.deformation;
        out.amount = 0;
        for (const node of this.active) {
            if (!node.squash) continue;
            const elapsed = node.age / 1000,
                amount =
                    node.squash *
                    Math.exp(-elapsed * node.squashDecay) *
                    Math.cos(elapsed * node.squashFreq);
            if (Math.abs(amount) > Math.abs(out.amount)) {
                out.amount = amount;
                out.axis.copy(node.squashAxis);
            }
        }
        if (out.axis.lengthSq() === 0) out.amount = 0;
        return out;
    }

    /** 입자 모양 판(반지름 1, xy 평면). streak·bolt는 길이 1짜리 상자·지그재그 띠로 z축 방향으로 놓는다. */
    createShapeGeometries() {
        const T = this.THREE,
            shape = (points) => {
                const s = new T.Shape();
                points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
                s.closePath();
                return new T.ShapeGeometry(s);
            };
        const leaf = new T.Shape();
        leaf.moveTo(1, 0);
        leaf.quadraticCurveTo(0, 0.7, -1, 0);
        leaf.quadraticCurveTo(0, -0.7, 1, 0);
        const crescent = new T.Shape();
        crescent.absarc(0, 0, 1, -1.9, 1.9, false);
        crescent.absarc(0.45, 0, 0.85, 1.7, -1.7, true);
        // 지그재그 번개 띠: z축을 따라 -.5~.5, x로 흔들린다(고정 모양, 깜빡임은 flicker가 맡는다).
        const bolt = new T.BufferGeometry(),
            zig = [
                [0, -0.5],
                [0.18, -0.3],
                [-0.12, -0.1],
                [0.2, 0.1],
                [-0.15, 0.3],
                [0, 0.5],
            ],
            vertices = [],
            width = 0.025;
        for (let i = 0; i < zig.length - 1; i++) {
            const [x0, z0] = zig[i],
                [x1, z1] = zig[i + 1];
            vertices.push(
                x0 - width,
                0,
                z0,
                x0 + width,
                0,
                z0,
                x1 - width,
                0,
                z1,
                x0 + width,
                0,
                z0,
                x1 + width,
                0,
                z1,
                x1 - width,
                0,
                z1,
            );
        }
        bolt.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
        return {
            dot: new T.CircleGeometry(1, 8),
            hex: new T.CircleGeometry(1, 6),
            diamond: shape([
                [1, 0],
                [0, 0.6],
                [-1, 0],
                [0, -0.6],
            ]),
            shard: shape([
                [1, 0],
                [-0.6, 0.35],
                [-0.3, 0],
                [-0.6, -0.35],
            ]),
            leaf: new T.ShapeGeometry(leaf),
            crescent: new T.ShapeGeometry(crescent),
            flake: this.createStarGeometry(6),
            star: this.createStarGeometry(4),
            bolt,
            streak: this.streakGeometry,
        };
    }

    /** 뾰족한 별 모양 판(반지름 1). flake·star 입자에 쓴다. */
    createStarGeometry(points) {
        const T = this.THREE,
            shape = new T.Shape();
        for (let i = 0; i < points * 2; i++) {
            const angle = (i * Math.PI) / points,
                radius = i % 2 ? 0.28 : 1;
            if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
            else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        shape.closePath();
        return new T.ShapeGeometry(shape);
    }

    dispose() {
        this.cloud.dispose();
        for (const [id, geometry] of Object.entries(this.shapeGeometries))
            if (id !== 'streak') geometry.dispose();
        this.streakGeometry.dispose();
        this.active.clear();
        this.pool.clear();
        this.nodes.length = 0;
    }
}

export { TakrawImpactEffects, impactStyleKey, takrawContactKind };
