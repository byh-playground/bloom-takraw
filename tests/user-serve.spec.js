import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

/** 우리 팀(0)이 서브하도록 만들고 공 던지기를 hold틱 동안 눌렀다 떼서, 서버 자리·공이 떨어진 앞쪽 거리·공 최고 높이를 돌려준다. */
async function serveToss(seed, hold) {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: structuredClone(TAKRAW_CONFIG) });
  try {
    game.reset('match', undefined, seed);
    const st = game.state; st.serving = 0; game.step({ tick: 1, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] }); game.placeServe();
    const server = game.physics.players[st.selected[0]], spot = TAKRAW_CONFIG.ai.serve.spot, at = server.root.translation(), placed = { x: at.x, z: at.z };
    const flags = { humanServes: game.humanServes(0), aiServes: game.humanServes(1), serverId: game.serverId(0), selected: st.selected[0] };
    let apex = 0, landed = null, pressed = 0, holding = 0;
    for (let tick = 2; tick < 1800 && landed === null; tick++) {
      const ready = st.serveToss?.stage === 'hold', down = ready && pressed < hold;
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, down ? 4 : 0], commands: ready && pressed === 0 ? [{ payload: [8] }] : [] }] });
      if (ready) pressed++;
      if (st.serveToss?.stage === 'thrown') { const b = game.physics.ball.translation(); apex = Math.max(apex, b.y); if (b.y < 0.2) landed = b.x - at.x; }
    }
    return { placed, spot, apex, landed, ...flags };
  } finally { game.dispose(); }
}

test('사람 서브: 공격수가 뒤쪽 서브 자리에 서고 공은 사람이 서브하는 팀으로 취급된다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const r = await serveToss(1, 0);
  expect(r.humanServes).toBe(true); expect(r.aiServes).toBe(false); expect(r.serverId).toBe(r.selected);
  expect(Math.abs(r.placed.x - r.spot.x)).toBeLessThan(0.3); expect(Math.abs(r.placed.z - r.spot.z)).toBeLessThan(0.3);
});

test('공 던지기: 짧게 누르면 낮게·서버 바로 앞에, 꾹 누르면 높게·멀리 떨어진다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const quick = await serveToss(2, 0), long = await serveToss(2, 60);
  expect(quick.apex).toBeLessThan(2.2); expect(long.apex).toBeGreaterThan(4);
  expect(quick.landed).toBeGreaterThan(0.5); expect(quick.landed).toBeLessThan(1.6);
  expect(long.landed - quick.landed).toBeGreaterThan(1);
});

test('공 던지기: 누르는 시간에 비례해 꼭짓점이 올라가고(중간값), 던지기 전에는 공이 서버 앞에 머문다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const mid = await serveToss(3, 25);
  expect(mid.apex).toBeGreaterThan(2.5); expect(mid.apex).toBeLessThan(4);
});
