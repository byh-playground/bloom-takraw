import { ObjectPool } from '@bloom-gamekit/object-pool';
import { SeededPRNG, statelessRandom } from '@bloom-gamekit/deterministic';

/** 접촉 payload가 쓰는 연출 등급 이름. 스파이크가 타이밍 등급보다 먼저다. 런타임의 이벤트 수명 계산도 이 함수를 쓴다. */
function impactStyleKey(styles, payload) {
  if (payload?.spike && styles.spike) return 'spike';
  return styles[payload?.timing?.grade] ? payload.timing.grade : 'normal';
}

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
    this.shakeCap = config.visual.shakeCap;
    this.teamColors = [config.visual.colors.home, config.visual.colors.away];
    this.seed = config.network.seed;
    this.reducedMotion = reducedMotion;
    this.ringGeometry = new THREE.TorusGeometry(.13, .009, 4, 20);
    this.dotGeometry = new THREE.SphereGeometry(.024, 5, 4);
    this.streakGeometry = new THREE.BoxGeometry(.026, .026, 1);
    this.flashGeometry = this.createStarGeometry(8);
    this.axisZ = new THREE.Vector3(0, 0, 1);
    this.deformation = { axis: new THREE.Vector3(), amount: 0 };
    this.camera = null;
    this.maxDots = Math.max(...Object.values(this.styles).map(style => style.dots));
    this.maxStreaks = Math.max(...Object.values(this.styles).map(style => style.streaks || 0));
    this.elementConfig = config.visual.impactElements;
    this.elements = []; // 팀 번호 → 속성 id. 뷰가 학교를 정할 때 setElements로 채운다.
    this.elementTrails = Object.fromEntries(Object.entries(this.elementConfig.byElement)
      .map(([id, element]) => [id, { ...this.styles.spike.trail, color: element.trail }]));
    this.shapeGeometries = this.createShapeGeometries();
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
    const flashMaterial = new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, depthWrite: false, depthTest: false, side: T.DoubleSide });
    const flash = new T.Mesh(this.flashGeometry, flashMaterial); flash.visible = false; group.add(flash);
    const streaks = [];
    for (let i = 0; i < this.maxStreaks; i++) {
      const mesh = new T.Mesh(this.streakGeometry, dotMaterial);
      group.add(mesh);
      streaks.push({ mesh, dx: 0, dy: 0, dz: 1, direction: new T.Vector3(0, 0, 1), length: 1, reach: 1 });
    }
    const elementMaterials = Array.from({ length: 4 }, () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: T.DoubleSide }));
    const edgeMaterial = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, side: T.DoubleSide });
    const particles = [];
    for (let i = 0; i < this.elementConfig.maxParticles; i++) {
      // rim: 같은 모양을 조금 크게 뒤에 깔아 어두운 테두리로 보이게 한다(밝은 배경에서 윤곽이 보인다).
      const rim = new T.Mesh(this.shapeGeometries.dot, edgeMaterial); rim.visible = false; rim.renderOrder = 1; group.add(rim);
      const mesh = new T.Mesh(this.shapeGeometries.dot, elementMaterials[0]); mesh.visible = false; mesh.renderOrder = 2; group.add(mesh);
      particles.push({ mesh, rim, shape: 'dot', vx: 0, vy: 0, vz: 0, g: 0, size: 0, start: 0, life: 1, spin: 0, roll: 0, grow: 1, flicker: false, swirl: 0, radius: 0, direction: new T.Vector3(0, 0, 1), length: 1 });
    }
    const node = { group, ring, outer, dots, dotMaterial, ringMaterial, flash, flashMaterial, streaks, particles, elementMaterials, edgeMaterial, particleCount: 0, trail: null, elementLife: 0, flashScale: 1,
      style: null, hold: 0, outerRing: false, shake: null, flashRoll: 0, fov: 0, squash: 0, squashAxis: new T.Vector3(), age: 0 };
    this.nodes.push(node);
    return node;
  }

  resetNode(node) {
    node.group.visible = false;
    node.style = null; node.shake = null; node.age = 0; node.particleCount = 0; node.trail = null;
  }

  /** 팀 번호별 학교 속성 id를 정한다(스파이크 연출을 고르는 유일한 입력). */
  setElements(ids) { this.elements = [...ids]; }

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
    const style = this.styles[impactStyleKey(this.styles, payload)];
    const reduced = this.reducedMotion();
    node.style = style;
    node.fov = reduced ? 0 : style.fovPunch || 0;
    node.squash = reduced ? 0 : style.squash || 0;
    const fv0 = payload.footVelocity, fl0 = fv0 ? Math.hypot(fv0.x, fv0.y, fv0.z) : 0;
    node.squashAxis.set(fl0 > .5 ? fv0.x / fl0 : 0, fl0 > .5 ? fv0.y / fl0 : 0, fl0 > .5 ? fv0.z / fl0 : 0);
    node.hold = reduced ? 0 : style.hold;
    node.outerRing = !!style.outerRing && !reduced;
    node.shake = style.shake && !reduced ? style.shake : null;
    node.group.position.set(payload.position.x, payload.position.y, payload.position.z);
    // tick과 sequence가 같으면 두 피어와 재확정에서 같은 방향이 나온다.
    const rng = new SeededPRNG(statelessRandom(this.seed, (payload.tick * 16 + payload.sequence) >>> 0));
    const unit = () => rng.nextUint32() / 4294967296;
    node.ring.rotation.set(unit() * Math.PI, unit() * Math.PI, 0);
    node.outer.rotation.copy(node.ring.rotation);
    const teamColor = this.teamColors[payload.team === 1 ? 1 : 0];
    node.dotMaterial.color.setHex(teamColor);
    node.ringMaterial.color.setHex(style.ringColor ?? teamColor);
    const speed = Math.min(1.3, .40 + (payload.speed || 0) * .035);
    for (const [index, dot] of node.dots.entries()) {
      const angle = unit() * Math.PI * 2;
      dot.vx = Math.cos(angle) * speed; dot.vy = unit() * speed + .12; dot.vz = Math.sin(angle) * speed;
      dot.mesh.visible = index < style.dots;
    }
    // 속도선: 발의 이동 방향 축 주위로 부채꼴. 발 속도가 없으면 위쪽 축.
    const fv = payload.footVelocity, fl = fv ? Math.hypot(fv.x, fv.y, fv.z) : 0;
    const ax = fl > .5 ? fv.x / fl : 0, ay = fl > .5 ? fv.y / fl : 1, az = fl > .5 ? fv.z / fl : 0;
    const count = reduced ? 0 : style.streaks || 0;
    for (const [index, streak] of node.streaks.entries()) {
      streak.mesh.visible = index < count;
      const dx = ax * .55 + (unit() - .5) * 1.5, dy = ay * .55 + (unit() - .5) * 1.5, dz = az * .55 + (unit() - .5) * 1.5;
      const size = Math.hypot(dx, dy, dz) || 1;
      streak.dx = dx / size; streak.dy = dy / size; streak.dz = dz / size; streak.direction.set(streak.dx, streak.dy, streak.dz);
      streak.length = .35 + unit() * .5 + Math.min(.5, (payload.speed || 0) * .02); streak.reach = .25 + unit() * .35;
    }
    node.flashRoll = unit() * Math.PI;
    node.flash.visible = !!style.flash;
    this.configureElement(node, payload, unit, reduced);
  }

  /** 스파이크이고 팀 학교에 속성이 있으면 속성 입자를 시드 난수로 배치한다. */
  configureElement(node, payload, unit, reduced) {
    const element = payload.spike ? this.elementConfig.byElement[this.elements[payload.team === 1 ? 1 : 0]] : null;
    node.particleCount = 0; node.trail = null; node.flashScale = 1;
    for (const particle of node.particles) particle.mesh.visible = particle.rim.visible = false;
    if (!element) return;
    // 속성 연출은 팀 색 점·속도선을 대신한다(링·섬광·진동·눌림은 그대로).
    for (const dot of node.dots) dot.mesh.visible = false;
    for (const streak of node.streaks) streak.mesh.visible = false;
    node.flashScale = this.elementConfig.flash;
    node.trail = this.elementTrails[this.elements[payload.team === 1 ? 1 : 0]];
    node.ringMaterial.color.setHex(element.ring); node.edgeMaterial.color.setHex(element.edge);
    element.colors.forEach((color, index) => node.elementMaterials[index].color.setHex(color));
    const fv = payload.footVelocity, fl = fv ? Math.hypot(fv.x, fv.y, fv.z) : 0;
    let index = 0;
    for (const part of element.parts) {
      const count = reduced ? Math.floor(part.n * .4) : part.n;
      for (let k = 0; k < count && index < node.particles.length; k++, index++) {
        const particle = node.particles[index], angle = unit() * Math.PI * 2, lift = unit();
        const speed = part.speed * (.6 + unit() * .8), up = part.dir === 'flat' ? 0 : part.up * (.4 + lift * .8);
        particle.shape = part.shape; particle.mesh.geometry = particle.rim.geometry = this.shapeGeometries[part.shape];
        particle.mesh.material = node.elementMaterials[part.c]; particle.mesh.visible = true;
        particle.vx = Math.cos(angle) * speed; particle.vz = Math.sin(angle) * speed; particle.vy = up;
        if (part.dir === 'up') { particle.vx *= .45; particle.vz *= .45; }
        particle.g = part.g; particle.size = part.size * (.7 + unit() * .6);
        particle.start = (part.delay || 0) * this.elementConfig.life; particle.life = part.life * this.elementConfig.life * (.8 + unit() * .2);
        particle.spin = part.spin * (unit() < .5 ? -1 : 1); particle.roll = unit() * Math.PI * 2;
        particle.grow = part.grow || 1; particle.flicker = !!part.flicker && !reduced;
        particle.swirl = part.dir === 'swirl' ? (2.2 + unit() * 2) * (unit() < .5 ? -1 : 1) : 0; particle.radius = part.dir === 'swirl' ? .12 + unit() * .12 : 0;
        // 방향이 있는 모양(streak·bolt)은 접촉점에서 바깥으로 향한다. 발 속도가 있으면 그 축 쪽으로 기울인다.
        const dx = particle.vx + (fl > .5 ? fv.x / fl : 0) * .6, dy = particle.vy + (fl > .5 ? fv.y / fl : 0) * .6, dz = particle.vz + (fl > .5 ? fv.z / fl : 0) * .6;
        const size = Math.hypot(dx, dy, dz) || 1; particle.direction.set(dx / size, dy / size, dz / size);
        particle.length = part.size * (.7 + unit() * .6);
      }
    }
    node.particleCount = index;
  }

  /** 경과 시간으로 모양을 정한다. 정지 구간(hold)에는 첫 모습을 유지한다. */
  apply(node, ageMs) {
    const style = node.style;
    if (!style) return;
    const t = Math.max(0, ageMs - node.hold * 1000) / 1000;
    const progress = Math.min(1, t / style.life);
    const alive = progress < 1 || (node.particleCount > 0 && t < this.elementConfig.life);
    node.group.visible = alive;
    node.dotMaterial.opacity = node.ringMaterial.opacity = (1 - progress) * .80;
    node.ring.scale.setScalar(.65 + progress * style.ringScale);
    node.outer.visible = progress < 1 && node.outerRing;
    node.outer.scale.setScalar(.65 + progress * style.ringScale * 1.6);
    for (const dot of node.dots) dot.mesh.position.set(dot.vx * t, dot.vy * t - t * t, dot.vz * t);
    // 섬광: 빠르게 커졌다가 사라진다. 정지 구간에도 첫 모습(크게)을 유지한다.
    const flashProgress = Math.min(1, t / (style.life * .32));
    node.flash.visible = !!style.flash && flashProgress < 1;
    node.flashMaterial.opacity = (1 - flashProgress) * .95;
    node.flash.scale.setScalar(style.flash * node.flashScale * (.55 + Math.sqrt(flashProgress) * .75));
    if (this.camera) node.flash.quaternion.copy(this.camera.quaternion);
    node.flash.rotateZ(node.flashRoll);
    // 속도선: 바깥으로 뻗으며 머리가 먼저 나가고 꼬리가 따라온다.
    const lineProgress = Math.min(1, t / (style.life * .7));
    this.applyParticles(node, t);
    for (const streak of node.streaks) {
      if (!streak.mesh.visible) continue;
      const head = streak.reach * Math.sqrt(lineProgress) * 2.2, tail = Math.max(0, head - streak.length * (1 - lineProgress));
      const length = Math.max(.001, head - tail);
      streak.mesh.position.set(streak.dx * (head + tail) / 2, streak.dy * (head + tail) / 2, streak.dz * (head + tail) / 2);
      streak.mesh.scale.set(1, 1, length);
      streak.mesh.quaternion.setFromUnitVectors(this.axisZ, streak.direction);
    }
  }

  /** 속성 입자의 위치·크기를 경과 시간 t(초)로 정한다. 시작 전과 끝난 뒤에는 보이지 않는다. */
  applyParticles(node, t) {
    if (!node.particleCount) return;
    const life = this.elementConfig.life;
    node.elementMaterials.forEach(material => { material.opacity = 1; }); node.edgeMaterial.opacity = .85;
    for (let i = 0; i < node.particleCount; i++) {
      const particle = node.particles[i], local = t - particle.start, progress = local / particle.life, mesh = particle.mesh;
      if (local < 0 || progress >= 1 || (particle.flicker && Math.floor(local * 32 + i) % 3 === 0)) { mesh.visible = particle.rim.visible = false; continue; }
      mesh.visible = particle.rim.visible = true;
      let x = particle.vx * local, z = particle.vz * local;
      if (particle.swirl) { // 접촉점 둘레를 돌며 퍼진다.
        const a = Math.atan2(particle.vz, particle.vx) + particle.swirl * local, r = particle.radius + Math.hypot(particle.vx, particle.vz) * local * .8;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
      }
      const y = particle.vy * local - .5 * particle.g * local * local;
      mesh.position.set(x, y, z);
      const scale = particle.size * (1 + (particle.grow - 1) * progress) * (1 - progress * progress);
      if (particle.shape === 'streak' || particle.shape === 'bolt') {
        // 길이 방향(z)으로 뻗는 모양: 머리가 먼저 나가고 꼬리가 줄어든다.
        mesh.scale.set(1, 1, Math.max(.001, particle.length * (1 - progress)));
        mesh.quaternion.setFromUnitVectors(this.axisZ, particle.direction);
      } else {
        mesh.scale.setScalar(Math.max(.001, scale));
        if (this.camera) mesh.quaternion.copy(this.camera.quaternion);
        mesh.rotateZ(particle.roll + particle.spin * local);
      }
      // 테두리: 본체와 같은 위치·방향에서 모양만 rim 배율로 키운다. 길이 방향 모양은 굵기만 키운다.
      const rim = particle.rim, grow = this.elementConfig.rim;
      rim.position.copy(mesh.position); rim.quaternion.copy(mesh.quaternion);
      if (particle.shape === 'streak' || particle.shape === 'bolt') rim.scale.set(grow * 2, grow * 2, mesh.scale.z * 1.06);
      else rim.scale.setScalar(mesh.scale.x * grow);
    }
  }

  /**
   * 카메라 진동 변위(CSS px)를 out에 쓴다. 여러 접촉이 겹쳐도 합산하지 않고 가장 센 하나만 쓰며 shakeCap을 넘지 않는다.
   * 단위가 px라 화면 크기와 무관하게 같은 체감이다. 화면 좌표 변환은 뷰가 맡는다.
   */
  shake(out) {
    out.x = 0; out.y = 0;
    let best = null, bestStrength = 0;
    for (const node of this.active) {
      const shake = node.shake, elapsed = node.age / 1000;
      if (!shake || elapsed >= shake.duration) continue;
      const strength = Math.min(this.shakeCap, shake.amplitude) * (1 - elapsed / shake.duration) ** 2;
      if (strength > bestStrength) { best = node; bestStrength = strength; }
    }
    if (best) {
      const elapsed = best.age / 1000;
      out.x = Math.sin(elapsed * 95) * bestStrength; out.y = Math.cos(elapsed * 113) * bestStrength;
    }
    return out;
  }

  /** 활성 효과의 화면 확대 비율(시야각을 줄이는 양)을 합산해 돌려준다. 맞은 직후 가장 크고 제곱으로 빠르게 줄어든다. */
  punch() {
    let amount = 0;
    for (const node of this.active) {
      if (!node.fov) continue;
      const elapsed = Math.max(0, node.age - node.hold * 1000) / 1000, duration = Math.max(.12, node.style.life * .6);
      if (elapsed < duration) amount = Math.max(amount, node.fov * (1 - elapsed / duration) ** 2);
    }
    return amount;
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
      const elapsed = node.age / 1000, amount = node.squash * Math.exp(-elapsed * 13) * Math.cos(elapsed * 34);
      if (Math.abs(amount) > Math.abs(out.amount)) { out.amount = amount; out.axis.copy(node.squashAxis); }
    }
    if (out.axis.lengthSq() === 0) out.amount = 0;
    return out;
  }

  /** 공 궤적을 강조 중이면 { color, duration }, 아니면 null. */
  trailBoost() {
    for (const node of this.active) {
      const trail = node.trail ?? node.style?.trail;
      if (trail && node.age < trail.duration * 1000) return trail;
    }
    return null;
  }

  /** 입자 모양 판(반지름 1, xy 평면). streak·bolt는 길이 1짜리 상자·지그재그 띠로 z축 방향으로 놓는다. */
  createShapeGeometries() {
    const T = this.THREE, shape = points => { const s = new T.Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return new T.ShapeGeometry(s); };
    const leaf = new T.Shape(); leaf.moveTo(1, 0); leaf.quadraticCurveTo(0, .7, -1, 0); leaf.quadraticCurveTo(0, -.7, 1, 0);
    const crescent = new T.Shape(); crescent.absarc(0, 0, 1, -1.9, 1.9, false); crescent.absarc(.45, 0, .85, 1.7, -1.7, true);
    // 지그재그 번개 띠: z축을 따라 -.5~.5, x로 흔들린다(고정 모양, 깜빡임은 flicker가 맡는다).
    const bolt = new T.BufferGeometry(), zig = [[0, -.5], [.18, -.3], [-.12, -.1], [.2, .1], [-.15, .3], [0, .5]], vertices = [], width = .025;
    for (let i = 0; i < zig.length - 1; i++) {
      const [x0, z0] = zig[i], [x1, z1] = zig[i + 1];
      vertices.push(x0 - width, 0, z0, x0 + width, 0, z0, x1 - width, 0, z1, x0 + width, 0, z0, x1 + width, 0, z1, x1 - width, 0, z1);
    }
    bolt.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    return { dot: new T.CircleGeometry(1, 8), hex: new T.CircleGeometry(1, 6), diamond: shape([[1, 0], [0, .6], [-1, 0], [0, -.6]]),
      shard: shape([[1, 0], [-.6, .35], [-.3, 0], [-.6, -.35]]), leaf: new T.ShapeGeometry(leaf), crescent: new T.ShapeGeometry(crescent),
      flake: this.createStarGeometry(6), star: this.createStarGeometry(4), bolt, streak: this.streakGeometry };
  }

  /** 뾰족한 별 모양 판(반지름 1). 섬광에 쓴다. */
  createStarGeometry(points) {
    const T = this.THREE, shape = new T.Shape();
    for (let i = 0; i < points * 2; i++) {
      const angle = i * Math.PI / points, radius = i % 2 ? .28 : 1;
      if (i === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    shape.closePath();
    return new T.ShapeGeometry(shape);
  }

  dispose() {
    for (const node of this.nodes) {
      this.scene.remove(node.group);
      node.dotMaterial.dispose(); node.ringMaterial.dispose(); node.flashMaterial.dispose(); node.edgeMaterial.dispose();
    }
    for (const node of this.nodes) for (const material of node.elementMaterials) material.dispose();
    for (const [id, geometry] of Object.entries(this.shapeGeometries)) if (id !== 'streak') geometry.dispose();
    this.ringGeometry.dispose(); this.dotGeometry.dispose(); this.streakGeometry.dispose(); this.flashGeometry.dispose();
    this.active.clear(); this.pool.clear(); this.nodes.length = 0;
  }
}

export { TakrawImpactEffects, impactStyleKey };
