import { test, expect } from 'playwright/test';
import { LinearPolicy, MlpPolicy, Policy, Quantizer, Adam, GaussianExploration, EmaBaseline, Reinforce, Trainer, PolicyStore, TuningSpec, TAKRAW_TUNING } from '../src/learning/index.js';

const mulberry = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const randomize = (policy, random) => { for (const p of policy.parameters()) for (let i = 0; i < p.weights.length; i++) p.weights[i] = (random() - 0.5) * 2; };
const obsOf = (random, n) => Float64Array.from({ length: n }, () => random() * 2 - 1);

test('역전파는 수치 미분과 일치한다 (선형·은닉층)', () => {
  const random = mulberry(1);
  for (const policy of [new LinearPolicy(5, 3), new MlpPolicy(5, [6, 4], 3)]) {
    randomize(policy, random);
    const obs = obsOf(random, 5), weightOf = Float64Array.from({ length: 3 }, () => random());
    const loss = () => policy.forward(obs).reduce((s, y, k) => s + y * weightOf[k], 0);
    policy.zeroGradient(); policy.forward(obs); policy.backward(weightOf);
    for (const p of policy.parameters()) for (const i of [0, 1, p.weights.length - 1]) {
      const h = 1e-6, original = p.weights[i];
      p.weights[i] = original + h; const up = loss(); p.weights[i] = original - h; const down = loss(); p.weights[i] = original;
      expect(Math.abs((up - down) / (2 * h) - p.gradient[i])).toBeLessThan(1e-6);
    }
  }
});

test('양자화: 4비트 저장 크기, 왕복 오차, 복원 정책의 출력 일치', () => {
  const random = mulberry(2), policy = new LinearPolicy(24, 8);
  randomize(policy, random);
  const bytes = policy.toQuantized(4);
  expect(bytes.length).toBe(5 + 5 + 8 * 4 + Math.ceil(8 * 25 * 4 / 8)); // 헤더 + 층 정보 + 행별 스케일 + 비트열 = 142
  const restored = Policy.fromQuantized(bytes), snapped = new LinearPolicy(24, 8);
  snapped.parameters().forEach((p, i) => p.weights.set(policy.parameters()[i].weights)); snapped.snapToQuantized(4);
  for (let n = 0; n < 20; n++) { const obs = obsOf(random, 24); expect(restored.forward(obs)).toEqual(snapped.forward(obs)); }
  for (const bits of [2, 3, 4, 6, 8]) {
    const err = [...policy.parameters()[0].weights].map((w, i) => Math.abs(w - Quantizer.roundTrip(policy.parameters()[0].weights, 8, 25, bits)[i]));
    expect(Math.max(...err)).toBeLessThanOrEqual(1 / (2 ** (bits - 1) - 1) / 2 * 1.001 + 1e-6); // 행 최댓값 ≤ 1 → 스케일 ≤ 1/L, 오차 ≤ 스케일/2
  }
  expect(() => Policy.fromQuantized(bytes.slice(0, 20))).toThrow();
  expect(() => Policy.fromQuantized(Uint8Array.of(1, 2, 3, 4, 5))).toThrow();
});

test('은닉층 정책도 같은 저장 형식으로 복원된다', () => {
  const random = mulberry(3), policy = new MlpPolicy(6, [5], 2); randomize(policy, random); policy.snapToQuantized(6);
  const restored = Policy.fromQuantized(policy.toQuantized(6)), obs = obsOf(random, 6);
  expect(restored.forward(obs)).toEqual(policy.forward(obs));
});

