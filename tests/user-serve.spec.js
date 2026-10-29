import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

/** 우리 팀(0)이 서브하도록 만들고 서브 공이 떨어질 때까지 돌려, 서버·공 위치와 공 최고 높이를 돌려준다. */
async function serveSetup(seed) {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: structuredClone(TAKRAW_CONFIG) });
  try {
    game.reset('match', undefined, seed);
    const st = game.state, idle = [{ playerId: 'h', input: [0, 0, 0], commands: [] }];
    st.serving = 0; game.step({ tick: 1, tickRate: 60, inputs: idle }); game.placeServe();
    const server = game.physics.players[st.selected[0]], spot = TAKRAW_CONFIG.ai.serve.spot;
    const at = server.root.translation(), placed = { x: at.x, z: at.z };
    const flags = { humanServes: game.humanServes(0), serverId: game.serverId(0), selected: st.selected[0], aiServes: game.humanServes(1) };
    let tick = 2, apex = 0;
    for (; tick < 1500 && st.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: idle });
    for (let i = 0; i < 120 && st.phase === 'rally'; i++, tick++) { game.step({ tick, tickRate: 60, inputs: idle }); apex = Math.max(apex, game.physics.ball.translation().y); }
    return { placed, spot, apex, ...flags };
  } finally { game.dispose(); }
}

test('사람 서브: 공격수가 뒤쪽 서브 자리에 서고 공은 사람이 서브하는 팀으로 취급된다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const r = await serveSetup(1);
  expect(r.humanServes).toBe(true); expect(r.aiServes).toBe(false); expect(r.serverId).toBe(r.selected);
  expect(Math.abs(r.placed.x - r.spot.x)).toBeLessThan(0.3); expect(Math.abs(r.placed.z - r.spot.z)).toBeLessThan(0.3);
});

test('사람 서브: 공이 서버 앞에서 꼭짓점 3 m 이상으로 올라간다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  expect((await serveSetup(2)).apex).toBeGreaterThan(3);
});
