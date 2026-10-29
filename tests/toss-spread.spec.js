import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const half = TAKRAW_CONFIG.ai.toss.spread.half, maxSetting = TAKRAW_CONFIG.athletes.bonus.setting;

/** 랠리 번호를 바꿔 가며 세트 목표 흩어짐 offset을 모은다. */
function samples(game, setter, count = 200) {
  const out = [];
  for (let rally = 1; rally <= count; rally++) { game.state.rally = rally; out.push(game.tossSpread(setter)); }
  return out;
}

test('세트 흩어짐: 토스 능력이 기본이면 넓은 박스, 최대면 좁은 박스 안에서 고르게 흩어지고 앞뒤가 좌우보다 좁다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  try {
    game.reset('match', undefined, 11);
    const base = samples(game, { id: 1, effects: { setting: 0 } }), best = samples(game, { id: 1, effects: { setting: maxSetting } });
    const reach = (list, key) => Math.max(...list.map(point => Math.abs(point[key])));
    expect(reach(base, 'x')).toBeLessThanOrEqual(half.x[0] + 1e-9); expect(reach(base, 'x')).toBeGreaterThan(half.x[0] * 0.9);
    expect(reach(base, 'z')).toBeLessThanOrEqual(half.z[0] + 1e-9); expect(reach(base, 'z')).toBeGreaterThan(half.z[0] * 0.9);
    expect(reach(best, 'x')).toBeLessThanOrEqual(half.x[1] + 1e-9); expect(reach(best, 'z')).toBeLessThanOrEqual(half.z[1] + 1e-9);
    expect(half.x[0]).toBeLessThan(half.z[0]); expect(half.x[1]).toBeLessThan(half.z[1]);
    // 방향이 한쪽으로 쏠리지 않는다(평균이 중심 근처).
    const mean = key => base.reduce((sum, point) => sum + point[key], 0) / base.length;
    expect(Math.abs(mean('x'))).toBeLessThan(half.x[0] * 0.25); expect(Math.abs(mean('z'))).toBeLessThan(half.z[0] * 0.25);
  } finally { game.dispose(); }
});

test('세트 흩어짐: 같은 상황은 같은 점이고(피어 일치), 연습 모드는 흩어지지 않는다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const RAPIER = await loadRapier(), setter = { id: 1, effects: { setting: 0 } };
  const a = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG }), b = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });
  try {
    for (const game of [a, b]) { game.reset('match', undefined, 11); game.state.rally = 3; game.state.touches = 1; }
    expect(a.tossSpread(setter)).toEqual(b.tossSpread(setter));
    expect(a.tossSpread(setter)).toEqual(a.tossSpread(setter));
    a.reset('training'); expect(a.tossSpread(setter)).toEqual({ x: 0, z: 0 });
  } finally { a.dispose(); b.dispose(); }
});
