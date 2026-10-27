import { ObjectPool } from '@bloom-gamekit/object-pool';
import { SeededPRNG, statelessRandom } from '@bloom-gamekit/deterministic';

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
    this.seed = config.network.seed;
    this.reducedMotion = reducedMotion;
    this.puffGeometry = new THREE.CircleGeometry(1, 14);
    this.confettiGeometry = new THREE.PlaneGeometry(.09, .05);
    this.nodes = [];
    this.active = new Set();
    this.landPool = new ObjectPool(() => this.createLand(), node => this.reset(node), 6);
    this.confettiPool = new ObjectPool(() => this.createConfetti(), node => this.reset(node), 4);
  }

  createLand() {
    const T = this.THREE, group = new T.Group(); group.visible = false; this.scene.add(group);
    const material = new T.MeshBasicMaterial({ color: this.style.land.color, transparent: true, depthWrite: false });
    const puffs = [];
    for (let i = 0; i < this.style.land.puffs; i++) {
      const mesh = new T.Mesh(this.puffGeometry, material); mesh.rotation.x = -Math.PI / 2; group.add(mesh);
      puffs.push({ mesh, vx: 0, vz: 0, size: 1, rise: 0 });
    }
    const node = { kind: 'land', group, material, puffs, life: this.style.land.life, age: 0 };
    this.nodes.push(node);
    return node;
  }

  createConfetti() {
    const T = this.THREE, group = new T.Group(); group.visible = false; this.scene.add(group);
    const materials = this.style.confetti.colors.map(color => new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, depthWrite: false }));
    const pieces = [];
    for (let i = 0; i < this.style.confetti.count; i++) {
      const mesh = new T.Mesh(this.confettiGeometry, materials[i % materials.length]); group.add(mesh);
      pieces.push({ mesh, vx: 0, vy: 0, vz: 0, spinX: 0, spinZ: 0, phase: 0 });
    }
    const node = { kind: 'confetti', group, materials, pieces, life: this.style.confetti.life, age: 0 };
    this.nodes.push(node);
    return node;
  }

  reset(node) { node.group.visible = false; node.age = 0; }

  rng(payload) {
    const rng = new SeededPRNG(statelessRandom(this.seed, (payload.tick * 16 + payload.sequence) >>> 0));
    return () => rng.nextUint32() / 4294967296;
  }

  /** 선수 착지 이벤트로 먼지를 시작한다. 약한 착지는 null을 돌려준다. */
  startLand(payload) {
    if (this.reducedMotion() || (payload.speed || 0) < this.style.land.minSpeed) return null;
    const node = this.landPool.acquire(), unit = this.rng(payload);
    node.group.position.set(payload.position.x, .04, payload.position.z);
    const strength = Math.min(1.4, .6 + (payload.speed || 0) * .08);
    for (const puff of node.puffs) {
      const angle = unit() * Math.PI * 2, speed = (.5 + unit() * .9) * strength;
      puff.vx = Math.cos(angle) * speed; puff.vz = Math.sin(angle) * speed;
      puff.size = (.10 + unit() * .12) * strength; puff.rise = .05 + unit() * .12;
    }
    return this.begin(node, 0);
  }

  /** 득점 이벤트로 색종이를 시작한다. 득점 팀 쪽 코트 위에서 흩뿌린다. */
  startConfetti(payload) {
    if (this.reducedMotion()) return null;
    const node = this.confettiPool.acquire(), unit = this.rng(payload), { height, spread } = this.style.confetti;
    node.group.position.set(payload.position.x, 0, payload.position.z);
    for (const piece of node.pieces) {
      const angle = unit() * Math.PI * 2, speed = unit() * spread;
      piece.vx = Math.cos(angle) * speed * .6; piece.vz = Math.sin(angle) * speed * .6;
      piece.vy = height * (.55 + unit() * .6);
      piece.spinX = (unit() - .5) * 18; piece.spinZ = (unit() - .5) * 18; piece.phase = unit() * Math.PI * 2;
    }
    return this.begin(node, 0);
  }

  begin(node, ageMs) {
    this.active.add(node);
    node.age = ageMs;
    this.apply(node, ageMs);
    return node;
  }

  update(node, ageMs) { node.age = ageMs; this.apply(node, ageMs); }

  release(node) {
    if (!node || !this.active.delete(node)) return;
    (node.kind === 'land' ? this.landPool : this.confettiPool).release(node);
  }

  apply(node, ageMs) {
    const t = Math.max(0, ageMs) / 1000, progress = Math.min(1, t / node.life);
    node.group.visible = progress < 1;
    if (node.kind === 'land') {
      node.material.opacity = (1 - progress) ** 1.5 * .55;
      for (const puff of node.puffs) {
        const ease = 1 - (1 - progress) ** 2;
        puff.mesh.position.set(puff.vx * ease * .9, puff.rise * ease, puff.vz * ease * .9);
        puff.mesh.scale.setScalar(puff.size * (.6 + ease * 1.8));
      }
      return;
    }
    const fade = progress > .75 ? 1 - (progress - .75) / .25 : 1;
    for (const material of node.materials) material.opacity = fade;
    for (const piece of node.pieces) {
      // 포물선으로 올랐다가 공기 저항으로 천천히 흔들리며 떨어진다.
      const y = Math.max(0, piece.vy * t - 2.6 * t * t), sway = Math.sin(t * 5 + piece.phase) * .12 * Math.min(1, t * 2);
      piece.mesh.position.set(piece.vx * t * (1 - progress * .4) + sway, y, piece.vz * t * (1 - progress * .4));
      piece.mesh.rotation.set(piece.spinX * t, 0, piece.spinZ * t);
    }
  }

  dispose() {
    for (const node of this.nodes) {
      this.scene.remove(node.group);
      if (node.material) node.material.dispose();
      if (node.materials) for (const material of node.materials) material.dispose();
    }
    this.puffGeometry.dispose(); this.confettiGeometry.dispose();
    this.active.clear(); this.landPool.clear(); this.confettiPool.clear(); this.nodes.length = 0;
  }
}

export { TakrawFieldEffects };
