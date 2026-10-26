import { ObjectPool } from '@bloom-gamekit/object-pool';
import { SeededPRNG, statelessRandom } from '@bloom-gamekit/deterministic';

const TEAM_COLORS = Object.freeze([0xe7f6b3, 0xffd6b4]);

/**
 * 접촉 효과(링·입자·카메라 진동량·공 강조)의 단일 소유자.
 * - 수명과 모양은 presentation-events 저널이 알려 주는 경과 시간(ageMs)의 함수다.
 *   프레임 간격을 누적하지 않으므로 프레임 속도, 롤백 재확정, 두 피어의 화면에서 같은 모습이 된다.
 * - 입자 방향은 접촉 이벤트의 tick·sequence에서 만든 시드 난수로 정한다. Math.random을 쓰지 않는다.
 * - 효과 노드는 object-pool로 재사용한다. 장면 객체를 만들지 않고 시뮬레이션 시간도 건드리지 않는다.
 */
class TakrawImpactEffects {
  constructor({ THREE, scene, config, reducedMotion = () => false }) {
    this.THREE = THREE;
    this.scene = scene;
    this.styles = config.visual.impact;
    this.seed = config.network.seed;
    this.reducedMotion = reducedMotion;
    this.ringGeometry = new THREE.TorusGeometry(.13, .009, 4, 20);
    this.dotGeometry = new THREE.SphereGeometry(.024, 5, 4);
    this.maxDots = Math.max(...Object.values(this.styles).map(style => style.dots));
    this.nodes = [];
    this.active = new Set();
    this.pool = new ObjectPool(() => this.createNode(), node => this.resetNode(node), 16);
  }

  createNode() {
    const T = this.THREE;
    const group = new T.Group(); group.visible = false; this.scene.add(group);
    const dotMaterial = new T.MeshBasicMaterial({ color: 0xfff1be, transparent: true, depthWrite: false });
    const ringMaterial = new T.MeshBasicMaterial({ color: 0xfff1be, transparent: true, depthWrite: false });
    const ring = new T.Mesh(this.ringGeometry, ringMaterial), outer = new T.Mesh(this.ringGeometry, ringMaterial);
    group.add(ring, outer);
    const dots = [];
    for (let i = 0; i < this.maxDots; i++) {
      const mesh = new T.Mesh(this.dotGeometry, dotMaterial);
      group.add(mesh);
      dots.push({ mesh, vx: 0, vy: 0, vz: 0 });
    }
    const node = { group, ring, outer, dots, dotMaterial, ringMaterial,
      style: null, hold: 0, outerRing: false, shake: null, age: 0 };
    this.nodes.push(node);
    return node;
  }

  resetNode(node) {
    node.group.visible = false;
    node.style = null; node.shake = null; node.age = 0;
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

  configure(node, payload) {
    const style = this.styles[payload.timing?.grade] ?? this.styles.normal;
    const reduced = this.reducedMotion();
    node.style = style;
    node.hold = reduced ? 0 : style.hold;
    node.outerRing = !!style.outerRing && !reduced;
    node.shake = style.shake && !reduced ? style.shake : null;
    node.group.position.set(payload.position.x, payload.position.y, payload.position.z);
    // tick과 sequence가 같으면 두 피어와 재확정에서 같은 방향이 나온다.
    const rng = new SeededPRNG(statelessRandom(this.seed, (payload.tick * 16 + payload.sequence) >>> 0));
    const unit = () => rng.nextUint32() / 4294967296;
    node.ring.rotation.set(unit() * Math.PI, unit() * Math.PI, 0);
    node.outer.rotation.copy(node.ring.rotation);
    const teamColor = TEAM_COLORS[payload.team === 1 ? 1 : 0];
    node.dotMaterial.color.setHex(teamColor);
    node.ringMaterial.color.setHex(style.ringColor ?? teamColor);
    const speed = Math.min(1.3, .40 + (payload.speed || 0) * .035);
    for (const [index, dot] of node.dots.entries()) {
      const angle = unit() * Math.PI * 2;
      dot.vx = Math.cos(angle) * speed; dot.vy = unit() * speed + .12; dot.vz = Math.sin(angle) * speed;
      dot.mesh.visible = index < style.dots;
    }
  }

  /** 경과 시간으로 모양을 정한다. 정지 구간(hold)에는 첫 모습을 유지한다. */
  apply(node, ageMs) {
    const style = node.style;
    if (!style) return;
    const t = Math.max(0, ageMs - node.hold * 1000) / 1000;
    const progress = Math.min(1, t / style.life);
    const alive = progress < 1;
    node.group.visible = alive;
    node.dotMaterial.opacity = node.ringMaterial.opacity = (1 - progress) * .80;
    node.ring.scale.setScalar(.65 + progress * style.ringScale);
    node.outer.visible = alive && node.outerRing;
    node.outer.scale.setScalar(.65 + progress * style.ringScale * 1.6);
    for (const dot of node.dots) dot.mesh.position.set(dot.vx * t, dot.vy * t - t * t, dot.vz * t);
  }

  /** 활성 효과의 카메라 진동 변위(m)를 합산해 out에 쓴다. */
  shake(out) {
    out.x = 0; out.y = 0;
    for (const node of this.active) {
      const shake = node.shake, elapsed = node.age / 1000;
      if (!shake || elapsed >= shake.duration) continue;
      const strength = shake.amplitude * (1 - elapsed / shake.duration) ** 2;
      out.x += Math.sin(elapsed * 95) * strength;
      out.y += Math.cos(elapsed * 113) * strength;
    }
    return out;
  }

  /** 공 궤적을 강조 중이면 { color, duration }, 아니면 null. */
  trailBoost() {
    for (const node of this.active) {
      const trail = node.style?.trail;
      if (trail && node.age < trail.duration * 1000) return trail;
    }
    return null;
  }

  dispose() {
    for (const node of this.nodes) {
      this.scene.remove(node.group);
      node.dotMaterial.dispose(); node.ringMaterial.dispose();
    }
    this.ringGeometry.dispose(); this.dotGeometry.dispose();
    this.active.clear(); this.pool.clear(); this.nodes.length = 0;
  }
}

export { TakrawImpactEffects };
