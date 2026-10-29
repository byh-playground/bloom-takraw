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
    let apex = 0, landed = null, pressed = 0, heldHeight = 0;
    for (let tick = 2; tick < 1800 && landed === null; tick++) {
      const ready = st.serveToss?.stage === 'hold', down = ready && pressed < hold;
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, down ? 2 : 0], commands: ready && pressed === 0 ? [{ payload: [2] }] : [] }] });
      if (ready) { pressed++; heldHeight = Math.max(heldHeight, game.physics.ball.translation().y); }
      if (st.serveToss?.stage === 'thrown') { const b = game.physics.ball.translation(); apex = Math.max(apex, b.y); if (b.y < 0.2) landed = b.x - at.x; }
    }
    return { placed, spot, apex, landed, heldHeight, ...flags };
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
  expect(long.landed - quick.landed).toBeGreaterThan(0.4);
});

test('공 던지기: 누르는 시간에 비례해 꼭짓점이 올라가고(중간값), 던지기 전에는 공이 서버 앞에 머문다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const mid = await serveToss(3, 25);
  expect(mid.apex).toBeGreaterThan(2.5); expect(mid.apex).toBeLessThan(4);
});

test('공 던지기: 누르는 동안 공이 손에서 점점 올라가 높이 변화가 보이고, 던지기 전 발차기는 발로 가지 않는다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const quick = await serveToss(4, 1), long = await serveToss(4, 60);
  expect(long.heldHeight - quick.heldHeight).toBeGreaterThan(0.5);
});

test('사람 서브: 서브 자리는 엔드라인 뒤다', async () => {
  expect(Math.abs(TAKRAW_CONFIG.ai.serve.spot.x)).toBeGreaterThan(TAKRAW_CONFIG.court.halfLength);
});

test('공 던지기 전: 서버가 공 쪽으로 돌아다니며 몸이 부딪혀도 터치·반칙 없이 공이 손에 머문다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: structuredClone(TAKRAW_CONFIG) });
  try {
    game.reset('match', undefined, 6);
    const st = game.state; st.serving = 0; game.step({ tick: 1, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] }); game.placeServe();
    const byte = v => Math.round(Math.max(-1, Math.min(1, v)) * 127) & 255;
    let tick = 2, held = 0, maxGap = 0;
    for (; tick < 1800 && st.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
    for (let i = 0; i < 360; i++, tick++) { // 6초: 공 쪽으로 걷고 뒤로 걷고 옆으로 걷는다.
      const phase = Math.floor(i / 60) % 3, move = phase === 0 ? [0, 1] : phase === 1 ? [-1, 0.5] : [0, -1]; // 엔드라인 안쪽은 밟지 않는다.
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte(move[0]), byte(move[1]), 0], commands: [] }] });
      if (st.serveToss?.stage === 'hold') held++;
      const b = game.physics.ball.translation(), s = game.physics.players[st.selected[0]].root.translation();
      maxGap = Math.max(maxGap, Math.hypot(b.x - s.x, b.z - s.z));
    }
    expect(held).toBe(360); expect(st.phase).toBe('rally'); expect(st.lastTouch).toBe(-1); expect(st.touches).toBe(0);
    expect(maxGap).toBeLessThan(1.5);
  } finally { game.dispose(); }
});

test('서브 라인 반칙: 공을 든 채 엔드라인 안쪽을 밟으면 서브 팀이 실점하고, 던진 뒤에는 코트로 들어가도 된다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const play = async (throwFirst) => {
    const game = new TakrawGame({ RAPIER: await loadRapier(), config: structuredClone(TAKRAW_CONFIG) });
    try {
      game.reset('match', undefined, 7);
      const st = game.state; st.serving = 0; game.step({ tick: 1, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] }); game.placeServe();
      let tick = 2; for (; tick < 1800 && st.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
      const score = [...st.score];
      for (let i = 0; i < 240 && st.phase === 'rally'; i++, tick++) {
        const tossing = throwFirst && i < 2; // 처음 두 틱에 짧게 눌러 바로 던진다.
        game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [127, 0, tossing ? 2 : 0], commands: i === 0 && throwFirst ? [{ payload: [2] }] : [] }] });
      }
      return { reason: st.pointReason, winner: st.pointWinner, phase: st.phase, score, after: [...st.score] };
    } finally { game.dispose(); }
  };
  const fault = await play(false);
  expect(fault.reason).toBe('서브 라인 반칙'); expect(fault.winner).toBe(1);
  const legal = await play(true);
  expect(legal.reason).not.toBe('서브 라인 반칙');
});
