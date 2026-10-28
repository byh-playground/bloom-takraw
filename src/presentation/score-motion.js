const POSE_KEYS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'halfHeight'];

/** 기존 실제 접촉과 바닥 득점 이벤트만 읽는다. */
function winningSpikeScore(point, cause, contact) {
  return point.type === 'point' && cause?.type === 'ground' && !!contact?.spike && contact.team === point.team;
}

/** 표시 포즈 전용 시간축. 원본 frame, 게임 시계와 물리 step에는 쓰지 않는다. */
class TakrawScoreMotion {
  constructor() { this.reset(); }
  reset() { this.history = []; this.until = null; this.sampleAt = 0; this.lastAt = 0; }
  start(now) { this.reset(); this.until = now + 500; this.sampleAt = this.lastAt = now; }

  apply(frame, now, draw, enabled) {
    if (!enabled) this.reset();
    if (this.until === null) { frame.forEach(draw); return; }
    if (now < this.lastAt) { this.until = now + 500; this.sampleAt = this.lastAt = now; }
    const slow = Math.max(0, Math.min(now, this.until) - this.lastAt);
    const catchup = Math.max(0, now - Math.max(this.lastAt, this.until));
    this.sampleAt += slow * .5 + catchup * 1.5;
    this.lastAt = now;
    if (now >= this.until && this.sampleAt >= now) { this.reset(); frame.forEach(draw); return; }
    const poses = new Map();
    frame.forEach((model, id) => poses.set(id, Object.fromEntries(POSE_KEYS.map(key => [key, model[key] ?? 0]))));
    this.history.push({ at: now, poses });
    while (this.history.length > 2 && this.history[1].at <= this.sampleAt) this.history.shift();
    const a = this.history[0], b = this.history[1] || a;
    const t = a === b ? 0 : Math.max(0, Math.min(1, (this.sampleAt - a.at) / (b.at - a.at)));
    for (const [id, right] of b.poses) {
      const left = a.poses.get(id) || right, pose = {};
      const sign = left.qx * right.qx + left.qy * right.qy + left.qz * right.qz + left.qw * right.qw < 0 ? -1 : 1;
      for (const key of POSE_KEYS) pose[key] = left[key] + ((key.startsWith('q') ? sign : 1) * right[key] - left[key]) * t;
      draw(pose, id);
    }
  }
}

export { TakrawScoreMotion, winningSpikeScore };
