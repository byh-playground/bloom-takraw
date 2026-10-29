import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const byte = value => Math.round(Math.max(-1, Math.min(1, value)) * 127) & 255;

/** 안내(발자국·점프 구간·발차기 시점)를 그대로 따르는 사람으로 연습 공 attempts개를 시도해 결과 코드를 센다. */
async function drill(tempo, attempts) {
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  const out = { codes: {}, shortJump: 0, setAtOnFeed: 0 };
  try {
    game.reset('training', 'auto', 1, tempo);
    let tick = 1, inRally = false, hold = 0, done = 0, sawShort = false;
    while (done < attempts && tick < 60 * 300) {
      const st = game.state, me = game.physics.players[st.selected[0]];
      let ix = 0, iz = 0, jump = false, jumpPressed = false, kick = false, kickPressed = false;
      if (st.phase === 'rally') {
        inRally = true;
        const guide = game.getAttackGuides()[0], training = game.getTraining(guide);
        if (guide && me.grounded) {
          const p = me.root.translation(), dx = guide.stance.x - p.x, dz = guide.stance.z - p.z, d = Math.hypot(dx, dz);
          if (!guide.inPosition || d > 0.15) { ix = dx / (d || 1); iz = dz / (d || 1); if (d < 0.5) { ix *= d / 0.5; iz *= d / 0.5; } }
          if (guide.jumpWindow) { jumpPressed = jump = true; hold = guide.shortJump ? 1 : 14; sawShort ||= guide.shortJump; }
        }
        if (hold > 0 && !jumpPressed) { jump = !me.grounded; hold--; }
        if (me.jump.active && training?.kickIn !== null && training?.kickIn <= 0) { kick = true; kickPressed = !game.inputs[me.id]?.kick; }
        else if (me.jump.active && game.inputs[me.id]?.kick) kick = true;
      } else if (inRally) {
        const code = st.training.result?.code;
        out.codes[code] = (out.codes[code] || 0) + 1; if (sawShort) out.shortJump++;
        sawShort = false; inRally = false; done++;
      }
      const commands = [...(jumpPressed ? [{ payload: [1] }] : []), ...(kickPressed ? [{ payload: [2] }] : [])];
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte(ix), byte(iz), (jump ? 1 : 0) | (kick ? 2 : 0)], commands }] });
      tick++;
    }
    return out;
  } finally { game.dispose(); }
}

test('속공 연습: 낮은 토스 안내를 따르면 낮은 공격(shortJump)으로 성공한다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const result = await drill('quick', 4);
  expect(result.shortJump).toBe(4);
  expect(result.codes.success ?? 0).toBeGreaterThanOrEqual(3);
});

test('속공 연습: 기본 높은 토스는 낮은 공격으로 판정되지 않는다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const result = await drill('high', 3);
  expect(result.shortJump).toBe(0);
});

test('속공 연습: 명령으로 토스 종류를 바꾸면 동작 연습 선택은 유지된다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  const game = new TakrawGame({ RAPIER: await loadRapier(), config: TAKRAW_CONFIG });
  try {
    game.reset('training', 'scissors', 1);
    game.step({ tick: 1, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [{ payload: [22] }] }] });
    expect(game.state.training.tempo).toBe('quick'); expect(game.state.training.lesson).toBe('scissors');
    game.step({ tick: 2, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [{ payload: [8] }] }] });
    expect(game.state.training.tempo).toBe('quick'); expect(game.state.training.lesson).toBe('scissors');
  } finally { game.dispose(); }
});
