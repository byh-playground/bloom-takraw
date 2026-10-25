import { TAKRAW_CONFIG, takrawAthleteEffects } from '../config/game.js';
import { TakrawMotionMatcher } from '../motion/matcher.js';

/**
 * Articulated, force-driven players. Rendering never writes back into this world.
 * The only pose teleports are the public rally reset methods below.
 */
class TakrawPhysics {
  constructor(RAPIER, config = {}, MotionMatcher = TakrawMotionMatcher) {
    this.R = RAPIER;
    this.config = config;
    this.motionMatcher = new MotionMatcher();
    this.settings = Object.assign({
      gravity: 9.81, ballRadius: 0.095, ballMass: 0.18,
      ballRestitution: 0.57, ballDamping: 0.035,
      movementSpeed: 3.15, movementAcceleration: 8.5, movementMaxAcceleration: 5, airControl: 0.9,
      jumpSpeed: 5.4, jumpHoldAcceleration: 7.5, jumpHoldTime: 0.16,
      groundKickForce: 380, groundKickSpeed: 7.5,
      footPositionGain: 200, footVelocityGain: 23,
      receptionMinSpeed: 7.5, receptionFullSpeed: 14, receptionMaxDuration: 0.66,
      solverIterations: 8, ccdSubsteps: 3,
      netHeight: 1.52, netBottom: 0.78, courtHalfWidth: 3.05,
    }, config.physics || {});
    this.settings.groundToss = Object.assign({
      contactHeight: 0.75, minPlanTime: 0.08, maxPlanTime: 0.45,
      receiveApex: 3.2, attackHeight: 3.3, attackApex: 4.2,
      forefoot: 0.08,
      strokeTime: 0.12, strokeFraction: 0.6, followThrough: 0.08,
      positionGain: 1200, velocityGain: 50, accelerationMass: 4.0,
      orientationStiffness: 1000, orientationDamping: 2.0,
      orientationInertia: 0.014, maxTorque: 32,
    }, config.physics?.groundToss || {});
    this.settings.receive = Object.assign({
      horizon: 1.4, preparation: 0.12, commitment: 0.45,
      cushionReach: 0.95, lungeReach: 0.95, slideReach: 0.95,
      slideContactFractions: [0.75, 0.5], moveThreshold: 0.25, directionThreshold: 0.5,
      clearance: 0.16, driveMass: 4,
      lunge: { height: 0.84, lean: 0.28, follow: 0.18 },
      slide: { height: 0.52, lean: 0.70, speed: 1.35, launchScale: 0.5, follow: 0.30 },
    }, config.physics?.receive || {});
    this.settings.airKick = Object.assign({
      force: 1600, speed: 8, leadTime: 0.1, preparation: 0.24, clearance: 0.16, reach: 0.795,
      forefoot: 0.04, downward: 0.4, effectiveFootMass: 0.78,
      positionGain: 2400, trackingMass: 4,
      preparationStrength: 0.72, kneePlaneStiffness: 40, kneePlaneDamping: 4,
      kneePlaneInertia: 0.04, kneePlaneMaxTorque: 12,
      orientationStiffness: 1000, orientationDamping: 2,
      orientationInertia: 0.014, maxTorque: 96,
    }, config.physics?.airKick || {});
    this.settings.airKick.rotation = Object.assign({
      speed: 7, torque: 210, damping: 38, planeStiffness: 90, planeDamping: 14,
    }, config.physics?.airKick?.rotation || {});
    this.settings.airKick.contact = Object.assign({
      horizon: 0.7, strokeTime: 0.14, maxSpeed: 14, netClearance: 0.18, downwardGain: 2,
      preparationTime: 0.08, driveMass: 8,
    }, config.physics?.airKick?.contact || {});
    this.settings.airReady = Object.assign({
      hipPitch: 1.0, kneeBend: 1.8, strength: 0.72, bodyStrength: 0.25,
    }, config.physics?.airReady || {});
    this.settings.airKick.motion = Object.assign({
      // The authored path supplies the swing shape; its contact endpoint is
      // retargeted inside the actual (possibly stretched) limb workspace.
      adaptation: 1, transition: 0.08, phaseMargin: 0.04,
      rootGain: 6, angularSpeed: 2, poseStrength: 0.72,
    }, config.physics?.airKick?.motion || {});
    this.settings.legStretch = Object.assign({
      // Scale units per second: full extension takes 250 ms, return 500 ms.
      maxScale: 1.25, extendRate: 1.0, retractRate: 0.5,
    }, config.physics?.legStretch || {});
    const stretch = this.settings.legStretch;
    stretch.maxScale = this._clamp(Number.isFinite(stretch.maxScale) ? stretch.maxScale : 1.25, 1, 1.25);
    for (const [key, fallback] of [['extendRate', 1.0], ['retractRate', 0.5]]) {
      if (!(Number.isFinite(stretch[key]) && stretch[key] > 0)) stretch[key] = fallback;
    }
    const airKick = this.settings.airKick;
    airKick.velocityGain = 2 * Math.sqrt(airKick.positionGain * airKick.trackingMass);
    const s = this.settings;
    this.world = new RAPIER.World({ x: 0, y: -s.gravity, z: 0 });
    this.world.integrationParameters.dt = 1 / 120;
    this.world.integrationParameters.numSolverIterations = s.solverIterations;
    this.world.integrationParameters.numInternalPgsIterations = 2;
    this.world.integrationParameters.maxCcdSubsteps = s.ccdSubsteps;
    this.queue = new RAPIER.EventQueue(true);
    this.serializer = new RAPIER.SerializationPipeline();
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
    this.setAthletes(Array(6).fill(null));
    this._buildBall();
    this.resetPlayers();
    this.resetBall({ x: -3.0, y: 2.2, z: -1.1 }, { x: 0, y: 0, z: 0 });
  }

