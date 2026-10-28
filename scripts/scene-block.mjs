// 블로킹 측정: 상대가 스파이크한 공(네트 위 약 1.7 m 통과, 속도 약 10 m/s)이 오는 동안 사람이 네트 앞에서 점프+발차기를 누르는 시각을 바꿔 가며
// 공을 되받아치는 비율을 잰다. 성공 = 사람 발/다리 접촉 뒤 1.5초 안에 공이 상대 쪽(x>0.3)에 도달.
// 실행: RAPIER_MODULE=<진입 파일> node scripts/scene-block.mjs  (환경: TRIALS, DELAYS 쉼표목록(초), NETX(내 x), FLIGHT(공 비행 시간), OVERRIDE)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (k, d) => process.env[k] ?? d;
const TRIALS = +env('TRIALS', 8), NETX = +env('NETX', -0.6), FLIGHT = +env('FLIGHT', 0.35), TRACE = env('TRACE', '');
const DELAYS = env('DELAYS', '-0.15,-0.05,0.05,0.15,0.25').split(',').map(Number);
const CONFIG = structuredClone(TAKRAW_CONFIG);
if (process.env.OVERRIDE) { const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return a; }; merge(CONFIG, JSON.parse(process.env.OVERRIDE)); }
const byte = v => Math.round(Math.max(-1, Math.min(1, v)) * 127) & 255;
const g = 9.81;

function trial(delay, k) {
  const game = new TakrawGame({ RAPIER, config: CONFIG });
  try {
    game.reset('match', undefined, 200 + k);
    let tick = 1;
    for (; tick < 60 * 20 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
    const st = game.state, phys = game.physics, me = phys.players[st.selected[0]];
    // 사람을 네트 앞 NETX, 공 z 근처에 세운다.
    const z0 = ((k % 5) - 2) * 0.5;
    st.possession = 1; st.touches = 1; st.lastTouch = 3; st.serving = 1;
    for (let i = 0; i < 150 && st.phase === 'rally'; i++, tick++) { // 공을 상대 쪽 허공에 붙잡고 사람을 자리로 걸어가게 한다.
      phys.resetBall({ x: 4, y: 7, z: 0 }, { x: 0, y: 0, z: 0 });
      const h = me.root.translation();
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte((NETX - h.x) * 3), byte((z0 - h.z) * 3), 0], commands: [] }] });
    }
    // 공: 상대 쪽 (1.5, 3.2)에서 내 쪽 (NETX-0.6, 0.3)로 FLIGHT초에 내려꽂힌다.
    const S = { x: 1.5, y: 3.2, z: z0 + 0.4 }, T = { x: NETX - 0.6, y: 0.3, z: z0 };
    const v = { x: (T.x - S.x) / FLIGHT, y: (T.y - S.y + 0.5 * g * FLIGHT * FLIGHT) / FLIGHT, z: (T.z - S.z) / FLIGHT };
    phys.resetBall(S, v);
    st.possession = 1; st.touches = 2; st.lastTouch = 3; st.serving = 1; st.toss = null; st.play = null; game.aiDirty = true;
    const t0 = st.time; let touched = null, maxX = -9, firstAfter = null;
    for (let i = 0; i < 60 * 2.2; i++, tick++) {
      const t = st.time - t0, here = me.root.translation();
      const press = t >= delay + 0.0 && t < delay + 0.6; // 점프 입력: delay 시각에 눌러 0.6초 유지
      const ix = Math.max(-1, Math.min(1, (NETX - here.x) * 3)), iz = Math.max(-1, Math.min(1, (z0 - here.z) * 3));
      const first = press && t - delay < 1 / 60 + 1e-6;
      const commands = first ? [{ payload: [1] }, { payload: [2] }] : [];
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte(ix), byte(iz), press ? 3 : 0], commands }] });
      for (const e of game.events || []) {
        if (e.type === 'touch' && e.team === 0 && e.playerId === st.selected[0] && !touched) { touched = { t: +(st.time - t0).toFixed(2), part: e.part, y: +e.position?.y?.toFixed(2), x: +e.position?.x?.toFixed(2) }; }
        if (TRACE && (e.type === 'touch' || e.type === 'net' || e.type === 'ground')) console.log('  ev', (st.time - t0).toFixed(2), e.type, e.team, e.playerId, e.part);
      }
      const b = phys.ball.translation();
      if (TRACE && (touched ? true : i % 6 === 0)) console.log('   t', t.toFixed(2), 'ball', b.x.toFixed(2), b.y.toFixed(2), b.z.toFixed(2), 'me', here.x.toFixed(2), here.y.toFixed(2), here.z.toFixed(2), me.state, st.phase);
      if (touched) maxX = Math.max(maxX, b.x);
      if (touched && firstAfter === null) { const bv = phys.ball.linvel(); firstAfter = [bv.x, bv.y, bv.z].map(v => +v.toFixed(1)).join(','); if (process.env.DETAIL) console.log('   접촉 t', touched.t, touched.part, 'y', touched.y, 'x', touched.x, '공 속도', firstAfter); }
      if (st.phase !== 'rally') { if (process.env.DETAIL) console.log('   끝', (st.time - t0).toFixed(2), st.lastMessage, 'maxX', maxX.toFixed(2)); break; }
    }
    const foot = touched && /^(foot|lowerLeg)/.test(touched.part || '');
    return { touched: !!touched, foot: !!foot, blocked: !!touched && maxX > 0.3, part: touched?.part, vxAfter: firstAfter, net: false };
  } finally { game.dispose(); }
}

const out = [];
for (const d of DELAYS) {
  let touch = 0, foot = 0, blocked = 0; const parts = {};
  for (let k = 0; k < TRIALS; k++) { const r = trial(d, k); if (r.touched) touch++; if (r.foot) foot++; if (r.blocked) blocked++; if (r.part) parts[r.part] = (parts[r.part] || 0) + 1; }
  out.push({ 점프시각: d, 접촉: touch, 발접촉: foot, 차단: blocked, 시도: TRIALS, 부위: parts });
  console.log(JSON.stringify(out.at(-1)));
}
const total = out.reduce((a, r) => a + r.차단, 0), n = out.reduce((a, r) => a + r.시도, 0);
console.log(`합계 차단 ${total}/${n} (${(total / n * 100).toFixed(0)}%)`);
