import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

/** 랠리 중인 경기에서 팀0 사람이 받는 선수인 상황을 만든다. stance: 받는 자리까지 남은 거리(m, 선수 뒤쪽 -x 방향). */
async function setup(mode, stanceDistance, planMode = 'cushion') {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  game.reset(mode, undefined, 5);
  for (let tick = 1; tick < 1200 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
  expect(game.state.phase).toBe('rally');
  const player = game.physics.players[game.state.selected[0]], root = player.root.translation();
  game.state.defense[0] = { playerId: player.id, team: 0, human: true, humanPlan: null,
    plan: { mode: planMode, reachable: true, at: game.physics.time, time: 0.5, point: { x: root.x - stanceDistance - 0.8, y: 0.75, z: root.z },
      stance: { x: root.x - stanceDistance, z: root.z } } };
  return game;
}
const human = (x, z, extra = {}) => ({ x, z, kick: true, kickPressed: false, jump: false, jumpPressed: false, ...extra });

test('받기 보조: 받는 자리 근처에서 입력 크기만 줄이고 방향은 그대로 둔다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const game = await setup('match', 0.3);
  try {
    const out = game.assistReceive(0, human(-1, 0));
    expect(out.x).toBeGreaterThan(-1); expect(out.x).toBeLessThan(0); expect(out.z).toBe(0);
    const diagonal = game.assistReceive(0, human(-0.8, 0.6));
    expect(diagonal.x / diagonal.z).toBeCloseTo(-0.8 / 0.6, 6);
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeLessThan(1);
  } finally { game.dispose(); }
});

test('받기 보조: 멀리 있거나 다른 방향·점프·슬라이드·훈련이면 돕지 않는다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const far = await setup('match', 3);
  const near = await setup('match', 0.3);
  const slide = await setup('match', 0.3, 'slide');
  const training = await setup('training', 0.3);
  try {
    const run = { x: -1, z: 0 };
    expect(far.assistReceive(0, human(run.x, run.z))).toEqual(human(run.x, run.z));
    expect(near.assistReceive(0, human(1, 0))).toEqual(human(1, 0)); // 자리 반대로 가는 입력은 그대로
    expect(near.assistReceive(0, human(-1, 0, { jump: true }))).toEqual(human(-1, 0, { jump: true }));
    expect(near.assistReceive(0, human(-1, 0, { kick: false }))).toEqual(human(-1, 0, { kick: false }));
    expect(near.assistReceive(0, human(0.1, 0))).toEqual(human(0.1, 0)); // 거의 안 움직이면 그대로
    expect(slide.assistReceive(0, human(-1, 0))).toEqual(human(-1, 0));
    expect(training.assistReceive(0, human(-1, 0))).toEqual(human(-1, 0));
    expect(near.assistReceive(0, null)).toBeNull();
  } finally { for (const game of [far, near, slide, training]) game.dispose(); }
});