  _v(x = 0, y = 0, z = 0) { return { x, y, z }; }
  _add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  _sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  _mul(a, k) { return { x: a.x * k, y: a.y * k, z: a.z * k }; }
  _dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  _length(a) { return Math.hypot(a.x, a.y, a.z); }
  _limit(a, max) { const n = this._length(a); return n > max ? this._mul(a, max / n) : a; }
  _unit(a, fallback = { x: 1, y: 0, z: 0 }) { const n = this._length(a); return n > 1e-7 ? this._mul(a, 1 / n) : { ...fallback }; }
  _clamp(a, lo, hi) { return Math.max(lo, Math.min(hi, a)); }
  _conj(q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; }
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
  _yaw(a) { return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }; }
  _point(body, local) { return this._add(body.translation(), this._rotate(body.rotation(), local)); }
  _bodyVelocity(p) {
    const velocity = this._v();
    for (const part of p.parts) {
      const value = part.body.linvel(), weight = part.mass / p.mass;
      velocity.x += value.x * weight; velocity.y += value.y * weight; velocity.z += value.z * weight;
    }
    return velocity;
  }
  _groups(member, filter = 0xffff) { return ((member << 16) | filter) >>> 0; }

  _athleteProfile(profile, id) {
    const definition = this.config.athletes || TAKRAW_CONFIG.athletes;
    const role = ['receiver', 'setter', 'attacker'][id % 3];
    const names = { receiver: '리시버', setter: '세터', attacker: '공격수' };
    const value = profile === null ? { id: 'standard-' + id, name: names[role], role, stats: {} } : profile;
    if (!value || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' ||
        !value.name.trim() || value.role !== role || !value.stats || typeof value.stats !== 'object' ||
        Array.isArray(value.stats) || Object.keys(value.stats).some(key => !Object.hasOwn(definition.bonus, key))) {
      throw new Error('선수 프로필과 역할을 확인하세요.');
    }
    const stats = {};
    for (const key of Object.keys(definition.bonus)) {
      const score = value.stats[key] ?? definition.base;
      if (!Number.isInteger(score) || score < definition.base || score > definition.max) throw new Error('능력치 범위가 올바르지 않습니다.');
      stats[key] = score;
    }
    return { id: value.id, name: value.name, role, stats };
  }

  setAthletes(profiles) {
    this.restoredSnapshotBytes = null;
    if (!Array.isArray(profiles) || profiles.length !== 6) throw new Error('여섯 명의 선수 프로필이 필요합니다.');
    const values = profiles.map((profile, id) => this._athleteProfile(profile, id));
    const definition = this.config.athletes || TAKRAW_CONFIG.athletes;
    for (const [id, athlete] of values.entries()) {
      const p = this.players[id], effect = takrawAthleteEffects(athlete.stats, definition), s = this.settings;
      p.athlete = athlete; p.effects = effect;
      p.settings = Object.values(effect).some(value => value !== 0) ? {
        ...s, movementSpeed: s.movementSpeed * (1 + effect.mobility),
        movementAcceleration: s.movementAcceleration * (1 + effect.mobility),
        jumpSpeed: s.jumpSpeed * (1 + effect.jump), airControl: s.airControl * (1 + effect.flexibility),
        groundKickForce: s.groundKickForce * (1 + effect.setting),
      } : s;
    }
  }

  /** Read-only interception estimate. A null input estimates an AI approach;
   * an explicit input uses only that player's actual movement direction. */
  planReceive(p, input = null) {
    const s = p.settings, receive = s.receive, ball = this.ball.translation(), velocity = this.ball.linvel();
    if (p.jump.active || input?.jump || input?.jumpPressed || (input !== null && /recover|fall/.test(p.state))) return null;
    const root = p.root.translation(), bodyVelocity = this._bodyVelocity(p);
    const offset = Math.min(this.config.ai?.toss?.incomingOffset ?? 0.8, receive.cushionReach);
    const candidate = (height, sliding) => {
      const discriminant = velocity.y * velocity.y + 2 * s.gravity * (ball.y - height);
      if (discriminant < 0) return null;
      const time = (velocity.y + Math.sqrt(discriminant)) / s.gravity;
      if (!(time > 0.015 && time <= receive.horizon)) return null;
      const point = { x: ball.x + velocity.x * time, y: height, z: ball.z + velocity.z * time };
      if (point.x * p.toward >= -0.15 || Math.abs(point.z) > this.config.court.halfWidth + 0.65 ||
          Math.abs(point.x) > this.config.court.halfLength + 0.65) return null;
      const stance = { x: this._clamp(point.x * p.toward - offset, -this.config.court.halfLength + 0.5, -0.6) * p.toward,
        z: this._clamp(point.z + p.toward * (this.config.ai?.toss?.attack?.lateral ?? 0.1),
          -this.config.court.halfWidth + 0.15, this.config.court.halfWidth - 0.15) };
      const toward = this._unit({ x: point.x - root.x, y: 0, z: point.z - root.z });
      const desired = input === null ? this._limit({ x: (stance.x - root.x) * 2, y: 0, z: (stance.z - root.z) * 2 }, 1) :
        this._limit({ x: Number(input.x) || 0, y: 0, z: Number(input.z) || 0 }, 1);
      const moving = this._length(desired) > receive.moveThreshold &&
        this._dot(this._unit(desired), toward) > receive.directionThreshold;
      const speed = s.movementSpeed * (sliding && moving ? receive.slide.speed : 1);
      const startVelocity = { ...bodyVelocity };
      if (sliding && moving && !p.receive) {
        const launchDirection = this._unit(desired), amount = this._length(desired);
        const launch = Math.min(s.movementSpeed * receive.slide.launchScale * amount,
          Math.max(0, speed * amount - this._dot(startVelocity, launchDirection)));
        startVelocity.x += launchDirection.x * launch; startVelocity.z += launchDirection.z * launch;
      }
      // Bounded pursuit estimate; it is not a position/velocity write. The
      // actual articulated controller and floor contact still decide arrival.
      const change = { x: desired.x * speed - startVelocity.x, y: 0, z: desired.z * speed - startVelocity.z };
      const acceleration = Math.min(s.movementMaxAcceleration, s.movementAcceleration * this._length(change));
      const accelerationTime = acceleration > 1e-6 ? Math.min(time, this._length(change) / acceleration) : 0;
      const travel = acceleration * accelerationTime * (time - accelerationTime * 0.5);
      const direction = this._unit(change);
      const predicted = { x: root.x + startVelocity.x * time + direction.x * travel,
        z: root.z + startVelocity.z * time + direction.z * travel };
      if (input === null) {
        const approach = { x: stance.x - root.x, y: 0, z: stance.z - root.z };
        const span = this._length(approach), along = this._dot({ x: predicted.x - root.x, y: 0, z: predicted.z - root.z }, this._unit(approach));
        if (along >= span) { predicted.x = stance.x; predicted.z = stance.z; }
      }
      const distance = Math.hypot(point.x - predicted.x, point.z - predicted.z);
      const mode = sliding ? 'slide' : distance > receive.cushionReach ? 'lunge' : 'cushion';
      const scale = Math.min(s.legStretch.maxScale, Math.max(p.legs.L.scale, p.legs.R.scale) + s.legStretch.extendRate * time);
      const extension = (scale - 1) * s.airKick.reach;
      const reachable = distance <= (sliding ? receive.slideReach : mode === 'lunge' ? receive.lungeReach : receive.cushionReach) +
        (mode === 'cushion' ? 0 : extension) && (!sliding || moving);
      return { mode, reachable, point, time, stance, moving, at: this.time, distance };
    };
    const normal = candidate(s.groundToss.contactHeight, false);
    if (normal?.reachable) return normal;
    const slides = receive.slideContactFractions.map(fraction => candidate(s.groundToss.contactHeight * fraction, true));
    return slides.find(plan => plan?.reachable) || normal || slides.find(Boolean) || null;
  }

  _updateReceive(p, input, move) {
    const settings = p.settings.receive;
    if (p.jump.active || input.jump || input.jumpPressed || (input.kickPressed && p.receive?.phase === 'recover')) p.receive = null;
    if (p.receive) {
      const action = p.receive;
      const cancel = !input.kick || (action.mode === 'slide' &&
        (this._length(move) <= settings.moveThreshold || this._dot(this._unit(move), action.direction) <= settings.directionThreshold));
      if (cancel || this.time >= action.until) action.phase = 'recover';
      else if (action.phase !== 'recover') action.phase = this.time >= action.contactAt || action.hitAt !== null ? 'contact' : 'prepare';
      if (!input.kick && this.time >= action.until) p.receive = null;
      return p.receive?.phase !== 'recover' && !!input.kick;
    }
    const plan = input.receive;
    if (!input.kick || !plan?.reachable || p.jump.active || input.jump || input.jumpPressed ||
        !(p.grounded || p.supportAge < 0.08) || !['cushion', 'lunge', 'slide'].includes(plan.mode)) return false;
    const remaining = plan.at + plan.time - this.time;
    if (!(remaining > 0.015 && remaining <= settings.commitment)) return false;
    const root = p.root.translation();
    const direction = this._unit({ x: plan.point.x - root.x, y: 0, z: plan.point.z - root.z });
    if (plan.mode === 'slide' && (!plan.allowSlide || this._length(move) <= settings.moveThreshold ||
        this._dot(this._unit(move), direction) <= settings.directionThreshold)) return false;
    const follow = plan.mode === 'slide' ? settings.slide.follow : settings.lunge.follow;
    p.receive = { mode: plan.mode, phase: 'prepare', point: { ...plan.point },
      startedAt: this.time, contactAt: this.time + remaining, until: this.time + remaining + follow,
      direction, committed: true, hitAt: null };
    if (plan.mode === 'slide') {
      // Push off once in the held movement direction, as a grounded jump uses
      // a finite launch impulse. Every body part receives its mass share;
      // subsequent travel is ordinary collision/drag and bounded locomotion.
      const launchDirection = this._unit(move), amount = this._length(move), s = p.settings;
      const launch = Math.min(s.movementSpeed * settings.slide.launchScale * amount,
        Math.max(0, s.movementSpeed * settings.slide.speed * amount - this._dot(this._bodyVelocity(p), launchDirection)));
      for (const part of p.parts) part.body.applyImpulse(this._mul(launchDirection, part.mass * launch), true);
      p.receive.launch = launch;
    }
    return true;
  }

  _buildCourt() {
    const R = this.R, s = this.settings;
    const floor = this.world.createCollider(R.ColliderDesc.cuboid(30, 0.12, 25)
      .setTranslation(0, -0.12, 0).setFriction(0.85).setRestitution(0)
      .setCollisionGroups(this._groups(1)).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS));
    this.floorHandle = floor.handle;
    this.colliderMeta.set(floor.handle, { kind: 'floor' });
    const net = this.world.createCollider(R.ColliderDesc.cuboid(0.025,
      (s.netHeight - s.netBottom) / 2, s.courtHalfWidth)
      .setTranslation(0, (s.netHeight + s.netBottom) / 2, 0)
      .setFriction(0.5).setRestitution(0.16).setCollisionGroups(this._groups(1))
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS));
    this.colliderMeta.set(net.handle, { kind: 'net' });
    for (const z of [-s.courtHalfWidth - 0.12, s.courtHalfWidth + 0.12]) {
      const post = this.world.createCollider(R.ColliderDesc.capsule(0.74, 0.045)
        .setTranslation(0, 0.79, z).setFriction(0.6)
        .setCollisionGroups(this._groups(1)).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS));
      this.colliderMeta.set(post.handle, { kind: 'net' });
    }
  }

  _buildPlayer(id) {
    const R = this.R;
    const team = Math.floor(id / 3), slot = id % 3, toward = team === 0 ? 1 : -1;
    const role = ['receiver', 'setter', 'attacker'][slot];
    const formation = (this.config.formation || TAKRAW_CONFIG.formation)[role];
    const home = { x: formation.x * toward, z: formation.z * toward };
    const p = {
      id, team, role, toward, home,
      yaw: toward * Math.PI / 2, parts: [], byName: {}, joints: [],
      state: 'standing', grounded: false, contacts: [], mass: 0,
      jump: {}, kick: {}, gait: 0, airTime: 0, supportAge: 1,
      recoveryTime: 0, lastTouch: -10, desiredYaw: toward * Math.PI / 2,
      freeTime: 0, landArmed: false,
      locomotionActive: false,
      legs: { L: { scale: 1, targetScale: 1 }, R: { scale: 1, targetScale: 1 } },
      reaction: { remaining: 0, duration: 0, severity: 0, incomingSpeed: 0 },
    };
    const member = 1 << (id + 2);
    const descriptors = [
      ['pelvis', 'box', [0, 1.0, 0], 10, { halfExtents: { x: 0.17, y: 0.10, z: 0.11 } }],
      ['torso', 'box', [0, 1.27, 0], 18, { halfExtents: { x: 0.23, y: 0.19, z: 0.12 } }],
      ['head', 'sphere', [0, 1.62, 0.005], 4.5, { radius: 0.115 }],
    ];
    for (const [suffix, side] of [['L', -1], ['R', 1]]) {
      descriptors.push(
        ['upperLeg' + suffix, 'capsule', [side * 0.12, 0.74, 0], 7, { radius: 0.065, halfHeight: 0.135 }],
        ['lowerLeg' + suffix, 'capsule', [side * 0.12, 0.34, 0], 4, { radius: 0.055, halfHeight: 0.145 }],
        ['foot' + suffix, 'box', [side * 0.12, 0.075, 0.085], 1.4, { halfExtents: { x: 0.075, y: 0.055, z: 0.145 } }],
        ['upperArm' + suffix, 'capsule', [side * 0.29, 1.25, 0], 2.5, { radius: 0.046, halfHeight: 0.104 }],
        ['forearm' + suffix, 'capsule', [side * 0.29, 0.97, 0], 1.5, { radius: 0.037, halfHeight: 0.093 }],
        ['hand' + suffix, 'sphere', [side * 0.29, 0.785, 0], 0.6, { radius: 0.055 }],
      );
    }
    const q = this._yaw(p.yaw);
    for (const [name, shape, localArray, mass, geometry] of descriptors) {
      const local = this._v(...localArray), pos = this._add(this._v(home.x, 0, home.z), this._rotate(q, local));
      const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z).setRotation(q)
        .setLinearDamping(0.08).setAngularDamping(0.12)
        .setCanSleep(false).setCcdEnabled(name.startsWith('foot') || name.startsWith('lowerLeg')));
      let desc;
      if (shape === 'sphere') desc = R.ColliderDesc.ball(geometry.radius);
      else if (shape === 'capsule') desc = R.ColliderDesc.capsule(geometry.halfHeight, geometry.radius);
      else desc = R.ColliderDesc.cuboid(geometry.halfExtents.x, geometry.halfExtents.y, geometry.halfExtents.z);
      const collider = this.world.createCollider(desc.setMass(mass)
        .setFriction(name.startsWith('foot') ? 0.9 : 0.42).setRestitution(0.04)
        .setCollisionGroups(this._groups(member, 0xffff ^ member))
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body);
      const part = { name, id: 'p' + id + ':' + name, body, colliderHandle: collider.handle,
        shape, mass, local, restGeometry: structuredClone(geometry), ...geometry };
      if (/^(upperLeg|lowerLeg)/.test(name)) part.restLength = 2 * (geometry.halfHeight + geometry.radius);
      p.parts.push(part); p.byName[name] = part; p.mass += mass;
      this.colliderMeta.set(collider.handle, { kind: 'player', playerId: id, team, part: name });
    }
    p.root = p.byName.pelvis.body;
    const joint = (name, parent, child, anchorArray, hinge, stiffness, damping, maxForce) => {
      const a = p.byName[parent], b = p.byName[child], anchor = this._v(...anchorArray);
      const localA = this._sub(anchor, a.local), localB = this._sub(anchor, b.local);
      const data = hinge ? R.JointData.revolute(localA, localB, { x: 1, y: 0, z: 0 }) : R.JointData.spherical(localA, localB);
      let j = this.world.createImpulseJoint(data, a.body, b.body, true);
      // Rapier 0.21.0 currently returns GenericImpulseJoint for a spherical joint.
      // The public spherical wrapper exposes the valid angular motor API.
      if (!hinge && typeof j.configureMotorPosition !== 'function') {
        j = new R.SphericalImpulseJoint(this.world.impulseJoints.raw, this.world.bodies, j.handle);
      }
      j.setContactsEnabled(false);
      if (hinge) { j.setLimits(0, 2.45); j.configureMotorModel(R.MotorModel.ForceBased); }
      else for (const axis of [R.JointAxis.AngX, R.JointAxis.AngY, R.JointAxis.AngZ]) j.configureMotorModel(axis, R.MotorModel.ForceBased);
      const item = { name, parent, child, joint: j, handle: j.handle, hinge, stiffness, damping, maxForce,
        restAnchor1: { ...localA }, restAnchor2: { ...localB }, target: [0, 0, 0] };
      p.joints.push(item);
      this._motor(item, item.target, 1);
    };
    joint('waist', 'pelvis', 'torso', [0, 1.10, 0], false, 130, 15, 95);
    joint('neck', 'torso', 'head', [0, 1.48, 0], false, 24, 3.6, 15);
    for (const [suffix, side] of [['L', -1], ['R', 1]]) {
      joint('hip' + suffix, 'pelvis', 'upperLeg' + suffix, [side * 0.12, 0.94, 0], false, 110, 13, 90);
      joint('knee' + suffix, 'upperLeg' + suffix, 'lowerLeg' + suffix, [side * 0.12, 0.54, 0], true, 130, 14, 85);
      joint('ankle' + suffix, 'lowerLeg' + suffix, 'foot' + suffix, [side * 0.12, 0.14, 0], false, 45, 5.5, 32);
      joint('shoulder' + suffix, 'torso', 'upperArm' + suffix, [side * 0.29, 1.40, 0], false, 25, 3.5, 24);
      joint('elbow' + suffix, 'upperArm' + suffix, 'forearm' + suffix, [side * 0.29, 1.10, 0], true, 22, 3.0, 20);
      joint('wrist' + suffix, 'forearm' + suffix, 'hand' + suffix, [side * 0.29, 0.84, 0], false, 12, 1.5, 9);
    }
    return p;
  }

  _buildBall() {
    const R = this.R, s = this.settings;
    this.ball = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true)
      .setLinearDamping(s.ballDamping).setAngularDamping(0.08).setCanSleep(false));
    const collider = this.world.createCollider(R.ColliderDesc.ball(s.ballRadius)
      .setMass(s.ballMass).setFriction(0.45).setRestitution(s.ballRestitution)
      .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
      .setCollisionGroups(this._groups(2))
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS), this.ball);
    this.ballColliderHandle = collider.handle;
    this.colliderMeta.set(collider.handle, { kind: 'ball' });
  }

  _motor(j, target, strength) {
    j.target = target;
    const R = this.R, k = j.stiffness * strength, d = j.damping * Math.max(0.16, Math.sqrt(strength));
    const cap = j.maxForce * Math.max(0.08, strength);
    if (j.hinge) {
      j.joint.configureMotorPosition(target[0], k, d);
      j.joint.setMotorMaxForce(cap);
    } else {
      [R.JointAxis.AngX, R.JointAxis.AngY, R.JointAxis.AngZ].forEach((axis, i) => {
        j.joint.configureMotorPosition(axis, target[i], k, d);
        j.joint.setMotorMaxForce(axis, cap);
      });
    }
  }

  resetPlayers() {
    this.restoredSnapshotBytes = null;
    this.ballContacts.clear(); this.netContacts.clear();
    this.lastBallTouch = null;
    for (const p of this.players) {
      for (const suffix of ['L', 'R']) {
        p.legs[suffix].targetScale = 1;
        this._setLegScale(p, suffix, 1, true);
      }
      const q = this._yaw(p.yaw);
      for (const part of p.parts) {
        part.body.setTranslation(this._add(this._v(p.home.x, 0, p.home.z), this._rotate(q, part.local)), true);
        part.body.setRotation(q, true); part.body.setLinvel(this._v(), true); part.body.setAngvel(this._v(), true);
        part.body.resetForces(true); part.body.resetTorques(true);
      }
      p.state = 'standing'; p.grounded = false; p.contacts = []; p.gait = 0;
      p.airTime = 0; p.supportAge = 0; p.recoveryTime = 0; p.lastTouch = -10;
      p.freeTime = 0; p.landArmed = false;
      p.locomotionActive = false;
      p.receive = null;
      p.reaction = { remaining: 0, duration: 0, severity: 0, incomingSpeed: 0 };
      p.desiredYaw = p.yaw;
      p.jump = { active: false, held: false, time: 0, cooldown: 0, airKickStarted: false };
      p.kick = { held: false, mode: 'none', side: 'R', receivePlan: null, airPlan: null };
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
    this.ball.resetForces(true); this.ball.resetTorques(true);
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
    const feet = contacts.some(name => name.startsWith('foot'));
    return { any: contacts.length > 0, feet };
  }

  _orientRoot(p, dt, strength, yawOnly = false, lean = null) {
    const body = p.root, q = body.rotation(), w = body.angvel();
    let desired = this._yaw(p.desiredYaw);
    if (lean) {
      const sine = Math.sin(lean.angle / 2);
      desired = this._qmul({ x: lean.direction.z * sine, y: 0,
        z: -lean.direction.x * sine, w: Math.cos(lean.angle / 2) }, desired);
    }
    let error = this._qmul(desired, this._conj(q));
    if (error.w < 0) error = { x: -error.x, y: -error.y, z: -error.z, w: -error.w };
    const sine = Math.hypot(error.x, error.y, error.z);
    const angle = 2 * Math.atan2(sine, this._clamp(error.w, -1, 1));
    const factor = sine > 1e-7 ? angle / sine : 2;
    const e = this._mul(error, factor);
    const torque = this._limit({
      x: yawOnly ? -w.x * 1.0 : 690 * e.x - 82 * w.x,
      y: 65 * e.y - 14 * w.y,
      z: yawOnly ? -w.z * 1.0 : 690 * e.z - 82 * w.z,
    }, yawOnly ? 55 : 380);
    body.applyTorqueImpulse(this._mul(torque, dt * strength), true);
  }

  _footDrive(p, part, target, desiredVelocity, maxForce, dt, positionGain, velocityGain, applicationPoint = null, feedForward = null, contactDrive = null) {
    const point = applicationPoint || part.body.translation(), velocity = part.body.velocityAtPoint(point);
    const feedback = this._add(this._mul(this._sub(target, point), positionGain),
      this._mul(this._sub(desiredVelocity, velocity), velocityGain));
    let requested = feedForward ? this._add(feedback, feedForward) : feedback;
    if (contactDrive) {
      const { normal, gap, closing, targetClosing, weight } = contactDrive;
      // The real instep may reach a falling ball before the planned clock.
      // Build the intended closing speed over the actual remaining gap.
      // Only the foot force changes; the ball stays entirely solver-owned.
      const acceleration = (targetClosing * targetClosing - closing * Math.abs(closing)) /
        (2 * Math.max(gap, this.settings.ballRadius * 0.05));
      const normalForce = contactDrive.mass * acceleration;
      requested = this._add(requested, this._mul(normal,
        (normalForce - this._dot(requested, normal)) * weight));
    }
    const contactScale = contactDrive?.power && p.effects.power ? 1 + p.effects.power * contactDrive.weight : 1;
    const force = this._limit(requested, maxForce * contactScale);
    const impulse = this._mul(force, dt);
    part.body.applyImpulseAtPoint(impulse, point, true);
    // Equal/opposite impulses at the same world point cancel the total wrench.
    // Unlike an opposite force at pelvis COM, this also preserves angular momentum.
    p.root.applyImpulseAtPoint(this._mul(impulse, -1), point, true);
  }

  _instepDrive(p, normal, targetClosing, forefoot, settings, power = false) {
    const foot = p.byName['foot' + p.kick.side].body, ball = this.ball.translation();
    const sole = this._point(foot, this._v(0, 0.055, forefoot)), velocity = foot.velocityAtPoint(sole);
    const gap = this._dot(this._sub(ball, sole), normal) - this.settings.ballRadius;
    const local = this._rotate(this._conj(foot.rotation()), this._sub(ball, foot.translation()));
    const face = this._dot(this._rotate(foot.rotation(), this._v(0, 1, 0)), normal);
    const extent = p.byName['foot' + p.kick.side].halfExtents, radius = this.settings.ballRadius;
    const range = radius * 2 + settings.clearance;
    const onInstep = local.y > 0 && Math.abs(local.x) < extent.x + radius * 0.5 &&
      local.z > -radius * 0.25 && local.z < extent.z + radius * 0.5;
    if (!onInstep || face <= 0.85 || gap < -radius * 0.25 || gap >= range) return null;
    return { normal, gap, closing: this._dot(this._sub(velocity, this.ball.linvel()), normal), targetClosing,
      weight: this._clamp((range - gap) / radius, 0, 1) * this._clamp((face - 0.85) / 0.1, 0, 1),
      mass: settings.driveMass, power };
  }

  _legReach(p, suffix) {
    const length = p.byName['upperLeg' + suffix].restLength + p.byName['lowerLeg' + suffix].restLength;
    return Math.min(this.settings.airKick.reach, length - 0.005) * p.legs[suffix].scale;
  }

  _legMinReach(p, suffix) {
    const scale = p.legs[suffix].scale;
    const upper = p.byName['upperLeg' + suffix].restLength * scale;
    const lower = p.byName['lowerLeg' + suffix].restLength * scale;
    const bend = p.joints.find(joint => joint.name === 'knee' + suffix).joint.limitsMax();
    return Math.sqrt(upper * upper + lower * lower + 2 * upper * lower * Math.cos(bend)) + 0.005;
  }

  _setLegScale(p, suffix, value, force = false) {
    const state = p.legs[suffix], scale = this._clamp(value, 1, this.settings.legStretch.maxScale);
    if (!force && Math.abs(state.scale - scale) < 1e-12) return;
    this.restoredSnapshotBytes = null;
    state.scale = scale;
    for (const name of ['upperLeg' + suffix, 'lowerLeg' + suffix]) {
      const part = p.byName[name], collider = this.world.getCollider(part.colliderHandle);
      // Keep the cap radius and mass fixed; only the long axis extends.
      part.radius = part.restGeometry.radius;
      part.halfHeight = part.restGeometry.halfHeight + part.restLength * (scale - 1) * 0.5;
      collider.setHalfHeight(part.halfHeight);
      collider.clearShapeCache();
      collider.setMass(part.mass);
      part.body.recomputeMassPropertiesFromColliders();
    }
    for (const name of ['hip' + suffix, 'knee' + suffix, 'ankle' + suffix]) {
      const item = p.joints.find(joint => joint.name === name);
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
    const air = p.kick.held && p.kick.mode === 'air' && !p.grounded &&
      p.kick.airPlan && p.kick.airPlan.phase !== 'follow';
    const receive = p.kick.held && p.kick.mode === 'ground' && p.receive &&
      p.receive.mode !== 'cushion' && p.receive.phase !== 'recover' && p.receive.hitAt === null;
    const active = air || receive;
    for (const suffix of ['L', 'R']) {
      const state = p.legs[suffix], restReach = this._legReach(p, suffix) / state.scale;
      const hip = receive ? this._point(p.root, { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 }) : null;
      const plan = receive ? p.kick.receivePlan : null;
      const receivePoint = plan ? this._add(plan.point, this._add(this._mul(plan.normal, 0.065), this._mul(plan.forward, -0.085))) :
        receive ? p.receive.point : null;
      const requested = active && suffix === p.kick.side ? air ? p.kick.airPlan.requestedReach :
        this._length(this._sub(receivePoint, hip)) : restReach;
      const wanted = this._clamp(Number.isFinite(requested) ? requested / restReach : 1,
        1, settings.maxScale);
      // Keep the reach prepared for this held swing until contact or release.
      // Retraction in the brief wind-up would remove the same few centimetres
      // that the following real stroke needs to keep its forward velocity.
      state.targetScale = active && suffix === p.kick.side ? Math.max(state.targetScale, wanted) : 1;
      const rate = state.targetScale > state.scale ? settings.extendRate : settings.retractRate;
      const change = this._clamp(state.targetScale - state.scale, -rate * elapsed, rate * elapsed);
      this._setLegScale(p, suffix, state.scale + change);
    }
  }

  _legTargets(p, suffix, footTarget, blend = 1, rootPosition = p.root.translation(), rootRotation = p.root.rotation()) {
    const inv = this._conj(rootRotation);
    const local = this._rotate(inv, this._sub(footTarget, rootPosition));
    local.x -= suffix === 'L' ? -0.12 : 0.12;
    local.y += 0.06;
    // The foot COM is ahead of its ankle by 8.5 cm.
    local.z -= 0.055;
    const scale = p.legs[suffix].scale;
    const upper = p.byName['upperLeg' + suffix].restLength * scale;
    const lower = p.byName['lowerLeg' + suffix].restLength * scale;
    const distance = this._clamp(this._length(local), this._legMinReach(p, suffix),
      this._legReach(p, suffix));
    const knee = Math.PI - Math.acos(this._clamp((upper * upper + lower * lower - distance * distance) /
      (2 * upper * lower), -1, 1));
    const alpha = Math.acos(this._clamp((upper * upper + distance * distance - lower * lower) /
      (2 * upper * distance), -1, 1));
    const pitch = -Math.atan2(local.z, -local.y) - alpha;
    const roll = Math.atan2(local.x, Math.hypot(local.y, local.z));
    return { hip: [pitch * blend, 0, roll * blend], knee: [knee * blend, 0, 0], ankle: [-(pitch + knee) * 0.7 * blend, 0, -roll * 0.5 * blend] };
  }

  _airCounterLegPose(p, suffix, freeLeg) {
    const mirror = p.kick.side === 'L' ? -1 : 1;
    const pose = {};
    for (const joint of ['hip', 'knee', 'ankle']) {
      const value = freeLeg[joint];
      pose[joint] = [value[0], value[1] * mirror, value[2] * mirror];
    }
    const plan = p.kick.airPlan, start = 0.30;
    if (!p.kick.held || p.kick.mode !== 'air' || p.grounded || suffix === p.kick.side ||
        !plan?.contact?.impact || !['align', 'lift', 'strike'].includes(plan.phase) ||
        !Number.isFinite(plan.remaining) || plan.remaining >= start) return pose;
    const interval = Math.max(1 / 120, start - this.settings.airKick.contact.strokeTime);
    const progress = this._clamp((start - plan.remaining) / interval, 0, 1);
    const weight = progress * progress * (3 - 2 * progress);
    const scale = p.legs[suffix].scale;
    const upper = p.byName['upperLeg' + suffix].restLength * scale;
    const lower = p.byName['lowerLeg' + suffix].restLength * scale;
    // Use the decoder's existing maximum knee bend, inside the real 2.45 rad
    // hinge limit. Its two-bone chord is 0.290 m at rest, rather than 0.800 m.
    const bend = 2.4;
    const foldedReach = Math.sqrt(upper * upper + lower * lower + 2 * upper * lower * Math.cos(bend));
    const hip = this._point(p.root, this._v(suffix === 'L' ? -0.12 : 0.12, -0.06, 0));
    const away = this._unit(this._sub(hip, plan.contact.impact),
      this._rotate(p.root.rotation(), this._v(0, -1, 0)));
    const ankle = this._add(hip, this._mul(away, foldedReach));
    // _legTargets consumes the standing foot COM offset. Cancel that offset
    // so the folded chord is the real hip-to-ankle target, as in the active leg.
    const target = this._add(ankle, this._rotate(p.root.rotation(), this._v(0, 0, 0.055)));
    const tuck = this._legTargets(p, suffix, target);
    const pitch = Math.atan2(Math.sin(tuck.hip[0]), Math.cos(tuck.hip[0]));
    tuck.hip = [this._clamp(pitch, -1.5, 1.7), 0, this._clamp(tuck.hip[2], -0.65, 0.65)];
    tuck.knee = [bend, 0, 0];
    tuck.ankle = [this._clamp(-(tuck.hip[0] + bend) * 0.7, -1.2, 1.2),
      0, this._clamp(-tuck.hip[2] * 0.5, -0.5, 0.5)];
    // Only joint targets change. Existing finite motors retract the real shin;
    // no contact filter, body velocity, root pose or active-leg drive is altered.
    for (const joint of ['hip', 'knee', 'ankle']) {
      pose[joint] = pose[joint].map((value, axis) => value + (tuck[joint][axis] - value) * weight);
    }
    return pose;
  }

  _drivePlayer(p, input, dt) {
    const s = p.settings, root = p.root, pos = root.translation(), vel = root.linvel();
    // Force/torque actuation below does not change poses until world.step.
    // Reuse this substep's root pose for the two IK queries and frame changes.
    const rootRotation = root.rotation();
    const contact = this._groundInfo(p), up = this._rotate(rootRotation, this._v(0, 1, 0));
    p.freeTime = contact.any ? 0 : p.freeTime + dt;
    if (p.freeTime > 0.12 && p.airTime > 0.12) p.landArmed = true;
    p.reaction.remaining = Math.max(0, p.reaction.remaining - dt);
    const reactionWeight = p.reaction.duration > 0 ? p.reaction.severity * Math.min(1, p.reaction.remaining / (p.reaction.duration * 0.45)) : 0;
    const muscleResponse = 1 - reactionWeight * 0.94;
    const balanceResponse = 1 - reactionWeight * 0.98;
    p.jump.cooldown = Math.max(0, p.jump.cooldown - dt);
    p.jump.time += dt;
    const supported = contact.feet && !(p.jump.active && p.jump.time < 0.17);
    p.supportAge = supported ? 0 : p.supportAge + dt;
    p.grounded = supported && up.y > 0.70 && pos.y > 0.68;
    if (contact.any && p.jump.time > 0.22 && vel.y < 1.3) p.jump.active = false;
    const move = this._limit({ x: Number(input.x) || 0, y: 0, z: Number(input.z) || 0 }, 1);
    const moving = this._length(move);
    const jumpPressed = !!input.jumpPressed;
    // Capture the held leg before an accepted jump changes the mode. A new
    // airborne click chooses its own leg; a ground hold carries its leg over.
    const continuingGroundKick = !!input.kick && p.kick.held &&
      (p.kick.mode === 'ground' || (!p.jump.active && p.supportAge < 0.065));
    if (jumpPressed && (p.grounded || (p.supportAge < 0.065 && !p.jump.active)) && p.jump.cooldown <= 0) {
      // The impulse accelerates the entire articulated body. A moving pelvis
      // is not its centre-of-mass velocity, especially with a raised leg.
      const delta = Math.max(0, s.jumpSpeed - this._bodyVelocity(p).y);
      for (const part of p.parts) part.body.applyImpulse({ x: 0, y: part.mass * delta, z: 0 }, true);
      p.jump.active = true; p.jump.time = 0; p.jump.cooldown = 0.23; p.jump.airKickStarted = false;
      p.grounded = false; p.supportAge = 1;
      p.kick.mode = 'none';
    }
    p.jump.held = !!input.jump;
    if (p.jump.active && input.jump && p.jump.time < s.jumpHoldTime && this._bodyVelocity(p).y > 0) {
      for (const part of p.parts) part.body.applyImpulse({ x: 0, y: part.mass * s.jumpHoldAcceleration * dt, z: 0 }, true);
    }
    if (p.grounded) p.airTime = 0; else p.airTime += dt;
    const receive = this._updateReceive(p, input, move) ? p.receive : null;
    const receiving = receive && receive.mode !== 'cushion';
    const motion = receive && receive.mode !== 'cushion' ? s.receive[receive.mode] : null;
    const receiveBlend = motion ? this._clamp((this.time - receive.startedAt + dt) / s.receive.preparation, 0, 1) : 0;
    const fallen = !receiving && contact.any && !p.grounded && !p.jump.active && (up.y < 0.70 || pos.y < 0.78);
    p.recoveryTime = fallen ? p.recoveryTime + dt : 0;
    const airborne = !receiving && !p.grounded && !fallen && (p.jump.active || p.airTime > 0.1);
    const kicking = !!input.kick && !(p.receive && p.receive.mode !== 'cushion' && p.receive.phase === 'recover');
    const mode = kicking ? (airborne ? 'air' : 'ground') : 'none';
    if (mode !== p.kick.mode) {
      p.kick.mode = mode; p.kick.receivePlan = null; p.kick.airPlan = null;
      let choose = this.ball.translation();
      if (mode === 'ground' && input.tossTarget) {
        const bv = this.ball.linvel(), height = s.groundToss.contactHeight;
        const disc = bv.y * bv.y + 2 * s.gravity * (choose.y - height);
        const t = this._clamp((bv.y + Math.sqrt(Math.max(0, disc))) / s.gravity, 0, s.groundToss.maxPlanTime);
        choose = { x: choose.x + bv.x * t, y: height, z: choose.z + bv.z * t };
      }
      const ballLocal = this._rotate(this._conj(rootRotation), this._sub(choose, pos));
      if (!(mode === 'air' && continuingGroundKick)) p.kick.side = ballLocal.x < -0.10 ? 'L' : 'R';
    }
    p.kick.held = kicking;
    this._updateLegStretch(p, dt);
    const airTarget = mode === 'air' && !fallen ? this._airFootTarget(p, dt, continuingGroundKick, input.motionPreference || 'auto') : null;
    if (airTarget) p.jump.airKickStarted = true;
    const preparing = !!airTarget && p.kick.airPlan.phase !== 'follow';
    const floppy = airborne && vel.y < -0.25 && (!kicking || p.kick.airPlan?.phase === 'follow');
    const ready = airborne && p.jump.active && vel.y > 0 && !kicking && !fallen && !p.jump.airKickStarted;
    p.state = fallen ? 'recovering' : floppy ? 'falling' : mode === 'air' ? 'overhead' : mode === 'ground' ? 'kicking' : airborne ? 'airborne' : moving > 0.1 ? 'moving' : 'standing';
    const recovery = fallen ? 1 + p.effects.recovery : 1;
    let muscle = (floppy ? 0.045 : airborne ? (ready ? s.airReady.strength : 0.32) : fallen ? 0.85 : 1) * muscleResponse * recovery;
    const targetMap = {};
    for (const j of p.joints) targetMap[j.name] = [0, 0, 0];
    targetMap.elbowL = [0.12, 0, 0]; targetMap.elbowR = [0.12, 0, 0];
    targetMap.shoulderL = [0.02, 0, -0.08]; targetMap.shoulderR = [0.02, 0, 0.08];

    if (!airborne) p.desiredYaw = p.yaw;
    // After the attacker stops walking, brake the whole articulated body's
    // momentum before takeoff. Receivers/setters retain their planted-pass
    // controller, as do ground kicks and recovery.
    if (p.role !== 'attacker' || airborne || fallen || mode === 'ground') p.locomotionActive = false;
    else if (moving > 0.08) p.locomotionActive = true;
    if (p.grounded || fallen || receiving) {
      this._orientRoot(p, dt, (fallen ? 1.2 : 1) * balanceResponse * recovery, false,
        motion ? { angle: motion.lean * receiveBlend, direction: receive.direction } : null);
      const liftHeight = motion ? 0.99 + (motion.height - 0.99) * receiveBlend : fallen && up.y < 0.45 ? 0.43 : 0.99;
      const lift = this._clamp(p.mass * s.gravity * 0.40 + (liftHeight - pos.y) * 1450 - vel.y * 290,
        motion ? -p.mass * s.gravity * 0.5 : 0, p.mass * s.gravity * (fallen ? 1.85 : 0.95));
      root.applyImpulse({ x: 0, y: lift * dt * balanceResponse * recovery, z: 0 }, true);
      const targetV = this._mul(move, s.movementSpeed * (fallen ? 0.2 : receive?.mode === 'slide' ? s.receive.slide.speed : 1));
      let movementVelocity = vel;
      if (p.locomotionActive && moving <= 0.08) {
        movementVelocity = this._v();
        for (const part of p.parts) movementVelocity = this._add(movementVelocity, this._mul(part.body.linvel(), part.mass / p.mass));
        if (Math.hypot(movementVelocity.x, movementVelocity.z) < 0.12) p.locomotionActive = false;
      }
      const force = this._limit({ x: (targetV.x - movementVelocity.x) * p.mass * s.movementAcceleration,
        y: 0, z: (targetV.z - movementVelocity.z) * p.mass * s.movementAcceleration }, p.mass * s.movementMaxAcceleration);
      root.applyImpulseAtPoint(this._mul(force, dt * muscleResponse), { x: pos.x, y: 0.09, z: pos.z }, true);
      p.gait += dt * (moving > 0.08 ? 8.5 : 0);
      const facing = this._yaw(p.desiredYaw);
      for (const [suffix, side] of [['L', -1], ['R', 1]]) {
        if (kicking && suffix === p.kick.side && !fallen) continue;
        const phase = p.gait + (side < 0 ? 0 : Math.PI);
        const localFoot = { x: side * 0.14, y: 0, z: 0.06 };
        const spread = this._rotate(facing, localFoot);
        const planted = motion ? this._mul(receive.direction, -0.18 * receiveBlend) : this._v();
        const target = { x: pos.x + spread.x + move.x * Math.sin(phase) * 0.18 + planted.x,
          y: 0.075 + (moving > 0.1 ? Math.max(0, Math.sin(phase)) * 0.15 : 0),
          z: pos.z + spread.z + move.z * Math.sin(phase) * 0.18 + planted.z };
        const pose = this._legTargets(p, suffix, target, 1, pos, rootRotation);
        if (motion) {
          const length = p.byName['upperLeg' + suffix].restLength + p.byName['lowerLeg' + suffix].restLength;
          const bend = Math.min(2.45, 2 * Math.acos(this._clamp((motion.height - 0.14) / length, 0, 1))) * receiveBlend;
          pose.hip[0] -= bend * 0.5;
          pose.knee[0] = Math.max(pose.knee[0], bend);
          pose.ankle[0] = -(pose.hip[0] + pose.knee[0]) * 0.7;
        }
        targetMap['hip' + suffix] = pose.hip; targetMap['knee' + suffix] = pose.knee; targetMap['ankle' + suffix] = pose.ankle;
        this._footDrive(p, p.byName['foot' + suffix], target,
          this._mul(move, s.movementSpeed * 0.55), 130 * muscleResponse, dt, 230 * muscleResponse, 17 * muscleResponse);
      }
    } else {
      if (!floppy) {
        if (mode !== 'air') this._orientRoot(p, dt, ready ? s.airReady.bodyStrength : 0.10, !ready);
      }
      if (mode === 'air') this._rotateOverhead(p, dt, muscleResponse);
      // Air steering is a bounded acceleration, never a root velocity assignment.
      const airForce = this._mul(move, p.mass * s.airControl);
      root.applyImpulse(this._mul(airForce, dt), true);
      targetMap.hipL = [0.12, 0, -0.06]; targetMap.hipR = [0.12, 0, 0.06];
      targetMap.kneeL = [0.25, 0, 0]; targetMap.kneeR = [0.25, 0, 0];
      targetMap.shoulderL = [-0.35, 0, -0.65]; targetMap.shoulderR = [-0.35, 0, 0.65];
    }
    if (motion) {
      // Keep the hands against the torso while the foot saves a low ball.
      // Wide balancing arms otherwise cross the newly rising pass; every
      // collider remains active and these are ordinary bounded joint motors.
      targetMap.shoulderL = [-1.6 * receiveBlend, 0, 0.55 * receiveBlend];
      targetMap.shoulderR = [-1.6 * receiveBlend, 0, -0.55 * receiveBlend];
      targetMap.elbowL = [2.05 * receiveBlend, 0, 0]; targetMap.elbowR = [2.05 * receiveBlend, 0, 0];
      targetMap.waist = [0.15 * receiveBlend, 0, 0];
    }
    if (ready) {
      // A jump can tuck both legs before the first click. These are fixed
      // body-local joint poses: no ball query, foot drive or attack direction.
      for (const [suffix, side] of [['L', -1], ['R', 1]]) {
        targetMap['hip' + suffix] = [s.airReady.hipPitch, 0, side * 0.06];
        targetMap['knee' + suffix] = [s.airReady.kneeBend, 0, 0];
        targetMap['ankle' + suffix] = [-(s.airReady.hipPitch + s.airReady.kneeBend) * 0.7, 0, 0];
      }
    }
    if (preparing || ready) {
      // Keep the torso on the pelvis' attack plane and tuck both hands against
      // the chest. Every arm collider remains active for real ball contacts.
      targetMap.waist = [0, 0, 0];
      targetMap.shoulderL = [-1.6, 0, 0.55]; targetMap.shoulderR = [-1.6, 0, -0.55];
      targetMap.elbowL = [2.05, 0, 0]; targetMap.elbowR = [2.05, 0, 0];
      if (preparing) this._orientKickPlane(p, dt, muscleResponse);
    }

    if (airTarget) {
      const pose = p.kick.airPlan.motion.pose, inactive = p.kick.side === 'L' ? 'R' : 'L';
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

    let orientedFoot = '';
    if (kicking && !fallen) {
      const suffix = p.kick.side, foot = p.byName['foot' + suffix];
      const hip = this._point(root, { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
      const ballPos = this.ball.translation(), ballVel = this.ball.linvel();
      const lead = 0.04;
      const predicted = this._add(ballPos, this._mul(ballVel, lead));
      predicted.y -= 0.5 * s.gravity * lead * lead;
      let target, targetVelocity, groundAcceleration = null, contactNormal = null, contactForward = null, groundContactDrive = null;
      let footControl = null;
      if (mode === 'air') {
        target = airTarget.target; targetVelocity = airTarget.velocity;
        contactNormal = airTarget.normal; contactForward = airTarget.forward;
        footControl = s.airKick;
      } else {
        const teammate = input.tossTarget;
        const tossing = teammate && Number.isFinite(teammate.x) && Number.isFinite(teammate.z);
        if (tossing) {
          const receive = this._receiveFootTarget(p, input, ballPos, ballVel, dt);
          target = receive.target; targetVelocity = receive.velocity; groundAcceleration = receive.acceleration;
          groundContactDrive = receive.contactDrive || null;
          contactNormal = receive.normal;
          contactForward = p.kick.receivePlan.forward; footControl = s.groundToss;
        } else {
          const horizontal = this._unit({ x: predicted.x - hip.x, y: 0, z: predicted.z - hip.z },
            { x: p.toward, y: 0, z: 0 });
          const kickDirection = this._unit({ x: horizontal.x * 0.48, y: 1, z: horizontal.z * 0.48 });
          target = this._add(predicted, this._mul(kickDirection, -0.045));
          targetVelocity = this._mul(kickDirection, s.groundKickSpeed);
        }
      }
      // The air controller already projects position and velocity together
      // into the current leg workspace. Ground reception keeps its own path.
      if (mode !== 'air') {
        if (p.kick.receivePlan && contactNormal) {
          const offset = this._add(this._mul(contactNormal, 0.065), this._mul(contactForward, -0.085));
          const ankle = this._add(target, offset), relative = this._sub(ankle, hip);
          const reach = this._legReach(p, suffix), minimum = this._legMinReach(p, suffix);
          const direction = this._unit(relative), distance = this._length(relative);
          target = this._sub(this._add(hip, this._mul(direction, this._clamp(distance, minimum, reach))), offset);
          const current = this._sub(this._point(foot.body, this._v(0, 0.065, -0.085)), hip);
          const hipVelocity = root.velocityAtPoint(hip);
          const next = this._add(current, this._mul(this._sub(targetVelocity, hipVelocity), dt)), nextDistance = this._length(next);
          if (nextDistance > reach || nextDistance < minimum) {
            targetVelocity = this._add(hipVelocity, this._mul(this._sub(
              this._mul(this._unit(next, direction), this._clamp(nextDistance, minimum, reach)), current), 1 / dt));
          }
        } else {
          const delta = this._limit(this._sub(target, hip), 0.84);
          target = this._add(hip, delta);
        }
      }
      // Controlled contacts drive the actual ankle. Convert the planned foot
      // centre to that anchor, cancelling _legTargets' standing COM offset.
      const ikTarget = mode === 'air' ? this._add(airTarget.ankle, this._rotate(rootRotation, this._v(0, 0, 0.055))) :
        contactNormal ? this._add(this._add(target, this._mul(contactNormal, 0.065)),
          this._add(this._mul(contactForward, -0.085),
            this._rotate(rootRotation, this._v(0, 0, 0.055)))) : target;
      const pose = this._legTargets(p, suffix, ikTarget, 1, pos, rootRotation);
      targetMap['hip' + suffix] = pose.hip; targetMap['knee' + suffix] = pose.knee;
      if (mode === 'air') {
        const motion = p.kick.airPlan.motion;
        const geometryWeight = p.kick.airPlan.phase === 'lift' ? 0.75 : 1;
        targetMap['knee' + suffix] = [this._clamp(
          motion.pose.activeKnee[0] * (1 - geometryWeight) + pose.knee[0] * geometryWeight, 0, 2.45), 0, 0];
      }
      targetMap['ankle' + suffix] = pose.ankle;
      if (contactNormal) orientedFoot = suffix;
      const ankleDriven = mode === 'air' || !!p.kick.receivePlan;
      const forcePoint = ankleDriven ? this._point(foot.body, this._v(0, 0.065, -0.085)) : null;
      const driveTarget = mode !== 'air' && ankleDriven ? this._sub(ikTarget, this._rotate(rootRotation, this._v(0, 0, 0.055))) : target;
      if (mode === 'ground' && ankleDriven) {
        const plan = p.kick.receivePlan;
        const terminal = this._clamp((this.time - plan.startedAt + dt - plan.duration + s.groundToss.strokeTime) /
          s.groundToss.strokeTime, 0, 1);
        const instep = this._point(foot.body, this._v(0, 0.055, s.groundToss.forefoot));
        const rotationVelocity = this._sub(foot.body.velocityAtPoint(instep), foot.body.velocityAtPoint(forcePoint));
        targetVelocity = this._sub(targetVelocity, this._mul(rotationVelocity, terminal));
      }
      // Both controls read the same solved state. A point impulse temporarily
      // changes free-body omega before the ankle joint is solved again.
      const angularVelocity = ankleDriven ? foot.body.angvel() : null;
      this._footDrive(p, foot, driveTarget, targetVelocity,
        (mode === 'air' ? s.airKick.force : s.groundKickForce) * muscleResponse,
        dt, (footControl ? footControl.positionGain : s.footPositionGain) * muscleResponse,
        (footControl === s.groundToss ?
          2 * Math.sqrt(s.groundToss.positionGain * s.groundToss.accelerationMass) :
          footControl ? footControl.velocityGain : s.footVelocityGain) * muscleResponse, forcePoint,
        mode === 'air' && airTarget.acceleration ? this._mul(this._add(airTarget.acceleration, this._v(0, s.gravity, 0)),
          s.airKick.trackingMass * muscleResponse) : groundAcceleration ?
          this._mul(this._add(groundAcceleration, this._v(0, s.gravity, 0)), s.groundToss.accelerationMass * muscleResponse) : null,
        mode === 'air' ? airTarget.contactDrive : groundContactDrive);
      if (contactNormal) this._orientFootNormal(p, suffix, contactNormal, contactForward, footControl, dt, muscleResponse, angularVelocity);
    }
    for (const j of p.joints) {
      let strength = muscle;
      if (preparing && (j.name === 'waist' || j.name.startsWith('shoulder') ||
        j.name.startsWith('elbow') || j.name.startsWith('wrist'))) strength = s.airKick.preparationStrength * muscleResponse;
      if (preparing && ['hip', 'knee', 'ankle'].some(name => j.name === name + (p.kick.side === 'L' ? 'R' : 'L'))) strength = s.airKick.motion.poseStrength * muscleResponse;
      if (kicking && !fallen && (j.name === 'hip' + p.kick.side || j.name === 'knee' + p.kick.side || j.name === 'ankle' + p.kick.side)) strength = (mode === 'air' ? 0.72 : 0.85) * muscleResponse;
      if (orientedFoot && (j.name === 'ankle' + orientedFoot ||
          ((mode === 'air' || p.kick.receivePlan) && j.name === 'hip' + orientedFoot))) {
        // Foot orientation owns the ankle. Every controlled contact lets its
        // force trajectory own hip direction, without a second
        // absolute-angle motor pulling the foot through the contact point.
        for (const axis of [this.R.JointAxis.AngX, this.R.JointAxis.AngY, this.R.JointAxis.AngZ]) j.joint.setMotorMaxForce(axis, 0);
        continue;
      }
      this._motor(j, targetMap[j.name], strength);
    }
  }

  _rotateOverhead(p, dt, response) {
    const plan = p.kick.airPlan, rotation = plan.rotation, s = this.settings.airKick.rotation;
    const motion = plan.motion, settings = this.settings.airKick.motion, root = p.root;
    // Accumulate the actual quaternion increment so a 540-degree reference
    // does not wrap into the shortest 180-degree turn. No render pose is read.
    let delta = this._qmul(root.rotation(), this._conj(rotation.previous));
    if (delta.w < 0) delta = { x: -delta.x, y: -delta.y, z: -delta.z, w: -delta.w };
    const sine = Math.hypot(delta.x, delta.y, delta.z);
    const increment = this._mul(delta, sine > 1e-7 ? 2 * Math.atan2(sine, delta.w) / sine : 2);
    rotation.angle += this._dot(increment, rotation.axis);
    rotation.previous = { ...root.rotation() };
    const axis = rotation.axis;
    rotation.target = motion.pose.body.angle;
    const speed = this._clamp(motion.angularVelocity + settings.rootGain *
      (rotation.target - rotation.angle), -s.speed * settings.angularSpeed, s.speed * settings.angularSpeed);
    const desired = this._qmul({ ...this._mul(axis, Math.sin(rotation.target / 2)),
      w: Math.cos(rotation.target / 2) }, rotation.start);
    const bodies = [{ body: root, weight: 0.45 }, { body: p.byName.torso.body, weight: 0.55 }];
    // The physical hit releases most of the pose support. The ragdoll keeps
    // its momentum on descent; an animation cannot pull it through a landing.
    const support = plan.phase === 'follow' ? 0.15 : Math.min(1, motion.age / settings.transition);
    for (const { body, weight } of bodies) {
      let error = this._qmul(desired, this._conj(body.rotation()));
      if (error.w < 0) error = { x: -error.x, y: -error.y, z: -error.z, w: -error.w };
      const length = Math.hypot(error.x, error.y, error.z);
      const e = this._mul(error, length > 1e-7 ? 2 * Math.atan2(length, error.w) / length : 2);
      const omega = body.angvel(), spin = this._dot(omega, axis);
      const plane = this._sub(e, this._mul(axis, this._dot(e, axis)));
      const offAxis = this._sub(omega, this._mul(axis, spin));
      const torque = this._limit(this._add(this._mul(axis, (speed - spin) * s.damping),
        this._sub(this._mul(plane, s.planeStiffness), this._mul(offAxis, s.planeDamping))), s.torque);
      body.applyTorqueImpulse(this._mul(torque, dt * weight * response * support), true);
    }
  }

  _orientKickPlane(p, dt, response) {
    const s = this.settings.airKick, suffix = p.kick.side;
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
      wanted = this._unit({ x: away.y * chord.z - away.z * chord.y,
        y: away.z * chord.x - away.x * chord.z, z: away.x * chord.y - away.y * chord.x }, current);
    }
    // Close to collinearity every pole has the same clearance. Keep the
    // current plane and damp its spin instead of amplifying a tiny offset.
    const cross = { x: current.y * wanted.z - current.z * wanted.y,
      y: current.z * wanted.x - current.x * wanted.z, z: current.x * wanted.y - current.y * wanted.x };
    const angle = Math.atan2(this._dot(chord, cross), this._dot(current, wanted));
    const speed = this._dot(this._sub(upper.angvel(), p.root.angvel()), chord);
    const stable = 1 + s.kneePlaneDamping * dt / s.kneePlaneInertia +
      s.kneePlaneStiffness * dt * dt / s.kneePlaneInertia;
    const torque = this._clamp((s.kneePlaneStiffness * angle - s.kneePlaneDamping * speed) / stable,
      -s.kneePlaneMaxTorque, s.kneePlaneMaxTorque) * response;
    // Only twist around the actual leg chord. The foot force still exclusively
    // controls hip direction, without a second position motor fighting it.
    const impulse = this._mul(chord, torque * dt);
    upper.applyTorqueImpulse(impulse, true);
    p.root.applyTorqueImpulse(this._mul(impulse, -1), true);
  }

  _orientFootNormal(p, suffix, normal, forward, s, dt, response, angularVelocity) {
    const body = p.byName['foot' + suffix].body;
    const parent = p.byName['lowerLeg' + suffix].body;
    const rotation = body.rotation();
    const up = this._rotate(rotation, this._v(0, 1, 0));
    const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const right = cross(normal, forward);
    const currentForward = this._rotate(rotation, this._v(0, 0, 1));
    const currentRight = this._rotate(rotation, this._v(1, 0, 0));
    let error = this._mul(this._add(this._add(cross(up, normal),
      cross(currentForward, forward)), cross(currentRight, right)), 0.5);
    if (s === this.settings.airKick) {
      // A quaternion error also has a direction at a 180-degree foot turn.
      // The cross-axis form above is retained verbatim for ground receptions.
      const m00 = right.x, m01 = normal.x, m02 = forward.x;
      const m10 = right.y, m11 = normal.y, m12 = forward.y;
      const m20 = right.z, m21 = normal.z, m22 = forward.z;
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
      error = this._mul(e, sine > 1e-7 ? 2 * Math.atan2(sine, this._clamp(e.w, -1, 1)) / sine : 2);
    }
    const omega = angularVelocity || body.angvel();
    const kp = s.orientationStiffness, kd = s.orientationDamping, inertia = s.orientationInertia;
    const stable = 1 + kd * dt / inertia + kp * dt * dt / inertia;
    // Translation acts at the ankle joint, so there is no COM-force moment
    // to compensate. Orientation retains equal/opposite finite torques.
    const torque = this._limit(this._mul(this._sub(this._mul(error, kp),
      this._mul(omega, kd)), response / stable), s.maxTorque * response);
    body.applyTorqueImpulse(this._mul(torque, dt), true);
    parent.applyTorqueImpulse(this._mul(torque, -dt), true);
  }

  _pendingJumpHold(p) {
    return p.jump.active && p.jump.held && this._bodyVelocity(p).y > 0 ?
      Math.max(0, this.settings.jumpHoldTime - p.jump.time - this.world.integrationParameters.dt) : 0;
  }

  _airContact(p, ballPos, ballVel, lead) {
    const s = this.settings, kick = s.airKick;
    const incoming = { x: ballVel.x, y: ballVel.y - s.gravity * lead, z: ballVel.z };
    const impact = this._add(ballPos, this._mul(ballVel, lead));
    impact.y -= 0.5 * s.gravity * lead * lead;
    const shot = kick.contact;
    // A falling set needs a downward change in velocity for an instep-leading
    // smash. The net clearance constraint below limits how steep it can be.
    const down = Math.max(kick.speed * kick.downward, -incoming.y + shot.downwardGain);
    const distance = Math.max(0, -impact.x * p.toward);
    const clearance = s.netHeight + s.ballRadius + shot.netClearance;
    // Solve the time available before this downward shot falls to net height.
    // Only the foot's target face/speed changes: the ball remains solver-owned.
    const drop = Math.max(0, impact.y - clearance);
    const crossingTime = (Math.sqrt(down * down + 2 * s.gravity * drop) - down) / s.gravity;
    const forwardSpeed = this._clamp(distance / Math.max(0.01, crossingTime), kick.speed, shot.maxSpeed);
    const flight = Math.max(0.02, distance / forwardSpeed);
    const verticalSpeed = Math.max(-down, (clearance - impact.y) / flight + 0.5 * s.gravity * flight);
    const wanted = { x: p.toward * forwardSpeed, y: Math.min(kick.speed, verticalSpeed), z: 0 };
    const delta = this._sub(wanted, incoming);
    const normal = this._unit(delta, this._v(p.toward, -kick.downward, 0));
    const vn = this._dot(incoming, normal);
    const transfer = kick.effectiveFootMass / (kick.effectiveFootMass + s.ballMass);
    const normalSpeed = vn + this._length(delta) / ((1 + s.ballRestitution) * transfer);
    const velocity = this._add(this._sub(incoming, this._mul(normal, vn)), this._mul(normal, normalSpeed));
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
    const fallback = this._unit(this._sub(preferred || this._v(0, 1, 0),
      this._mul(normal, this._dot(preferred || this._v(0, 1, 0), normal))), this._v(0, 0, 1));
    let forward = this._length(tangent) < 0.10 ? fallback : this._unit(tangent);
    // Crossing hip height must not suddenly reverse the toes by 180 degrees.
    // Keep the chosen instep hemisphere throughout this physical swing.
    if (previous && this._dot(forward, previous) < 0) forward = this._mul(forward, -1);
    return { impact, velocity, normal, forward, wanted };
  }

  _motionVector(value, axis, mirror = 1) {
    const side = { x: -axis.z, y: 0, z: axis.x };
    return this._add(this._mul(axis, value.forward),
      this._add(this._v(0, value.height ?? value.up ?? 0, 0),
        this._mul(side, value.lateral * mirror)));
  }

  _motionQuery(p, axis, preheld = false) {
    const root = p.root, suffix = p.kick.side, mirror = suffix === 'L' ? -1 : 1;
    const hip = this._point(root, { x: suffix === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
    const ankle = this._point(p.byName['foot' + suffix].body, this._v(0, 0.065, -0.085));
    const side = { x: -axis.z, y: 0, z: axis.x };
    const local = vector => ({ forward: this._dot(vector, axis), height: vector.y,
      lateral: this._dot(vector, side) * mirror });
    const relative = this._sub(this.ball.translation(), hip);
    const velocity = this._sub(this.ball.linvel(), root.velocityAtPoint(hip));
    const arrivalVelocity = this.ball.linvel().y - this._bodyVelocity(p).y;
    const up = this._rotate(root.rotation(), this._v(0, 1, 0));
    const reach = this.settings.airKick.reach;
    // Predict arrival at the upper leg workspace, rather than giving the
    // matcher the short 100 ms servo horizon. Both free bodies share gravity.
    let arrival = arrivalVelocity < -0.1 ? (reach * 0.75 - relative.y) / arrivalVelocity :
      this._length(this._sub(this.ball.translation(), ankle)) / this.settings.airKick.speed;
    // A pre-held kick starts on the jump's first step. Include the remaining
    // held-jump acceleration, just as a later airborne click already observes
    // its accumulated velocity. Otherwise the pre-held deadline is too late.
    const hold = this._pendingJumpHold(p), acceleration = this.settings.jumpHoldAcceleration;
    const height = relative.y - reach * 0.75;
    if (hold > 0 && height > 0 && acceleration > 0) {
      const duringHold = (arrivalVelocity + Math.sqrt(arrivalVelocity * arrivalVelocity + 2 * acceleration * height)) / acceleration;
      const afterSpeed = acceleration * hold - arrivalVelocity;
      if (duringHold <= hold) arrival = duringHold;
      else if (afterSpeed > 0.1) arrival = (height + 0.5 * acceleration * hold * hold) / afterSpeed;
    }
    return { ball: local(relative), foot: local(this._sub(ankle, hip)), velocity: local(velocity),
      body: { up: up.y, forward: this._dot(up, axis), spin: this._dot(root.angvel(), side) },
      timeToContact: this._clamp(arrival, 0.04, 0.8), preheld, legLength: reach };
  }

  _airFootTarget(p, dt, continuingGroundKick = false, preference = 'auto') {
    const s = this.settings, kick = s.airKick, root = p.root, settings = kick.motion;
    const ballPos = this.ball.translation(), ballVel = this.ball.linvel();
    if (!p.kick.airPlan) {
      const contact = this._airContact(p, ballPos, ballVel, kick.leadTime);
      const lateral = this._clamp((contact.impact.z - root.translation().z) /
        Math.max(0.3, Math.abs(contact.impact.x - root.translation().x)), -0.65, 0.65);
      const axis = this._unit(this._v(p.toward, 0, lateral));
      let best = null;
      for (const side of ['L', 'R']) {
        const sole = this._point(p.byName['foot' + side].body, this._v(0, 0.055, kick.forefoot));
        const score = this._length(this._sub(contact.impact, sole));
        if (!best || score < best.score) best = { side, score };
      }
      if (!continuingGroundKick) p.kick.side = best.side;
      const preheld = continuingGroundKick, mirror = p.kick.side === 'L' ? -1 : 1;
      const query = this._motionQuery(p, axis, preheld);
      const selection = this.motionMatcher.select(query, preference);
      let pose = this.motionMatcher.sample(selection.id, selection.phase);
      selection.phase = Math.min(selection.phase, Math.max(0, pose.contactPhase - settings.phaseMargin));
      pose = this.motionMatcher.sample(selection.id, selection.phase);
      const rotationAxis = this._unit(this._motionVector({ forward: pose.body.axis.forward * mirror,
        up: pose.body.axis.up * mirror, lateral: pose.body.axis.lateral }, axis));
      const initialAngle = pose.body.angle;
      const unrotate = { ...this._mul(rotationAxis, -Math.sin(initialAngle / 2)), w: Math.cos(initialAngle / 2) };
      const hip = this._point(root, { x: p.kick.side === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
      const ankle = this._point(p.byName['foot' + p.kick.side].body, this._v(0, 0.065, -0.085));
      p.kick.airPlan = {
        phase: preheld ? 'align' : 'lift', entry: preheld ? 'downward' : 'swing', axis,
        remaining: this._clamp(query.timeToContact, kick.contact.preparationTime, kick.contact.horizon),
        motion: { ...selection, pose, age: 0, preheld, preference,
          selection: { confidence: selection.confidence, score: selection.score },
          startPoint: { ...ankle },
          startVelocity: { ...p.byName['foot' + p.kick.side].body.velocityAtPoint(ankle) },
          duration: this._clamp(query.timeToContact, kick.contact.preparationTime, kick.contact.horizon),
          startPhase: selection.phase, point: { ...ankle }, angularVelocity: 0,
          reachError: 0, adaptation: 0, adaptationLimit: kick.reach * settings.adaptation },
        rotation: { axis: rotationAxis, start: this._qmul(unrotate, root.rotation()),
          angle: initialAngle, previous: { ...root.rotation() }, target: initialAngle },
      };
    }
    const plan = p.kick.airPlan, motion = plan.motion, foot = p.byName['foot' + p.kick.side].body;
    const mirror = p.kick.side === 'L' ? -1 : 1;
    const hip = this._point(root, { x: p.kick.side === 'L' ? -0.12 : 0.12, y: -0.06, z: 0 });
    const hipVelocity = root.velocityAtPoint(hip);
    const sole = this._point(foot, this._v(0, 0.055, kick.forefoot));
    const soleVelocity = foot.velocityAtPoint(sole);
    const currentAnkle = this._point(foot, this._v(0, 0.065, -0.085));
    plan.remaining = Math.max(0, plan.remaining - dt);
    // A held input has one finite preparation deadline. The foot starts moving
    // immediately; neither an unreachable clearance pose nor a clip phase can
    // keep moving that deadline away while the ball passes the player.
    const preparingBefore = plan.phase === 'lift' || plan.phase === 'align';
    const lead = Math.max(dt, plan.remaining + dt);
    // The terminal stroke retains its predicted impact and face. A foot that
    // is already swinging must pass through that point, not chase a moving
    // endpoint with an unrelated downward velocity.
    const contact = plan.strokeContact || (plan.phase === 'follow' && plan.contact) ||
      this._airContact(p, ballPos, ballVel, lead);
    const incomingAtImpact = plan.strokeIncoming || { x: ballVel.x, y: ballVel.y - s.gravity * lead, z: ballVel.z };
    if (!plan.strokeContact && plan.remaining <= kick.contact.strokeTime) {
      plan.strokeContact = structuredClone(contact);
      plan.strokeIncoming = { ...incomingAtImpact };
    }
    const lateral = this._clamp((contact.impact.z - hip.z) /
      Math.max(0.3, Math.abs(contact.impact.x - hip.x)), -0.65, 0.65);
    const heading = Math.atan2(p.toward, lateral), previousHeading = Math.atan2(plan.axis.x, plan.axis.z);
    const headingError = Math.atan2(Math.sin(heading - previousHeading), Math.cos(heading - previousHeading));
    const headingStep = this._clamp(headingError, -kick.speed * dt / (kick.reach * 2), kick.speed * dt / (kick.reach * 2));
    // A hit freezes the attack plane as well as the face. Otherwise chasing
    // the departing ball can turn a genuine downward contact into a scoop.
    if (plan.phase !== 'follow') plan.axis = this._rotate(this._yaw(headingStep), plan.axis);
    const axis = plan.axis;
    const surface = this._add(contact.impact, this._mul(contact.normal, -s.ballRadius));
    const normalGap = this._dot(this._sub(surface, sole), contact.normal);
    const upwardSpeed = Math.max(0, soleVelocity.y - contact.velocity.y);
    const brakingDistance = Math.min(kick.preparation,
      upwardSpeed * upwardSpeed * kick.trackingMass / (2 * kick.force));
    if (preparingBefore && (plan.remaining <= kick.contact.strokeTime ||
      (sole.y + brakingDistance >= surface.y + kick.clearance && normalGap > 0 &&
       this._length(this._sub(surface, sole)) < kick.preparation * 2))) plan.phase = 'strike';

    const previousPose = motion.pose;
    const query = this._motionQuery(p, axis, motion.preheld);
    query.timeToContact = Math.max(dt, plan.remaining);
    this.motionMatcher.advance(motion, query, dt);
    const cap = plan.phase === 'follow' ? 1 : previousPose.contactPhase +
      (plan.phase === 'strike' ? settings.phaseMargin : -settings.phaseMargin);
    motion.phase = Math.min(motion.phase, cap);
    motion.pose = this.motionMatcher.sample(motion.id, motion.phase);
    // Decoder approximation can wiggle by a fraction of a degree. Preserve
    // the selected sweep direction, including its unwrapped 540-degree end.
    motion.pose.body.angle = motion.phase === 1 ? motion.pose.body.totalAngle :
      Math.max(previousPose.body.angle, motion.pose.body.angle);
    motion.angularVelocity = (motion.pose.body.angle - previousPose.body.angle) / dt;
    // One held input keeps its clip and phase. Only finite residual warping
    // follows the ball; no per-frame reclassification can flap between kicks.
    const contactPose = this.motionMatcher.sample(motion.id, motion.pose.contactPhase);
    const referenceContact = this._mul(this._motionVector(contactPose.foot, axis, mirror), kick.reach);
    const ankleOffset = this._add(this._mul(contact.normal, 0.065 - 0.055),
      this._mul(contact.forward, -0.085 - kick.forefoot));
    const desiredContact = this._add(surface, ankleOffset);
    const error = this._sub(this._sub(desiredContact, hip), referenceContact);
    const correction = this._limit(error, motion.adaptationLimit);
    const strikeVelocity = contact.velocity;
    const duration = motion.duration, elapsed = motion.age;
    const closingSpeed = Math.max(0.1, this._dot(this._sub(strikeVelocity, incomingAtImpact), contact.normal));
    // Estimate the time at which the ball-relative preparation point enters
    // the actual hip workspace. Both free bodies share gravity here; pending
    // jump support is included in the predicted hip, as in the contact query.
    const bodyVelocity = this._bodyVelocity(p);
    const futureHip = this._add(hip, this._mul(bodyVelocity, lead));
    futureHip.y -= 0.5 * s.gravity * lead * lead;
    const heldTime = Math.min(lead, this._pendingJumpHold(p));
    futureHip.y += s.jumpHoldAcceleration * heldTime * (lead - 0.5 * heldTime);
    const futureHipVelocity = this._add(bodyVelocity, this._v(0, -s.gravity * lead + s.jumpHoldAcceleration * heldTime, 0));
    const relativeEnd = this._sub(desiredContact, futureHip);
    const relativeApproach = this._add(this._sub(incomingAtImpact, futureHipVelocity),
      this._mul(contact.normal, closingSpeed * 0.5));
    const qa = this._dot(relativeApproach, relativeApproach);
    const qb = -2 * this._dot(relativeEnd, relativeApproach);
    const radius = this._legReach(p, p.kick.side);
    const qc = this._dot(relativeEnd, relativeEnd) - radius * radius;
    const discriminant = qb * qb - 4 * qa * qc;
    const reachTime = qa > 1e-6 && discriminant >= 0 ?
      Math.max(0, (-qb + Math.sqrt(discriminant)) / (2 * qa)) : (qc <= 0 ? 0.06 : 0);
    const reachStart = qa > 1e-6 && discriminant >= 0 ?
      Math.max(0, (-qb - Math.sqrt(discriminant)) / (2 * qa)) : 0;
    const forceTime = kick.trackingMass * closingSpeed / kick.force;
    const terminalMin = Math.max(0.04, forceTime, reachStart);
    const terminalMax = Math.min(0.06, reachTime);
    // Reach supplies an upper bound, while finite acceleration supplies a
    // lower bound. An empty interval cannot promise the requested impact;
    // retain the bounded stroke and let the real workspace/force caps apply.
    const terminal = plan.terminalDuration || this._clamp(terminalMax, 0.04, 0.06);
    if (plan.strokeContact && !plan.terminalDuration) {
      plan.terminalDuration = terminal;
      plan.terminalFeasible = terminalMin <= terminalMax;
    }
    const prepDuration = Math.max(dt, duration - terminal);
    const prepBall = this._sub(contact.impact, this._mul(incomingAtImpact, terminal));
    prepBall.y -= 0.5 * s.gravity * terminal * terminal;
    const prepPoint = this._add(this._sub(prepBall,
      this._mul(contact.normal, s.ballRadius + 0.5 * closingSpeed * terminal)), ankleOffset);
    const prepVelocity = this._add(incomingAtImpact, this._v(0, s.gravity * terminal, 0));
    const u = this._clamp(elapsed / prepDuration, 0, 1), u2 = u * u, u3 = u2 * u;
    const startPoint = motion.startPoint, startVelocity = motion.startVelocity;
    let rawAnkle = this._add(this._add(this._mul(startPoint, 2 * u3 - 3 * u2 + 1),
      this._mul(startVelocity, prepDuration * (u3 - 2 * u2 + u))),
      this._add(this._mul(prepPoint, -2 * u3 + 3 * u2), this._mul(prepVelocity, prepDuration * (u3 - u2))));
    let desiredVelocity = this._add(this._add(this._mul(startPoint, (6 * u2 - 6 * u) / prepDuration),
      this._mul(startVelocity, 3 * u2 - 4 * u + 1)),
      this._add(this._mul(prepPoint, (-6 * u2 + 6 * u) / prepDuration), this._mul(prepVelocity, 3 * u2 - 2 * u)));
    let acceleration = this._add(this._add(this._mul(startPoint, (12 * u - 6) / (prepDuration * prepDuration)),
      this._mul(startVelocity, (6 * u - 4) / prepDuration)),
      this._add(this._mul(prepPoint, (-12 * u + 6) / (prepDuration * prepDuration)), this._mul(prepVelocity, (6 * u - 2) / prepDuration)));
    if (!motion.arc) {
      const startPose = this.motionMatcher.sample(motion.id, motion.startPhase);
      const middlePose = this.motionMatcher.sample(motion.id, (motion.startPhase + motion.pose.contactPhase) * 0.5);
      const chordMiddle = this._mul(this._add(this._motionVector(startPose.foot, axis, mirror),
        this._motionVector(contactPose.foot, axis, mirror)), kick.reach * 0.5);
      motion.arc = this._limit(this._sub(this._mul(this._motionVector(middlePose.foot, axis, mirror), kick.reach), chordMiddle), kick.clearance);
    }
    rawAnkle = this._add(rawAnkle, this._mul(motion.arc, 16 * u2 * (1 - u) * (1 - u)));
    desiredVelocity = this._add(desiredVelocity, this._mul(motion.arc, 16 * (2 * u - 6 * u2 + 4 * u3) / prepDuration));
    acceleration = this._add(acceleration, this._mul(motion.arc, 16 * (2 - 12 * u + 12 * u2) / (prepDuration * prepDuration)));
    if (elapsed >= prepDuration && elapsed < duration) {
      const remaining = duration - elapsed;
      const relativeGap = closingSpeed * remaining - 0.5 * closingSpeed * remaining * remaining / terminal;
      const movingBall = this._sub(contact.impact, this._mul(incomingAtImpact, remaining));
      movingBall.y -= 0.5 * s.gravity * remaining * remaining;
      rawAnkle = this._add(this._sub(movingBall, this._mul(contact.normal, s.ballRadius + relativeGap)), ankleOffset);
      desiredVelocity = this._add(this._add(incomingAtImpact, this._v(0, s.gravity * remaining, 0)),
        this._mul(contact.normal, closingSpeed * (1 - remaining / terminal)));
      acceleration = this._add(this._v(0, -s.gravity, 0), this._mul(contact.normal, closingSpeed / terminal));
    } else if (elapsed >= duration) {
      const follow = Math.min(elapsed - duration, kick.contact.strokeTime);
      const fraction = follow / kick.contact.strokeTime;
      rawAnkle = this._add(desiredContact, this._mul(strikeVelocity, follow * (1 - 0.5 * fraction)));
      desiredVelocity = this._mul(strikeVelocity, 1 - fraction);
      acceleration = fraction < 1 ? this._mul(strikeVelocity, -1 / kick.contact.strokeTime) : this._v();
    }
    // The fixed contact orientation defines the ankle offset. Its terminal
    // angular velocity is zero, so the contact and ankle share one tangent.
    // Actual foot spin remains feedback for the separate torque controller.
    const reach = this._legReach(p, p.kick.side);
    const minReach = this._legMinReach(p, p.kick.side);
    const contactDistance = this._length(this._sub(desiredContact, hip));
    const relativeAnkle = this._sub(rawAnkle, hip), distance = this._length(relativeAnkle);
    // The visible leg supports the preparation path as well as its contact.
    // Requesting only the endpoint would retract it during a wider wind-up.
    plan.requestedReach = Math.max(contactDistance, distance);
    const direction = this._unit(relativeAnkle, this._v(0, 1, 0));
    const ankle = this._add(hip, this._mul(direction, this._clamp(distance, minReach, reach)));
    const current = this._sub(currentAnkle, hip);
    const nextAnkle = this._add(current, this._mul(this._sub(desiredVelocity, hipVelocity), dt));
    const nextDistance = this._length(nextAnkle);
    if (nextDistance > reach || nextDistance < minReach) {
      desiredVelocity = this._add(hipVelocity, this._mul(this._sub(
        this._mul(this._unit(nextAnkle, direction), this._clamp(nextDistance, minReach, reach)), current), 1 / dt));
    }
    // Feed-forward is only an effective-mass approximation. Disable it when
    // the endpoint is still being retargeted or a reach constraint projects
    // this path; the bounded contact-point PD remains authoritative.
    if (!plan.strokeContact || distance > reach || nextDistance > reach ||
        distance < minReach || nextDistance < minReach) acceleration = null;
    motion.point = { ...rawAnkle };
    motion.reachError = Math.max(0, contactDistance - reach);
    motion.adaptation = this._length(correction);
    motion.correction = correction;
    if (plan.phase !== 'follow') { plan.contact = contact; plan.contactAt = this.time; }
    plan.point = ankle; plan.normal = contact.normal; plan.forward = contact.forward;
    const contactDrive = plan.phase !== 'follow' ? this._instepDrive(p, contact.normal, closingSpeed,
      kick.forefoot, { clearance: kick.clearance, driveMass: kick.contact.driveMass }, true) : null;
    return { target: ankle, velocity: desiredVelocity, acceleration, contactDrive, ankle,
      normal: contact.normal, forward: contact.forward };
  }

  _receiveFootTarget(p, input, ballPos, ballVel, dt) {
    const s = this.settings, toss = s.groundToss;
    // An early held input can prepare the real foot while the ball is still
    // outside the stroke horizon. Commit the stroke only once its actual
    // predicted arrival enters that horizon. Once committed, retain the
    // stroke instead of replanning around the outgoing ball.
    if (!p.kick.receivePlan || p.kick.receivePlan.tracking) {
      const height = p.receive?.mode === 'slide' && p.receive.phase !== 'recover' ? p.receive.point.y : toss.contactHeight;
      const disc = ballVel.y * ballVel.y + 2 * s.gravity * (ballPos.y - height);
      const arrival = (ballVel.y + Math.sqrt(Math.max(0, disc))) / s.gravity;
      const duration = this._clamp(arrival, toss.minPlanTime, toss.maxPlanTime);
      const tracking = arrival > toss.maxPlanTime;
      const prediction = tracking ? arrival : duration;
      const incoming = { x: ballVel.x, y: ballVel.y - s.gravity * prediction, z: ballVel.z };
      const impact = this._add(ballPos, this._mul(ballVel, prediction));
      impact.y -= 0.5 * s.gravity * prediction * prediction;
      const attacking = input.tossTarget.playerId % 3 === 2;
      const goalHeight = attacking ? toss.attackHeight : height;
      const upSpeed = Math.sqrt(2 * s.gravity * Math.max(0.4,
        (attacking ? toss.attackApex : toss.receiveApex) - impact.y));
      const flight = (upSpeed + Math.sqrt(Math.max(0,
        upSpeed * upSpeed + 2 * s.gravity * (impact.y - goalHeight)))) / s.gravity;
      const wanted = { x: (input.tossTarget.x - impact.x) / flight, y: upSpeed,
        z: (input.tossTarget.z - impact.z) / flight };
      // Precontact foot targets only; no ball impulse or velocity assignment.
      // The estimated collision normal and speed guide the articulated foot;
      // its finite reach, force, orientation and actual collision decide the pass.
      const delta = this._sub(wanted, incoming), normal = this._unit(delta, this._v(0, 1, 0));
      const vn = this._dot(incoming, normal);
      const contactFoot = p.byName['foot' + p.kick.side];
      const mass = contactFoot.body.mass(), extent = contactFoot.halfExtents;
      const pitchInertia = mass * (extent.y * extent.y + extent.z * extent.z) / 3;
      const contactMass = 1 / (1 / mass + toss.forefoot * toss.forefoot / pitchInertia);
      const transfer = contactMass / (contactMass + s.ballMass);
      const normalSpeed = vn + this._length(delta) / ((1 + s.ballRestitution) * transfer);
      const velocity = this._add(this._sub(incoming, this._mul(normal, vn)), this._mul(normal, normalSpeed));
      // A slide points the toes along the extended leg, leaving the ankle
      // behind the instep. A fixed net-facing foot twists the knee sideways
      // and exposes its narrow edge when the save is far to either side.
      const heading = p.receive?.mode === 'slide' ? this._sub(impact, p.root.translation()) : this._v(p.toward, 0, 0);
      const forward = this._unit(this._sub(heading, this._mul(normal, this._dot(heading, normal))));
      const point = this._sub(this._add(impact, this._mul(normal, -(s.ballRadius + 0.055))),
        this._mul(forward, toss.forefoot));
      const foot = p.byName['foot' + p.kick.side].body;
      const dynamicReceive = !!p.receive && p.receive.mode !== 'cushion';
      const ankle = this._point(foot, this._v(0, 0.065, -0.085));
      const ankleOffset = this._add(this._mul(normal, 0.065), this._mul(forward, -0.085));
      // Every pass drives the ankle. Curves use foot-centre coordinates;
      // subtract the same contact anchor offset at the starting boundary.
      const start = this._sub(ankle, ankleOffset);
      const startVelocity = { ...foot.velocityAtPoint(ankle) };
      p.kick.receivePlan = { duration, startedAt: this.time, normal, forward, point, velocity, tracking,
        attackSet: attacking, dynamicReceive, incoming, start, startVelocity };
    }
    const plan = p.kick.receivePlan;
    if (p.receive?.hitAt !== null && p.receive?.hitAt !== undefined &&
        this.time - p.receive.hitAt >= toss.followThrough) {
      // Finish the bounded physical follow-through, then retract below the
      // hip. A held button must not sweep through the departing ball again.
      const root = p.root.translation(), direction = p.receive.direction;
      const target = { x: root.x - direction.x * 0.15, y: 0.12, z: root.z - direction.z * 0.15 };
      const velocity = this._sub(this._bodyVelocity(p), this._mul(direction, toss.followThrough * s.groundKickSpeed / Math.max(dt, toss.strokeTime)));
      return { target, velocity, normal: plan.normal };
    }
    if (plan.dynamicReceive && p.receive?.mode !== 'slide') {
      const elapsed = this.time - plan.startedAt + dt, terminal = Math.min(toss.strokeTime, plan.duration * 0.5);
      const prepDuration = Math.max(dt, plan.duration - terminal), closing = this._dot(this._sub(plan.velocity, plan.incoming), plan.normal);
      const prep = this._sub(this._sub(plan.point, this._mul(plan.incoming, terminal)), this._mul(plan.normal, closing * terminal * 0.5));
      prep.y -= 0.5 * s.gravity * terminal * terminal;
      const incoming = this._add(plan.incoming, this._v(0, s.gravity * terminal, 0));
      const u = this._clamp(elapsed / prepDuration, 0, 1), u2 = u * u, u3 = u2 * u;
      let target = this._add(this._add(this._mul(plan.start, 2 * u3 - 3 * u2 + 1),
        this._mul(plan.startVelocity, prepDuration * (u3 - 2 * u2 + u))),
        this._add(this._mul(prep, -2 * u3 + 3 * u2), this._mul(incoming, prepDuration * (u3 - u2))));
      let velocity = this._add(this._add(this._mul(plan.start, (6 * u2 - 6 * u) / prepDuration),
        this._mul(plan.startVelocity, 3 * u2 - 4 * u + 1)),
        this._add(this._mul(prep, (-6 * u2 + 6 * u) / prepDuration), this._mul(incoming, 3 * u2 - 2 * u)));
      if (elapsed >= prepDuration && elapsed < plan.duration) {
        const remaining = plan.duration - elapsed;
        target = this._sub(this._sub(plan.point, this._mul(plan.incoming, remaining)),
          this._mul(plan.normal, closing * remaining - 0.5 * closing * remaining * remaining / terminal));
        target.y -= 0.5 * s.gravity * remaining * remaining;
        velocity = this._add(this._add(plan.incoming, this._v(0, s.gravity * remaining, 0)),
          this._mul(plan.normal, closing * (1 - remaining / terminal)));
      } else if (elapsed >= plan.duration) {
        const follow = Math.min(elapsed - plan.duration, toss.followThrough), fraction = follow / toss.followThrough;
        target = this._add(plan.point, this._mul(plan.velocity, follow * (1 - 0.5 * fraction)));
        velocity = this._mul(plan.velocity, 1 - fraction);
      }
      const contactDrive = p.receive?.hitAt === null && elapsed < plan.duration + toss.followThrough ?
        this._instepDrive(p, plan.normal, Math.max(0, this._dot(this._sub(plan.velocity, ballVel), plan.normal)),
          toss.forefoot, s.receive) : null;
      return { target, velocity, normal: plan.normal, contactDrive };
    }
    if (plan.attackSet || !plan.dynamicReceive) {
      // Cushion receptions and high sets share a continuous approach, with
      // endpoint velocity for the intended pass instead of a late hard swing.
      const elapsed = this.time - plan.startedAt + dt;
      const duration = plan.duration;
      const point = plan.point;
      const u = this._clamp(elapsed / duration, 0, 1), u2 = u * u, u3 = u2 * u;
      const start = plan.start, initialVelocity = plan.startVelocity, endVelocity = plan.velocity;
      let target = this._add(this._add(this._mul(start, 2 * u3 - 3 * u2 + 1),
        this._mul(initialVelocity, (u3 - 2 * u2 + u) * duration)),
        this._add(this._mul(point, -2 * u3 + 3 * u2), this._mul(endVelocity, (u3 - u2) * duration)));
      let velocity = this._add(this._add(this._mul(start, (6 * u2 - 6 * u) / duration),
        this._mul(initialVelocity, 3 * u2 - 4 * u + 1)),
        this._add(this._mul(point, (-6 * u2 + 6 * u) / duration), this._mul(endVelocity, 3 * u2 - 2 * u)));
      let acceleration = this._add(this._add(this._mul(start, (12 * u - 6) / (duration * duration)),
        this._mul(initialVelocity, (6 * u - 4) / duration)),
        this._add(this._mul(point, (-12 * u + 6) / (duration * duration)), this._mul(endVelocity, (6 * u - 2) / duration)));
      if (elapsed >= plan.duration) {
        const follow = Math.min(elapsed - plan.duration, toss.followThrough);
        target = this._add(plan.point, this._mul(plan.velocity, follow));
        velocity = elapsed - plan.duration < toss.followThrough ? plan.velocity : this._v();
        acceleration = this._v();
      }
      return { target, velocity, acceleration, normal: plan.normal };
    }
    // A plan created after recovery starts now, retaining the first-substep drive.
    const elapsed = this.time - plan.startedAt + dt;
    const stroke = Math.min(toss.strokeTime, plan.duration * toss.strokeFraction);
    const beforeStroke = plan.duration - stroke;
    const clock = this._clamp(elapsed - beforeStroke, 0, stroke);
    const prep = this._sub(plan.point, this._mul(plan.velocity, 0.5 * stroke));
    let target = this._add(prep, this._mul(plan.velocity, 0.5 * clock * clock / stroke));
    let velocity = this._mul(plan.velocity, clock / stroke);
    if (elapsed > beforeStroke && elapsed < plan.duration) {
      velocity = this._add(velocity, this._mul(plan.velocity,
        toss.accelerationMass / (stroke * toss.velocityGain)));
    }
    if (elapsed >= plan.duration) {
      target = this._add(plan.point, this._mul(plan.velocity,
        Math.min(elapsed - plan.duration, toss.followThrough)));
    }
    const contactDrive = plan.dynamicReceive && p.receive?.hitAt === null && elapsed < plan.duration + toss.followThrough ?
      this._instepDrive(p, plan.normal, Math.max(0, this._dot(this._sub(plan.velocity, ballVel), plan.normal)),
        toss.forefoot, s.receive) : null;
    return { target, velocity, normal: plan.normal, contactDrive };
  }

  _receiveImpact(p, partName, before) {
    const s = p.settings, sample = before.players[p.id].parts[partName];
    const relative = this._sub(before.ballVelocity, sample.velocity);
    const speed = Math.min(this._length(before.ballVelocity), this._length(relative));
    const incoming = before.lastBallTouch ? before.lastBallTouch.team !== p.team : before.ballVelocity.x * p.toward < -0.5;
    const closing = this._dot(relative, this._unit(this._sub(sample.position, before.ballPosition)));
    // Only a fast incoming reception loses actuator strength. Own-team sets and
    // airborne attacking kicks do not trigger this response. No impact is added.
    if (!incoming || p.kick.mode === 'air' || before.ballPosition.x * p.toward > 0.2 ||
        speed <= s.receptionMinSpeed || closing < 2) return 0;
    const severity = Math.pow(this._clamp((speed - s.receptionMinSpeed) /
      Math.max(0.1, s.receptionFullSpeed - s.receptionMinSpeed), 0, 1), 0.65) * (1 - p.effects.defense);
    const duration = 0.2 + (s.receptionMaxDuration - 0.2) * severity;
    p.reaction = {
      remaining: Math.max(p.reaction.remaining, duration),
      duration: Math.max(p.reaction.duration, duration),
      severity: Math.max(p.reaction.remaining > 0 ? p.reaction.severity : 0, severity),
      incomingSpeed: speed,
    };
    return severity;
  }

  step(dt, inputs = []) {
    this.restoredSnapshotBytes = null;
    const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1 / 60) : 1 / 120;
    this.world.integrationParameters.dt = h;
    for (const p of this.players) this._drivePlayer(p, inputs[p.id] || {}, h);
    const before = {
      ballPosition: { ...this.ball.translation() }, ballVelocity: { ...this.ball.linvel() },
      lastBallTouch: this.lastBallTouch,
      players: this.players.map(p => ({
        velocity: { ...p.root.linvel() },
        parts: Object.fromEntries(p.parts.map(part => [part.name, {
          position: { ...part.body.translation() }, velocity: { ...part.body.velocityAtPoint(this.ball.translation()) },
        }])),
      })),
    };
    this.world.step(this.queue);
    this.time += h;
    const events = [], contactStarts = [...this.ballContacts.values()].filter(
      contact => contact.kind === 'player' && !contact.confirmed);
    const confirmedTouches = new Set();
    // A start event may precede a CCD impulse. Pending contacts stay in the
    // active map until separation; transient start/stop pairs also survive in
    // this step's candidates so the force queue can still confirm their hit.
    const candidates = new Map(this.ballContacts), impulses = new Set();
    const episodeConfirmed = playerId => [...this.ballContacts.values()].some(
      contact => contact.kind === 'player' && contact.playerId === playerId && contact.confirmed);
    this.queue.drainCollisionEvents((a, b, started) => {
      const ma = this.colliderMeta.get(a), mb = this.colliderMeta.get(b);
      if (!ma || !mb) return;
      if (ma.kind === 'ball' || mb.kind === 'ball') {
        const otherHandle = ma.kind === 'ball' ? b : a, other = ma.kind === 'ball' ? mb : ma;
        if (started) {
          const contact = { ...other, confirmed: other.kind === 'player' && episodeConfirmed(other.playerId) };
          this.ballContacts.set(otherHandle, contact); candidates.set(otherHandle, contact);
          contactStarts.push(contact);
        } else this.ballContacts.delete(otherHandle);
      }
      const player = ma.kind === 'player' ? ma : mb.kind === 'player' ? mb : null;
      if (started && player && (ma.kind === 'floor' || mb.kind === 'floor')) {
        const p = this.players[player.playerId];
        if (p.landArmed && p.airTime > 0.12) {
          const position = { ...p.byName[player.part].body.translation(), y: 0 };
          this.world.contactPair(this.world.getCollider(a), this.world.getCollider(b), manifold => {
            if (manifold.numSolverContacts() > 0) Object.assign(position, manifold.solverContactPoint(0));
          });
          events.push({ type: 'land', playerId: p.id, team: p.team, part: player.part,
            position, speed: Math.max(0, -before.players[p.id].velocity.y) });
          p.landArmed = false; p.freeTime = 0;
        }
      }
      const net = ma.kind === 'net' || mb.kind === 'net';
      if (player && net) {
        const key = a < b ? a + ':' + b : b + ':' + a;
        if (started && !this.netContacts.has(key)) events.push({ type: 'net', playerId: player.playerId, team: player.team });
        if (started) this.netContacts.add(key); else this.netContacts.delete(key);
      }
    });
    const confirmImpulse = handle => {
      const other = this.colliderMeta.get(handle);
      if (other?.kind !== 'player') return;
      impulses.add(handle);
      if (!candidates.has(handle)) candidates.set(handle,
        { ...other, confirmed: episodeConfirmed(other.playerId) });
    };
    this.queue.drainContactForceEvents(force => {
      if (!(force.totalForceMagnitude() > 0)) return;
      const a = force.collider1(), b = force.collider2();
      if (a === this.ballColliderHandle) confirmImpulse(b);
      else if (b === this.ballColliderHandle) confirmImpulse(a);
    });
    const ballCollider = this.world.getCollider(this.ballColliderHandle);
    for (const [handle, other] of candidates) {
      if (other.kind !== 'player') continue;
      this.world.contactPair(ballCollider, this.world.getCollider(handle), manifold => {
        if (manifold.numSolverContacts() === 0) return;
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactImpulse(i) > 0) { confirmImpulse(handle); break; }
        }
      });
    }
    for (const handle of impulses) {
      const contact = candidates.get(handle), p = this.players[contact.playerId];
      // Air completion and public touches share the actual solver observation,
      // while a shin/body hit cannot finish this active foot's preparation.
      if (p.kick.mode === 'air' && p.kick.held && p.kick.airPlan?.phase === 'strike' && contact.part === 'foot' + p.kick.side)
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
          p.receive.hitAt = this.time; p.receive.phase = 'contact';
        }
        events.push({ type: 'touch', playerId: p.id, team: p.team, part: other.part,
          position, speed: this._length(this.ball.linvel()), footVelocity: { ...part.body.velocityAtPoint(position) },
          incomingSpeed: this._length(before.ballVelocity), reactionSeverity });
        p.lastTouch = this.time; sent.add(other.playerId);
        this.lastBallTouch = { playerId: p.id, team: p.team, time: this.time };
      }
    }
    return events;
  }

  getEntities() {
    const entities = [];
    for (const p of this.players) for (const part of p.parts) {
      const pos = part.body.translation(), q = part.body.rotation();
      entities.push({ id: part.id, kind: 'body', part: part.name, team: p.team,
        shape: part.shape, radius: part.radius, halfHeight: part.halfHeight, halfExtents: part.halfExtents,
        restHalfHeight: part.restGeometry.halfHeight,
        x: pos.x, y: pos.y, z: pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    }
    const pos = this.ball.translation(), q = this.ball.rotation();
    entities.push({ id: 'ball', kind: 'ball', part: 'ball', team: -1, shape: 'sphere', radius: this.settings.ballRadius,
      x: pos.x, y: pos.y, z: pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w });
    return entities;
  }

  save() {
    return {
      version: 3, time: this.time,
      // A received checkpoint is already validated by Rapier restoration and
      // the game's handle/geometry checks. Reuse its exact bytes until stepping;
      // GameKit's deterministic bootstrap verifier requires byte identity.
      snapshot: this.restoredSnapshotBytes?.slice() ?? this.world.takeSnapshot(), ballHandle: this.ball.handle,
      ballColliderHandle: this.ballColliderHandle, floorHandle: this.floorHandle,
      colliderMeta: [...this.colliderMeta.entries()].map(([h, m]) => [h, { ...m }]),
      ballContacts: [...this.ballContacts.entries()].map(([h, m]) => [h, { ...m }]), netContacts: [...this.netContacts],
      lastBallTouch: this.lastBallTouch ? { ...this.lastBallTouch } : null,
      players: this.players.map(p => ({
        id: p.id, athlete: structuredClone(p.athlete), receive: structuredClone(p.receive), state: p.state, grounded: p.grounded, contacts: [...p.contacts],
        jump: { ...p.jump }, kick: structuredClone(p.kick), gait: p.gait, airTime: p.airTime,
        supportAge: p.supportAge, recoveryTime: p.recoveryTime, lastTouch: p.lastTouch, desiredYaw: p.desiredYaw,
        freeTime: p.freeTime, landArmed: p.landArmed, reaction: { ...p.reaction },
        locomotionActive: p.locomotionActive,
        legs: { L: { ...p.legs.L }, R: { ...p.legs.R } },
        partHandles: p.parts.map(part => ({ name: part.name, body: part.body.handle, collider: part.colliderHandle,
          shape: part.shape, restGeometry: structuredClone(part.restGeometry),
          geometry: part.shape === 'box' ? { halfExtents: { ...part.halfExtents } } :
            part.shape === 'capsule' ? { radius: part.radius, halfHeight: part.halfHeight } : { radius: part.radius } })),
        joints: p.joints.map(j => ({ name: j.name, handle: j.handle, target: [...j.target],
          restAnchor1: { ...j.restAnchor1 }, restAnchor2: { ...j.restAnchor2 } })),
      })),
    };
  }

  load(data) {
    // Clone and validate incoming controller metadata before changing live
    // bodies. Failed restores must leave the current game usable.
    data = structuredClone(data);
    const vector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
    const receive = value => value === null || (value &&
      ['cushion', 'lunge', 'slide'].includes(value.mode) && ['prepare', 'contact', 'recover'].includes(value.phase) &&
      vector(value.point) && vector(value.direction) && value.committed === true &&
      Number.isFinite(value.startedAt) && value.startedAt >= 0 &&
      Number.isFinite(value.contactAt) && value.contactAt >= value.startedAt &&
      Number.isFinite(value.until) && value.until >= value.contactAt &&
      (value.hitAt === null || (Number.isFinite(value.hitAt) && value.hitAt >= value.startedAt)) &&
      (!Object.hasOwn(value, 'launch') || (Number.isFinite(value.launch) && value.launch >= 0)));
    const geometry = (value, shape) => value && (shape === 'box' ?
      Object.keys(value).length === 1 && vector(value.halfExtents) && ['x', 'y', 'z'].every(axis => value.halfExtents[axis] > 0) :
      Object.keys(value).length === (shape === 'capsule' ? 2 : 1) && Number.isFinite(value.radius) && value.radius > 0 &&
      (shape !== 'capsule' || (Number.isFinite(value.halfHeight) && value.halfHeight >= 0)));
    if (!data || data.version !== 3 || !data.snapshot || !Number.isFinite(data.time) || data.time < 0 ||
        !Array.isArray(data.players) || data.players.length !== 6 ||
        Array.from(data.players).some((saved, id) => !saved || saved.id !== id || !receive(saved.receive) ||
          !Array.isArray(saved.contacts) || !saved.jump || !saved.kick || !saved.legs || ['L', 'R'].some(suffix => {
            const leg = saved.legs[suffix];
            return !leg || ['scale', 'targetScale'].some(key => !Number.isFinite(leg[key]) ||
              leg[key] < 1 || leg[key] > this.settings.legStretch.maxScale + 1e-10);
          }) || !Array.isArray(saved.partHandles) || saved.partHandles.length !== this.players[id].parts.length ||
          new Set(saved.partHandles.map(part => part?.name)).size !== saved.partHandles.length ||
          Array.from(saved.partHandles).some(part => !part || !this.players[id].parts.some(item => item.name === part.name && item.shape === part.shape) ||
            !Number.isFinite(part.body) || !Number.isFinite(part.collider) || !geometry(part.geometry, part.shape) || !geometry(part.restGeometry, part.shape)) ||
          !Array.isArray(saved.joints) || saved.joints.length !== this.players[id].joints.length ||
          new Set(saved.joints.map(joint => joint?.name)).size !== saved.joints.length ||
          Array.from(saved.joints).some(joint => !joint || !this.players[id].joints.some(item => item.name === joint.name) ||
            !Number.isFinite(joint.handle) || !Array.isArray(joint.target) || joint.target.length !== 3 || !Array.from(joint.target).every(Number.isFinite) ||
            !vector(joint.restAnchor1) || !vector(joint.restAnchor2)))) {
      throw new Error('올바르지 않은 물리 스냅샷 (선수와 리시브 상태가 포함된 version 3 필요)');
    }
    const profiles = data.players.map((saved, id) => this._athleteProfile(saved.athlete, id));
    const receivedSnapshot = new Uint8Array(data.snapshot);
    const nextWorld = this.serializer.deserializeAll(receivedSnapshot.slice());
    if (!nextWorld) throw new Error('물리 스냅샷 복원 실패');
    let prepared, nextQueue, nextBall, nextColliderMeta, nextBallContacts, nextNetContacts;
    try {
      nextBall = nextWorld.getRigidBody(data.ballHandle);
      if (!nextBall || nextBall.handle !== data.ballHandle ||
          nextWorld.getCollider(data.ballColliderHandle)?.handle !== data.ballColliderHandle ||
          nextWorld.getCollider(data.floorHandle)?.handle !== data.floorHandle)
        throw new Error('스냅샷 공 또는 바닥 핸들이 유효하지 않습니다.');
      nextColliderMeta = new Map(data.colliderMeta);
      nextBallContacts = new Map(data.ballContacts.map(([handle, contact]) => [handle, { ...contact }]));
      nextNetContacts = new Set(data.netContacts);
      prepared = data.players.map(saved => ({
        parts: saved.partHandles.map(h => {
          const body = nextWorld.getRigidBody(h.body);
          if (!body || body.handle !== h.body || nextWorld.getCollider(h.collider)?.handle !== h.collider) throw new Error('스냅샷 신체 핸들이 유효하지 않습니다.');
          return { body, saved: h };
        }),
        joints: saved.joints.map(h => {
          const current = this.players[saved.id].joints.find(item => item.name === h.name);
          let joint = nextWorld.getImpulseJoint(h.handle);
          if (!joint || joint.handle !== h.handle) throw new Error('스냅샷 관절 핸들이 유효하지 않습니다.');
          if (!current.hinge && typeof joint.configureMotorPosition !== 'function')
            joint = new this.R.SphericalImpulseJoint(nextWorld.impulseJoints.raw, nextWorld.bodies, h.handle);
          return { joint, saved: h };
        }),
      }));
      nextQueue = new this.R.EventQueue(true);
    } catch (error) {
      nextWorld.free();
      throw error;
    }
    // All body/joint bindings and controller data are ready before the swap.
    this.world.free(); this.world = nextWorld;
    this.queue.free(); this.queue = nextQueue;
    this.time = data.time; this.ball = nextBall;
    this.ballColliderHandle = data.ballColliderHandle; this.floorHandle = data.floorHandle;
    this.colliderMeta = nextColliderMeta; this.ballContacts = nextBallContacts; this.netContacts = nextNetContacts;
    this.lastBallTouch = data.lastBallTouch ? { ...data.lastBallTouch } : null;
    for (const saved of data.players) {
      const p = this.players[saved.id], binding = prepared[saved.id];
      for (const key of ['state', 'grounded', 'gait', 'airTime', 'supportAge', 'recoveryTime', 'lastTouch', 'desiredYaw']) p[key] = saved[key];
      p.contacts = [...saved.contacts]; p.jump = { ...saved.jump }; p.kick = saved.kick; p.receive = saved.receive;
      p.freeTime = saved.freeTime || 0; p.landArmed = !!saved.landArmed;
      p.locomotionActive = !!saved.locomotionActive;
      p.legs = { L: { ...saved.legs.L }, R: { ...saved.legs.R } };
      p.reaction = saved.reaction ? { ...saved.reaction } : { remaining: 0, duration: 0, severity: 0, incomingSpeed: 0 };
      for (const { body, saved: h } of binding.parts) {
        const part = p.byName[h.name];
        part.body = body; part.colliderHandle = h.collider; part.restGeometry = h.restGeometry;
        Object.assign(part, h.geometry);
        if (/^(upperLeg|lowerLeg)/.test(part.name)) part.restLength = 2 * (part.restGeometry.halfHeight + part.restGeometry.radius);
      }
      p.root = p.byName.pelvis.body;
      for (const { joint, saved: h } of binding.joints) {
        const j = p.joints.find(item => item.name === h.name);
        j.handle = h.handle; j.target = [...h.target];
        j.restAnchor1 = { ...h.restAnchor1 }; j.restAnchor2 = { ...h.restAnchor2 }; j.joint = joint;
      }
    }
    this.setAthletes(profiles);
    // The restored world is equivalent to this exact received snapshot.
    // Preserve the original on-the-wire identity only until its first mutation.
    this.restoredSnapshotBytes = receivedSnapshot;
  }

  dispose() {
    this.restoredSnapshotBytes = null;
    this.queue.free(); this.world.free(); this.serializer.free();
    this.players.length = 0; this.colliderMeta.clear(); this.ballContacts.clear(); this.netContacts.clear();
  }
}

export { TakrawPhysics };
