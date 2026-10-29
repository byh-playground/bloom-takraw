import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const [wide, narrow] = TAKRAW_CONFIG.ai.toss.spread.radius, maxSetting = TAKRAW_CONFIG.athletes.bonus.setting;

/** 랠리 번호를 바꿔 가며 세트 목표 흩어짐 offset을 모은다. */
function samples(game, setter, count = 200) {
  const out = [];
  for (let rally = 1; rally <= count; rally++) { game.state.rally = rally; out.push(game.tossSpread(setter)); }
  return out;
}

test('세트 흩어짐: 토스 능력이 기본이면 반지름 안, 최대면 더 작은 반지름 안에서 고르게 흩어진다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  try {
    game.reset('match', undefined, 11);
    const base = samples(game, { id: 1, effects: { setting: 0 } }), best = samples(game, { id: 1, effects: { setting: maxSetting } });
    const reach = list => Math.max(...list.map(point => Math.hypot(point.x, point.z)));
    expect(reach(base)).toBeLessThanOrEqual(wide + 1e-9); expect(reach(base)).toBeGreaterThan(wide * 0.9);
    expect(reach(best)).toBeLessThanOrEqual(narrow + 1e-9);
    // 방향이 한쪽으로 쏠리지 않는다(원 안 평균이 중심 근처).
    const mean = key => base.reduce((sum, point) => sum + point[key], 0) / base.length;
    expect(Math.abs(mean('x'))).toBeLessThan(wide * 0.2); expect(Math.abs(mean('z'))).toBeLessThan(wide * 0.2);
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
