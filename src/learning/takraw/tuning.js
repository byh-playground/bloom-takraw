/** 학습이 조정하는 값의 유일한 정의. 기본값은 게임 설정에서 읽고, 여기에는 범위만 둔다. */
const TAKRAW_TUNING = Object.freeze([
  { name: 'aimDx', root: 'config', path: ['ai', 'toss', 'aim', 'dx'], min: 0, max: 1.6 },
  { name: 'aimDz', root: 'config', path: ['ai', 'toss', 'aim', 'dz'], min: -0.6, max: 0.6 },
  { name: 'attackApex', root: 'settings', path: ['groundToss', 'attackApex'], min: 2.4, max: 5.4 },
  { name: 'lead', root: 'config', path: ['ai', 'toss', 'ground', 'lead'], min: 0.15, max: 0.5 },
  { name: 'followThrough', root: 'config', path: ['ai', 'toss', 'ground', 'followThrough'], min: 0.05, max: 0.30 },
  { name: 'braking', root: 'config', path: ['ai', 'receive', 'braking'], min: 0.05, max: 0.40 },
  { name: 'contactHeight', root: 'settings', path: ['groundToss', 'contactHeight'], min: 0.55, max: 0.95 },
  { name: 'strokeTime', root: 'settings', path: ['groundToss', 'strokeTime'], min: 0.08, max: 0.20 },
]);

class TuningSpec {
  constructor(entries = TAKRAW_TUNING) { this.entries = entries; }
  get size() { return this.entries.length; }
  get names() { return this.entries.map(entry => entry.name); }
  baseOf(game, entry) {
    const root = entry.root === 'config' ? game.config : game.physics.settings;
    return entry.path.reduce((node, key) => node[key], root);
  }
  defaults(game) { return Object.fromEntries(this.entries.map(entry => [entry.name, this.baseOf(game, entry)])); }
  /** 출력 [-1, 1] → 값. 0은 기본값, -1은 최솟값, +1은 최댓값이며 사칙연산만 쓴다. */
  decode(output, game) {
    if (output.length !== this.size) throw new Error('출력 길이가 조정 값 수와 다릅니다.');
    return Object.fromEntries(this.entries.map((entry, i) => {
      const base = this.baseOf(game, entry), x = Math.max(-1, Math.min(1, output[i]));
      return [entry.name, x >= 0 ? base + (entry.max - base) * x : base + (base - entry.min) * x];
    }));
  }
}

export { TAKRAW_TUNING, TuningSpec };