test('REINFORCE: 알려진 최적 출력을 향해 보상이 오른다', () => {
  const random = mulberry(4), policy = new LinearPolicy(4, 3), target = [0.6, -0.4, 0.2];
  const algorithm = new Reinforce({ policy, exploration: new GaussianExploration({ sigma: 0.3, random }), baseline: new EmaBaseline(), optimizer: new Adam({ learningRate: 0.05 }) });
  const reward = a => -a.reduce((s, x, k) => s + (x - target[k]) ** 2, 0);
  const meanReward = () => reward(policy.forward(Float64Array.of(1, 0, 0, 1))), before = meanReward();
  for (let r = 0; r < 300; r++) {
    const batch = Array.from({ length: 8 }, () => { const e = algorithm.sample(Float64Array.of(1, 0, 0, 1)); return { ...e, reward: reward(e.action) }; });
    algorithm.update(batch);
  }
  expect(meanReward()).toBeGreaterThan(before + 0.4); // 탐험 잡음 없는 평균 출력의 보상: 약 -0.56에서 0 근처로
  const final = policy.forward(Float64Array.of(1, 0, 0, 1));
  expect(Math.max(...final.map((x, k) => Math.abs(x - target[k])))).toBeLessThan(0.15);
});

test('Trainer: 배치 단위로 epoch를 세고 중단 요청을 따른다', async () => {
  const random = mulberry(5), policy = new LinearPolicy(2, 1);
  const algorithm = new Reinforce({ policy, exploration: new GaussianExploration({ sigma: 0.3, random }), baseline: new EmaBaseline(), optimizer: new Adam() });
  const task = { rollout: (seed, choose) => { const e = choose(Float64Array.of(1, 1)); return { ...e, reward: -Math.abs(e.action[0]), success: e.action[0] < 0, code: 'x' }; } };
  const trainer = new Trainer({ task, algorithm, random, batchSize: 8 }), seen = [];
  expect(await trainer.run(20, { onBatch: b => seen.push(b.epochs), yieldToUi: async () => {} })).toBe(20);
  expect(seen).toEqual([8, 16, 20]);
  let calls = 0;
  expect(await trainer.run(100, { shouldStop: () => ++calls > 2, yieldToUi: async () => {} })).toBe(16);
});

test('PolicyStore: 저장·복원·손상·접근 실패', () => {
  const memory = new Map(), storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  const store = new PolicyStore(storage), random = mulberry(6), policy = new LinearPolicy(24, 8); randomize(policy, random);
  expect(store.load('a')).toBeNull();
  expect(store.save('a', policy, { epochs: 300 })).toBe(true);
  const loaded = store.load('a'), obs = obsOf(random, 24);
  expect(loaded.meta.epochs).toBe(300);
  policy.snapToQuantized(4); expect(loaded.policy.forward(obs)).toEqual(policy.forward(obs));
  expect(memory.get('bloom-takraw:policy:a').length).toBeLessThan(260); // 가중치 200개가 한 줄 약 250자
  memory.set('bloom-takraw:policy:b', '{깨진 데이터'); expect(store.load('b')).toBeNull();
  const broken = new PolicyStore({ getItem() { throw new Error('차단'); }, setItem() { throw new Error('차단'); }, removeItem() { throw new Error('차단'); } });
  expect(broken.save('a', policy)).toBe(false); expect(broken.load('a')).toBeNull(); broken.remove('a');
});

test('TuningSpec: 0은 기본값, ±1은 범위 끝, 범위 밖은 잘린다', () => {
  const game = { config: { ai: { toss: { aim: { dx: 0.7, dz: 0 }, ground: { lead: 0.3, followThrough: 0.15 } }, receive: { braking: 0.18 } } }, physics: { settings: { groundToss: { attackApex: 4.2, contactHeight: 0.75, strokeTime: 0.12 } } } };
  const spec = new TuningSpec(), zero = spec.decode(new Array(spec.size).fill(0), game);
  expect(zero).toEqual(spec.defaults(game)); expect(zero.aimDx).toBe(0.7);
  const high = spec.decode(new Array(spec.size).fill(1), game), low = spec.decode(new Array(spec.size).fill(-5), game);
  TAKRAW_TUNING.forEach(e => { expect(high[e.name]).toBeCloseTo(e.max, 10); expect(low[e.name]).toBeCloseTo(e.min, 10); });
  expect(() => spec.decode([0], game)).toThrow();
});
