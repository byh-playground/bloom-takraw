import { ObjectPool } from '@bloom-gamekit/object-pool';
import * as deterministic from '@bloom-gamekit/deterministic';
import { takrawEventUnits } from '../simulation/random.js';
import { InstanceLayer } from '@bloom-gamekit/three-kit';

/**
 * 코트 바닥·득점 연출(착지 먼지, 득점 색종이)의 단일 소유자.
 * impact.js와 같은 규칙을 따른다: 모양은 저널이 알려 주는 경과 시간(ageMs)의 함수이고, 난수는 이벤트의 tick·sequence 시드이며,
 * 노드는 object-pool로 재사용하고, 시뮬레이션 상태를 읽거나 쓰지 않는다.
 */
class TakrawFieldEffects {
    constructor({ THREE, scene, config, reducedMotion = () => false }) {
        this.THREE = THREE;
        this.scene = scene;
        this.style = config.visual.field;
        this.seed = config.visual.effectSeed;
        this.reducedMotion = reducedMotion;
        this.puffGeometry = new THREE.CircleGeometry(1, 14);
        this.confettiGeometry = new THREE.PlaneGeometry(0.09, 0.05);
        // 먼지 퍼프와 색종이는 노드·조각 수와 무관하게 인스턴스 레이어 하나씩으로 그린다(DEV-034). 투명도는 인스턴스마다 다르다.
        // 칸은 먼지 노드 16개·색종이 노드 4개가 동시에 겹쳐도 넘치지 않는 수다.
        this.puffs = new InstanceLayer(THREE, {
            geometry: this.puffGeometry,
            capacity: this.style.land.puffs * 16,
        });
        this.confetti = new InstanceLayer(THREE, {
            geometry: this.confettiGeometry,
            capacity: this.style.confetti.count * 4,
            side: THREE.DoubleSide,
        });
        scene.add(this.puffs.mesh, this.confetti.mesh);
        this.palette = this.style.confetti.colors.map((color) => new THREE.Color(color));
        this.tint = new THREE.Color(this.style.land.color);
        this.flat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            -Math.PI / 2,
        );
        this.quaternion = new THREE.Quaternion();
        this.euler = new THREE.Euler();
        this.position = new THREE.Vector3();
        this.scale = new THREE.Vector3();
        this.matrix = new THREE.Matrix4();
        this.nodes = [];
        this.active = new Set();
        this.landPool = new ObjectPool(
            () => this.createLand(),
            (node) => this.reset(node),
            6,
        );
        this.confettiPool = new ObjectPool(
            () => this.createConfetti(),
            (node) => this.reset(node),
            4,
        );
    }

    createLand() {
        const T = this.THREE;
        const puffs = [];
        for (let i = 0; i < this.style.land.puffs; i++)
            puffs.push({ vx: 0, vz: 0, size: 1, rise: 0, x: 0, y: 0, z: 0, scale: 1 });
        // group은 위치만 담는다(장면에 올리지 않는다). 퍼프는 인스턴스로 그린다.
        const group = new T.Group();
        group.visible = false;
        const node = {
            kind: 'land',
            group,
            puffs,
            opacity: 0,
            life: this.style.land.life,
            age: 0,
        };
        this.nodes.push(node);
        return node;
    }

    createConfetti() {
        const T = this.THREE;
        const pieces = [];
        for (let i = 0; i < this.style.confetti.count; i++)
            pieces.push({
                vx: 0,
                vy: 0,
                vz: 0,
                spinX: 0,
                spinZ: 0,
                phase: 0,
                x: 0,
                y: 0,
                z: 0,
                rx: 0,
                rz: 0,
            });
        const group = new T.Group();
        group.visible = false;
        const node = {
            kind: 'confetti',
            group,
            pieces,
            opacity: 1,
            life: this.style.confetti.life,
            age: 0,
        };
        this.nodes.push(node);
        return node;
    }

    /** 로딩 단계에서 착지 먼지·득점 색종이 노드를 미리 만들어 장면에 올려 둔다(DEV-032). */
    warm({ land, confetti }) {
        const nodes = [
            ...Array.from({ length: land }, () => this.landPool.acquire()),
            ...Array.from({ length: confetti }, () => this.confettiPool.acquire()),
        ];
        for (const node of nodes)
            (node.kind === 'land' ? this.landPool : this.confettiPool).release(node);
    }

    reset(node) {
        node.group.visible = false;
        node.age = 0;
    }

    /** 선수 착지 이벤트로 먼지를 시작한다. 약한 착지는 null을 돌려준다. */
    startLand(payload) {
        if (this.reducedMotion() || (payload.speed || 0) < this.style.land.minSpeed) return null;
        const node = this.landPool.acquire(),
            unit = takrawEventUnits(deterministic, this.seed, payload);
        node.group.position.set(payload.position.x, 0.04, payload.position.z);
        const strength = Math.min(1.4, 0.6 + (payload.speed || 0) * 0.08);
        for (const puff of node.puffs) {
            const angle = unit() * Math.PI * 2,
                speed = (0.5 + unit() * 0.9) * strength;
            puff.vx = Math.cos(angle) * speed;
            puff.vz = Math.sin(angle) * speed;
            puff.size = (0.1 + unit() * 0.12) * strength;
            puff.rise = 0.05 + unit() * 0.12;
        }
        return this.begin(node, 0);
    }

    /** 득점 이벤트로 색종이를 시작한다. 득점 팀 쪽 코트 위에서 흩뿌린다. */
    startConfetti(payload) {
        if (this.reducedMotion()) return null;
        const node = this.confettiPool.acquire(),
            unit = takrawEventUnits(deterministic, this.seed, payload),
            { height, spread } = this.style.confetti;
        node.group.position.set(payload.position.x, 0, payload.position.z);
        for (const piece of node.pieces) {
            const angle = unit() * Math.PI * 2,
                speed = unit() * spread;
            piece.vx = Math.cos(angle) * speed * 0.6;
            piece.vz = Math.sin(angle) * speed * 0.6;
            piece.vy = height * (0.55 + unit() * 0.6);
            piece.spinX = (unit() - 0.5) * 18;
            piece.spinZ = (unit() - 0.5) * 18;
            piece.phase = unit() * Math.PI * 2;
        }
        return this.begin(node, 0);
    }

    begin(node, ageMs) {
        this.active.add(node);
        node.age = ageMs;
        this.apply(node, ageMs);
        return node;
    }

    update(node, ageMs) {
        node.age = ageMs;
        this.apply(node, ageMs);
    }

    release(node) {
        if (!node || !this.active.delete(node)) return;
        (node.kind === 'land' ? this.landPool : this.confettiPool).release(node);
    }

    /** 경과 시간으로 조각의 위치·투명도를 정한다. 그리기는 draw()가 한다. */
    apply(node, ageMs) {
        const t = Math.max(0, ageMs) / 1000,
            progress = Math.min(1, t / node.life);
        node.group.visible = progress < 1;
        if (node.kind === 'land') {
            node.opacity = (1 - progress) ** 1.5 * 0.55;
            for (const puff of node.puffs) {
                const ease = 1 - (1 - progress) ** 2;
                puff.x = puff.vx * ease * 0.9;
                puff.y = puff.rise * ease;
                puff.z = puff.vz * ease * 0.9;
                puff.scale = puff.size * (0.6 + ease * 1.8);
            }
            return;
        }
        node.opacity = progress > 0.75 ? 1 - (progress - 0.75) / 0.25 : 1;
        for (const piece of node.pieces) {
            // 포물선으로 올랐다가 공기 저항으로 천천히 흔들리며 떨어진다.
            const y = Math.max(0, piece.vy * t - 2.6 * t * t),
                sway = Math.sin(t * 5 + piece.phase) * 0.12 * Math.min(1, t * 2);
            piece.x = piece.vx * t * (1 - progress * 0.4) + sway;
            piece.y = y;
            piece.z = piece.vz * t * (1 - progress * 0.4);
            piece.rx = piece.spinX * t;
            piece.rz = piece.spinZ * t;
        }
    }

    /** 프레임마다 한 번: 살아 있는 노드의 퍼프·색종이를 인스턴스 버퍼에 쓴다. 드로우콜은 조각 수와 무관하다. */
    draw() {
        const { puffs, confetti, position, scale, quaternion, matrix } = this;
        puffs.begin();
        confetti.begin();
        for (const node of this.active) {
            if (!node.group.visible) continue;
            const origin = node.group.position;
            if (node.kind === 'land') {
                for (const puff of node.puffs) {
                    position.set(puff.x + origin.x, puff.y + origin.y, puff.z + origin.z);
                    scale.setScalar(puff.scale);
                    matrix.compose(position, this.flat, scale);
                    puffs.add(matrix, this.tint, node.opacity);
                }
                continue;
            }
            scale.set(1, 1, 1);
            node.pieces.forEach((piece, index) => {
                position.set(piece.x + origin.x, piece.y + origin.y, piece.z + origin.z);
                quaternion.setFromEuler(this.euler.set(piece.rx, 0, piece.rz));
                matrix.compose(position, quaternion, scale);
                confetti.add(matrix, this.palette[index % this.palette.length], node.opacity);
            });
        }
        puffs.end();
        confetti.end();
    }

    dispose() {
        this.scene.remove(this.puffs.mesh, this.confetti.mesh);
        this.puffs.dispose();
        this.confetti.dispose();
        this.puffGeometry.dispose();
        this.confettiGeometry.dispose();
        this.active.clear();
        this.landPool.clear();
        this.confettiPool.clear();
        this.nodes.length = 0;
    }
}

export { TakrawFieldEffects };
