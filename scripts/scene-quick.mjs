// 속공 연습 측정: 훈련 모드에서 토스 종류(high/quick)별로, 안내를 그대로 따르는 사람이 얼마나 성공하는지 잰다.
// 실행: RAPIER_MODULE=<진입 파일> node scripts/scene-quick.mjs  (환경: TEMPOS 쉼표목록, APEX(속공 꼭짓점 덮어쓰기), TRIALS, LESSON)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (k, d) => process.env[k] ?? d;
const TEMPOS = env('TEMPOS', 'high,quick').split(',');
const TRIALS = +env('TRIALS', 6), LESSON = env('LESSON', 'auto');
const byte = v => Math.round(Math.max(-1, Math.min(1, v)) * 127) & 255;

function attempts(tempo) {
  const config = structuredClone(TAKRAW_CONFIG); if (process.env.APEX) config.training.quick.apex = +process.env.APEX;
  const game = new TakrawGame({ RAPIER, config });
  const rows = { n: 0, short: 0, success: 0, codes: {}, feet: {} };
  try {
    game.reset('training', LESSON, 1, tempo);
    let tick = 1, wasRally = false, jumpHeld = 0, done = 0, sawShort = false;
    while (done < TRIALS && tick < 60 * 400) {
      const st = game.state, phys = game.physics, me = phys.players[st.selected[0]];
      let ix = 0, iz = 0, jump = false, jumpPressed = false, kick = false, kickPressed = false;
      if (st.phase === 'rally') {
        const guide = game.getAttackGuides()[0], tr = game.getTraining(guide);
        if (guide && me.grounded) {
          const p = me.root.translation(), dx = guide.stance.x - p.x, dz = guide.stance.z - p.z, d = Math.hypot(dx, dz);
          if (!guide.inPosition || d > 0.15) { ix = dx / (d || 1); iz = dz / (d || 1); if (d < 0.5) { ix *= d / 0.5; iz *= d / 0.5; } }
          if (guide.jumpWindow) { jumpPressed = true; jump = true; jumpHeld = guide.shortJump ? 1 : 14; sawShort ||= guide.shortJump; }
        }
        if (jumpHeld > 0 && !jumpPressed) { jump = me.grounded ? false : true; jumpHeld--; }
        if (me.jump.active && tr && tr.kickIn !== null && tr.kickIn <= 0) { kick = true; kickPressed = !game.inputs[me.id]?.kick; }
        else if (me.jump.active && game.inputs[me.id]?.kick) kick = true;
        wasRally = true;
      } else if (wasRally) { // 한 번 끝남
        const code = st.training.result?.code; rows.n++; rows.codes[code] = (rows.codes[code] || 0) + 1;
        if (code === 'success') rows.success++; if (sawShort) rows.short++; sawShort = false; done++; wasRally = false;
      }
      const commands = [...(jumpPressed ? [{ payload: [1] }] : []), ...(kickPressed ? [{ payload: [2] }] : [])];
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte(ix), byte(iz), (jump ? 1 : 0) | (kick ? 2 : 0)], commands }] });
      for (const e of game.events || []) if (e.type === 'touch' && e.playerId === st.selected[0] && /^foot/.test(e.part || '')) rows.feet[e.part] = (rows.feet[e.part] || 0) + 1;
      tick++;
    }
    return rows;
  } finally { game.dispose(); }
}

for (const tempo of TEMPOS) { const r = attempts(tempo); console.log(`토스 ${tempo.padEnd(6)} 시도 ${r.n}  낮은 세트로 판정 ${r.short}  성공 ${r.success}  결과 ${JSON.stringify(r.codes)} 발 ${JSON.stringify(r.feet)}}`); }
