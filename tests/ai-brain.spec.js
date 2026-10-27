import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { AiBrain, Temperament, seededUnit } from '../src/simulation/ai-brain.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const cfg = TAKRAW_CONFIG.ai.temperament;

test('성향: 같은 시드·선수·랠리는 같은 값, 시드가 다르면 값이 다르고 범위 안이다', () => {
  const a = new Temperament(cfg, 11, 1, 3), b = new Temperament(cfg, 11, 1, 3), c = new Temperament(cfg, 12, 1, 3);
  expect(a).toEqual(b);
  expect(a).not.toEqual(c);
  for (let seed = 0; seed < 200; seed++) {
    const t = new Temperament(cfg, seed, seed % 6, seed);
    expect(t.reaction).toBeGreaterThanOrEqual(cfg.reaction[0]); expect(t.reaction).toBeLessThanOrEqual(cfg.reaction[1]);
    expect(t.clearance).toBeGreaterThanOrEqual(cfg.clearance[0]); expect(t.clearance).toBeLessThanOrEqual(cfg.clearance[1]);
    expect(Math.abs(t.depth)).toBeLessThanOrEqual(cfg.depth); expect(Math.abs(t.lateral)).toBeLessThanOrEqual(cfg.lateral);
  }
  expect(seededUnit(1, 2, 3)).toBe(seededUnit(1, 2, 3));
});

// 전이만 확인하는 가짜 문맥. 상태의 target은 호출하지 않도록 game 없이 states를 대체한다.
function fakeBrain() {
  const brain = new AiBrain();
  for (const state of brain.states.values()) { state.target = () => ({ x: 0, z: 0 }); state.enter = () => {}; }
  return brain;
}
const ctx = (record, overrides) => ({ record, temperament: { reaction: 0.2 }, now: 0, player: 'p', active: null, defense: null,
  highContact: false, setTarget: null, ...overrides });

test('전이: 대기→보조는 반응 시간 뒤, 긴급 상태는 즉시, 대기 복귀는 즉시', () => {
  const brain = fakeBrain(), record = AiBrain.blankRecord(), defense = { plan: {} };
  expect(brain.update(ctx(record, { now: 1, defense })).mode).toBe('ready');
  expect(brain.update(ctx(record, { now: 1.1, defense })).mode).toBe('ready');
  expect(brain.update(ctx(record, { now: 1.25, defense })).mode).toBe('cover');
  expect(brain.update(ctx(record, { now: 1.3 })).mode).toBe('ready');
  expect(brain.update(ctx(record, { now: 2, defense, active: 'p' })).mode).toBe('receive');
  expect(brain.update(ctx(record, { now: 2.1, active: 'p', highContact: true })).mode).toBe('attack');
  expect(brain.update(ctx(record, { now: 2.2, active: 'p', setTarget: {} })).mode).toBe('set');
  expect(brain.update(ctx(record, { now: 2.3, active: 'p' })).mode).toBe('chase');
});

test('전이: 반응 시간 중 받는 선수로 지정되면 기다리지 않는다', () => {
  const brain = fakeBrain(), record = AiBrain.blankRecord();
  brain.update(ctx(record, { now: 1, defense: { plan: {} } }));
  expect(record.pending).toBe('cover');
  expect(brain.update(ctx(record, { now: 1.05, defense: { plan: {} }, active: 'p' })).mode).toBe('receive');
  expect(record.pending).toBeNull();
});

test('기록 검증: 정상 기록만 통과', () => {
  expect(AiBrain.validRecord(AiBrain.blankRecord())).toBe(true);
  expect(AiBrain.validRecord({ ...AiBrain.blankRecord(), mode: 'nope' })).toBe(false);
  expect(AiBrain.validRecord({ ...AiBrain.blankRecord(), lane: 0 })).toBe(false);
  expect(AiBrain.validRecord(null)).toBe(false);
});

test.describe('경기 변주(물리 엔진 필요)', () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const run = async (seed, ticks) => {
    const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
    game.reset('local', undefined, seed);
    for (let tick = 1; tick <= ticks; tick++) game.step({ tick, tickRate: 60, inputs: [] });
    return game;
  };

  test('같은 시드는 같은 상태, 다른 시드는 다른 공 위치', async () => {
    const a = await run(5, 900), b = await run(5, 900), c = await run(6, 900);
    expect(a.physics.ball.translation()).toEqual(b.physics.ball.translation());
    expect(a.ai.map(x => x.brain.mode)).toEqual(b.ai.map(x => x.brain.mode));
    expect(a.physics.ball.translation()).not.toEqual(c.physics.ball.translation());
    a.dispose(); b.dispose(); c.dispose();
  });

  test('저장·복원 뒤 이어서 진행한 결과가 끊김 없이 진행한 결과와 같다(롤백 계약)', async () => {
    const continuous = await run(9, 1200), half = await run(9, 600);
    const restored = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
    const data = half.save();
    expect(restored.validate(data)).toBe(true);
    restored.load(structuredClone(data));
    for (let tick = 601; tick <= 1200; tick++) restored.step({ tick, tickRate: 60, inputs: [] });
    expect(restored.physics.ball.translation()).toEqual(continuous.physics.ball.translation());
    expect(restored.ai.map(x => x.brain)).toEqual(continuous.ai.map(x => x.brain));
    continuous.dispose(); half.dispose(); restored.dispose();
  });
});
