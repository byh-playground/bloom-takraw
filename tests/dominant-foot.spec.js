import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const withPhysics = async (config, run) => {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config });
  try { return run(game.physics); } finally { game.dispose(); }
};

test('주발: 선수는 처음부터 오른발이 차는 발이다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  await withPhysics(structuredClone(TAKRAW_CONFIG), physics => { for (const p of physics.players) expect(p.kick.side).toBe('R'); });
});

test('주발: 지상에서는 공이 몸 중심에서 왼쪽으로 groundOffset을 넘을 때만 왼발', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  await withPhysics(structuredClone(TAKRAW_CONFIG), physics => {
    const { groundOffset } = TAKRAW_CONFIG.physics.dominantFoot;
    for (const x of [0.4, 0.1, 0, -0.1, -(groundOffset - 0.01)]) expect(physics._groundSide(x)).toBe('R');
    for (const x of [-(groundOffset + 0.01), -0.6]) expect(physics._groundSide(x)).toBe('L');
  });
});

test('주발: 공중에서는 왼발 발바닥이 airMargin보다 더 가까울 때만 왼발(같은 거리면 오른발)', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  await withPhysics(structuredClone(TAKRAW_CONFIG), physics => {
    const { airMargin } = TAKRAW_CONFIG.physics.dominantFoot;
    expect(physics._airSide({ L: 1, R: 1 })).toBe('R');
    expect(physics._airSide({ L: 1 - airMargin / 2, R: 1 })).toBe('R');
    expect(physics._airSide({ L: 1 - airMargin - 0.01, R: 1 })).toBe('L');
  });
});

test('주발: 설정을 왼발로 바꾸면 같은 규칙이 좌우 대칭으로 적용된다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const config = structuredClone(TAKRAW_CONFIG); config.physics.dominantFoot.side = 'L';
  await withPhysics(config, physics => {
    expect(physics.players[0].kick.side).toBe('L');
    expect(physics._groundSide(-0.1)).toBe('L'); expect(physics._groundSide(0.4)).toBe('R');
    expect(physics._airSide({ L: 1, R: 1 })).toBe('L');
  });
});
