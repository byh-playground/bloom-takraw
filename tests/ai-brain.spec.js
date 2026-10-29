import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { AiBrain, Temperament, seededUnit } from '../src/simulation/ai-brain.js';
import { TakrawGame } from '../src/simulation/game.js';
import { TAKRAW_LADDER } from '../src/config/schools.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const cfg = TAKRAW_CONFIG.ai.temperament;

test('도전 단계 성향: 고정 seed 해시를 유지하고 반응·간격·기본 위치 범위를 적용한다', () => {
  for (const school of TAKRAW_LADDER) {
    expect(Temperament.validConfig(school.ai.temperament)).toBeTruthy();
    const a = new Temperament(school.ai.temperament, 11, 4, 3), b = new Temperament(school.ai.temperament, 11, 4, 3);
    expect(a).toEqual(b);
    expect(a.side).toBe(new Temperament(cfg, 11, 4, 3).side);
    expect(a.reaction).toBeGreaterThanOrEqual(school.ai.temperament.reaction[0]);
    expect(a.reaction).toBeLessThanOrEqual(school.ai.temperament.reaction[1]);
    for (const player of school.ai.players) for (const score of Object.values(player.stats)) {
      expect(score).toBeGreaterThanOrEqual(TAKRAW_CONFIG.athletes.base);expect(score).toBeLessThanOrEqual(TAKRAW_CONFIG.athletes.max);
    }
  }
  for (const invalid of [null, [], {}, {...cfg,reaction:[1,0]}, {...cfg,lateral:-1}, {...cfg,depth:NaN}, {...cfg,clearance:new Array(2)}]) {
    expect(Temperament.validConfig(invalid)).toBeFalsy();
  }
});

test('학교 성향 snapshot: 저장·복구와 기본 프로필 복귀', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  try {
    game.setTemperaments([null,TAKRAW_LADDER[4].ai.temperament]);game.reset('match',undefined,11);
    const before = game.temperamentOf(4), saved = game.save();
    expect(game.validate(saved)).toBeTruthy();
    game.setTemperaments();expect(game.temperamentOf(4)).toEqual(new Temperament(cfg,11,4,0));
    game.load(saved);expect(game.temperamentOf(4)).toEqual(before);
    expect(game.validate({...saved,temperamentProfiles:[null,{}]})).toBeFalsy();
  } finally {game.dispose();}
});

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
