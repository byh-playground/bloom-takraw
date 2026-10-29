import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

/** 공격수(사람)를 제자리에 두고 세터에게 공을 떨어뜨려, 세트가 공격수 기준 어디로 내려오는지(앞 +x, 옆 +z) 돌려준다. */
async function landing(config, seed) {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config });
  try {
    game.reset('match', undefined, seed);
    let tick = 1; const idle = [{ playerId: 'h', input: [0, 0, 0], commands: [] }];
    for (; tick < 1200 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: idle });
    const st = game.state, physics = game.physics, human = physics.players[st.selected[0]], setter = physics.players[1].root.translation();
    physics.resetBall({ x: setter.x + 0.8, y: 2.4, z: setter.z - 0.1 }, { x: 0, y: 1.5, z: 0 });
    st.possession = 0; st.touches = 1; st.lastTouch = 0; st.serving = 0; st.serveToss = null; st.toss = null; st.play = null; game.aiDirty = true;
    let previous = 9;
    for (let i = 0; i < 360 && st.phase === 'rally'; i++, tick++) {
      game.step({ tick, tickRate: 60, inputs: idle });
      const ball = physics.ball.translation(), me = human.root.translation();
      if (st.toss?.to === human.id && previous > 3.3 && ball.y <= 3.3) return { x: ball.x - me.x, z: ball.z - me.z };
      previous = ball.y;
    }
    return null;
  } finally { game.dispose(); }
}
const noSpread = assist => { const config = structuredClone(TAKRAW_CONFIG); config.ai.toss.spread = null; config.physics.groundToss.attackAssist = assist; return config; };
const miss = point => Math.hypot(point.x - 0.7, point.z + 0.1);

test('세트 보정: 공격수를 가만히 둬도 세트가 공격수 앞 기준점(앞 0.7 m) 0.4 m 안으로 내려온다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  for (const seed of [1, 2, 3]) expect(miss(await landing(noSpread(true), seed))).toBeLessThan(0.4);
});

test('세트 보정: 끄면 기준점에서 크게 벗어나고 오른쪽(+z)으로 쏠린다(이전 동작)', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const point = await landing(noSpread(false), 1);
  expect(miss(point)).toBeGreaterThan(0.8); expect(point.z).toBeGreaterThan(0.3);
});
