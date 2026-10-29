// 유저 서브 측정: 우리 팀(팀0)이 서브하고 사람(공격수)이 서브 자리에서 공을 차는 흐름을 안내(받는 자리)에 맞춰 재현해 서브 결과를 센다.
// 실행: RAPIER_MODULE=<진입 파일> node scripts/scene-serve.mjs  (환경: TRIALS, PRESS(공 착지 몇 초 전에 킥 누름, 기본 0.35), VERBOSE)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (k, d) => process.env[k] ?? d;
const TRIALS = +env('TRIALS', 10), PRESS = +env('PRESS', 0.35), VERBOSE = env('VERBOSE', '');
const byte = v => Math.round(Math.max(-1, Math.min(1, v)) * 127) & 255;
const tally = {};
for (let k = 0; k < TRIALS; k++) {
  const game = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });
  try {
    game.reset('match', undefined, 4000 + k);
    game.state.serving = 0;
    let tick = 1, hold = 0, tossTicks = 0, tossPressed = false, touched = null, crossed = false, ended = null, serveStart = null;
    for (; tick < 60 * 30; tick++) {
      const st = game.state, phys = game.physics, me = phys.players[st.selected[0]];
      let ix = 0, iz = 0, kick = false, kickPressed = false;
      let jump = false, jumpPressed = false;
      const ground = process.env.GROUND === '1';
      let toss = false; tossPressed = false;
      if (st.phase === 'rally') {
        serveStart ??= st.time;
        if (st.serveToss?.stage === 'hold') { toss = tossTicks < Number(process.env.TOSS_HOLD || 0); tossPressed = tossTicks === 0; tossTicks++; }
        const guide = game.getAttackGuides()[0], p = me.root.translation();
        const by = phys.ball.translation().y, bvy = phys.ball.linvel().y;
        if (process.env.RUN && st.serveToss?.stage === 'thrown' && !touched) {
          const bp = phys.ball.translation(), dx = bp.x - p.x - Number(process.env.LEAD || 0.2), near = Math.abs(dx) < 0.3;
          ix = near ? 0 : Math.sign(dx); iz = Math.max(-1, Math.min(1, (bp.z - p.z) * 3));
          if (me.grounded && bvy < 0 && by < Number(process.env.JUMPY || 2.4) && Math.abs(bp.x - p.x) < 0.9) { jumpPressed = jump = true; hold = 1; }
        } else if (process.env.JUMPY) { if (st.serveToss?.stage === 'thrown' && !touched && me.grounded && bvy < 0 && by < Number(process.env.JUMPY)) { jumpPressed = jump = true; hold = 1; } }
        else if (ground) { if (st.serveToss?.stage === 'thrown' && !touched) { kick = true; kickPressed = !game.inputs[me.id]?.kick; } }
        if (!process.env.RUN && !process.env.JUMPY && !ground && guide && me.grounded && !touched) {
          const dx = guide.stance.x - p.x, dz = guide.stance.z - p.z, d = Math.hypot(dx, dz);
          if (!guide.inPosition || d > 0.15) { ix = dx / (d || 1); iz = dz / (d || 1); if (d < 0.5) { ix *= d / 0.5; iz *= d / 0.5; } }
          if (guide.jumpWindow) { jumpPressed = jump = true; hold = 1; }
        }
        if (!ground && hold > 0 && !jumpPressed) { jump = !me.grounded; hold--; }
        if (!ground && me.jump.active && me.jump.time >= Number(process.env.KD || TAKRAW_CONFIG.ai.toss.lowAttack.kickDelay)) { kick = true; kickPressed = !game.inputs[me.id]?.kick; }
      }
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte(ix), byte(iz), (jump ? 1 : 0) | (kick ? 2 : 0) | (toss ? 4 : 0)], commands: [...(tossPressed ? [{ payload: [8] }] : []), ...(jumpPressed ? [{ payload: [1] }] : []), ...(kickPressed ? [{ payload: [2] }] : [])] }] });
      for (const e of game.events || []) {
        if (e.type === 'touch' && e.playerId === st.selected[0] && !touched) touched = { part: e.part, t: +(st.time - serveStart).toFixed(2), x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2) };
      }
      if (st.phase === 'rally' && phys.ball.translation().x > 0.1 && touched) crossed = true;
      if (st.phase === 'point') { ended = { winner: st.pointWinner, reason: st.pointReason }; break; }
    }
    const key = !touched ? '킥 못 함' : crossed ? (ended?.winner === 0 ? '넘김·우리 득점' : ended?.winner === 1 ? `넘김·실점(${ended.reason})` : '넘김·랠리 계속') : `못 넘김·${ended?.reason || '진행'}`;
    tally[key] = (tally[key] || 0) + 1;
    if (VERBOSE) console.log(k, JSON.stringify({ touched, crossed, ended }), 'me', game.physics.players[game.state.selected[0]].root.translation().x.toFixed(1));
  } finally { game.dispose(); }
}
console.log('서브 결과', JSON.stringify(tally));
