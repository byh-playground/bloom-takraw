import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const byte = value => Math.round(Math.max(-1, Math.min(1, value)) * 127) & 255;

/** 네트 앞 x=-1.15에 선 사람에게 상대 스파이크(약 10 m/s, 네트 위 1.7 m)가 내려꽂힐 때, delay초에 점프(+kick이면 발차기)를 눌렀을 때 공이 상대 쪽으로 넘어갔는지 돌려준다. */
async function spike(delay, { kick } = {}) {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  try {
    game.reset('match', undefined, 200);
    let tick = 1;
    for (; tick < 1200 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
    const st = game.state, physics = game.physics, me = physics.players[st.selected[0]], netX = -1.15, z0 = 0;
    st.possession = 1; st.touches = 1; st.lastTouch = 3; st.serving = 1;
    for (let i = 0; i < 150 && st.phase === 'rally'; i++, tick++) { // 공을 상대 쪽 허공에 붙잡고 사람을 자리로 걸어가게 한다.
      physics.resetBall({ x: 4, y: 7, z: 0 }, { x: 0, y: 0, z: 0 });
      const here = me.root.translation();
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte((netX - here.x) * 3), byte((z0 - here.z) * 3), 0], commands: [] }] });
    }
    const flight = 0.35, g = 9.81, from = { x: 1.5, y: 3.2, z: 0.4 }, to = { x: netX - 0.6, y: 0.3, z: z0 };
    physics.resetBall(from, { x: (to.x - from.x) / flight, y: (to.y - from.y + 0.5 * g * flight * flight) / flight, z: (to.z - from.z) / flight });
    st.touches = 2; game.aiDirty = true;
    const start = st.time; let touched = false, maxX = -9;
    for (let i = 0; i < 132 && st.phase === 'rally'; i++, tick++) {
      const t = st.time - start, here = me.root.translation(), press = t >= delay && t < delay + 0.6;
      const commands = press && t - delay < 1 / 60 + 1e-6 ? [{ payload: [1] }, ...(kick ? [{ payload: [2] }] : [])] : [];
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte((netX - here.x) * 3), byte((z0 - here.z) * 3), press ? (kick ? 3 : 1) : 0], commands }] });
      if ((game.events || []).some(e => e.type === 'touch' && e.team === 0)) touched = true;
      if (touched) maxX = Math.max(maxX, physics.ball.translation().x);
    }
    return { touched, maxX };
  } finally { game.dispose(); }
}

test('블로킹: 네트 앞에서 점프+발차기로 내려꽂히는 공을 되받아 상대 쪽으로 넘긴다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  for (const delay of [0.05, 0.1, 0.15]) {
    const result = await spike(delay, { kick: true });
    expect(result.touched, `delay ${delay}`).toBe(true);
    expect(result.maxX, `delay ${delay}`).toBeGreaterThan(0.3);
  }
});

test('블로킹: 발차기를 누르지 않으면 되받아치기가 일어나지 않는다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const result = await spike(0.1, { kick: false });
  expect(result.maxX).toBeLessThan(0.3);
});
