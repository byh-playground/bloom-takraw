// 받기 장면 측정: 상대 코트에서 네트를 넘어 오는 공을 사람(팀0 선택 선수)이 이동+발차기로 받는 성공률을 거리별로 잰다.
// 성공 = 발·종아리로 공을 쳐서 1.2초 안에 최고 높이 1.8m 이상, 네트를 넘지 않음.
// 실행: RAPIER_MODULE=<rapier3d-compat 진입 파일> POLICY=toBall|guide|ai TRIALS=12 DISTS=1,2,3,4 PRESS=0.65 node scripts/scene-receive.mjs
// 환경: POLICY(toBall: 착지점으로 달려감, guide: 받는 자리 표식을 따름, ai: 사람 없이 AI), PRESS(착지 몇 초 전에 발차기를 누름), SPD(공격 공 수평 속도 m/s), OVERRIDE(설정 덮어쓰기 JSON), RT(반응 시간 초)
const { TAKRAW_CONFIG } = await import('../src/config/game.js');
const { TakrawGame } = await import('../src/simulation/game.js');
const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat'); const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (k, d) => process.env[k] ?? d;
const TRIALS = +env('TRIALS', 8), PRESS = +env('PRESS', 0.6), TFLIGHT = +env('TFLIGHT', 0.55), DISTS = env('DISTS', '0.5,1,1.5,2,2.5,3').split(',').map(Number);
const SELECT = env('SELECT', ''); // 선수 번호 지정(0~2)
const byte = v => Math.round(Math.max(-1, Math.min(1, v)) * 127) & 255;
const g = 9.81;
const CFG = structuredClone(TAKRAW_CONFIG);
if (process.env.OVERRIDE) { const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return a; }; merge(CFG, JSON.parse(process.env.OVERRIDE)); }
const rows = [], cats = {};

let TF = 0;
function trial(dist, k, game0) {
  const game = new TakrawGame({ RAPIER, config: CFG });
  try {
    game.reset('match', undefined, 100 + k);
    let tick = 1;
    for (; tick < 60 * 20 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
    const st = game.state, phys = game.physics;
    if (SELECT !== '') st.selected[0] = +SELECT;
    const me = phys.players[st.selected[0]], mp = me.root.translation();
    // 착지점: 내 위치에서 dist만큼 떨어진 곳(네트 반대/옆/앞 방향을 시도마다 돌려 가며). 내 코트 안.
    const angle = (k / TRIALS) * Math.PI * 2;
    let Lx = mp.x + Math.cos(angle) * dist, Lz = mp.z + Math.sin(angle) * dist;
    Lx = Math.max(-5.6, Math.min(-0.9, Lx)); Lz = Math.max(-2.8, Math.min(2.8, Lz));
    const L = { x: Lx, y: 0.2, z: Lz };
    const S = { x: 0.8, y: 3.0, z: Lz + (k % 2 ? 1.0 : -1.0) };
    let T = Math.max(0.6, Math.hypot(L.x - S.x, L.z - S.z) / +env('SPD', 11)), v;
    for (let guard = 0; guard < 20; guard++) {
      v = { x: (L.x - S.x) / T, y: (L.y - S.y + 0.5 * g * T * T) / T, z: (L.z - S.z) / T };
      const tc = (0 - S.x) / v.x, yc = S.y + v.y * tc - 0.5 * g * tc * tc;
      if (yc >= 1.85) break; T += 0.05;
    }
    TF = T;
    phys.resetBall(S, v);
    st.possession = 1; st.touches = 1; st.lastTouch = 3; st.serving = 1; st.toss = null; st.play = null;
    game.aiDirty = true;
    const t0 = st.time; let result = { touch: false, touchT: null, landed: false, after: null };
    let peak = 0, maxX = -9, groundAfter = false;
    for (let i = 0; i < 60 * 3; i++, tick++) {
      const mpNow = me.root.translation();
      const remaining = TF - (st.time - t0);
      let ix = 0, iz = 0, kick = false, kickPressed = false;
      const reacted = st.time - t0 >= +env('RT', 0.2);
      if (reacted && remaining > PRESS) { // 아직 발차기는 누르지 않고 받을 자리로 이동만 한다.
        const dx = L.x - mpNow.x, dz = L.z - mpNow.z, len = Math.hypot(dx, dz) || 1; ix = dx / len; iz = dz / len;
      }
      if (remaining <= PRESS) {
        const guide = process.env.POLICY === 'guide' ? game.getReceiveGuides()[0] : null;
        const tx = guide?.human ? guide.stance.x : L.x, tz = guide?.human ? guide.stance.z : L.z;
        const dx = tx - mpNow.x, dz = tz - mpNow.z, len = Math.hypot(dx, dz) || 1;
        ix = dx / len; iz = dz / len; kick = true; kickPressed = remaining > PRESS - 1 / 60 - 1e-6;
        if (len < 0.15) { ix *= len / 0.15; iz *= len / 0.15; }
      }
      if (process.env.TRACE2 && i % 6 === 0) { const b = phys.ball.translation(), bv = phys.ball.linvel(), gd = game.getReceiveGuides()[0], d0 = st.defense[0]; console.log('   t', (st.time - t0).toFixed(2), 'me', mpNow.x.toFixed(2), mpNow.z.toFixed(2), me.state, 'rec', me.receive?.mode, me.receive?.phase, 'ball', b.x.toFixed(2), b.y.toFixed(2), b.z.toFixed(2), 'v', bv.x.toFixed(1), bv.y.toFixed(1), 'guide', gd && (gd.playerId + ' ' + gd.human + ' ' + gd.mode + ' ' + gd.reachable), 'L', L.x.toFixed(2), L.z.toFixed(2)); }
      const commands = kickPressed ? [{ payload: [2] }] : [];
      game.step({ tick, tickRate: 60, inputs: process.env.POLICY === 'ai' ? [] : [{ playerId: 'h', input: [byte(ix), byte(iz), kick ? 2 : 0], commands }] });
      for (const e of game.events || []) {
        if (process.env.TRACE && (e.type === 'touch' || e.type === 'ground')) console.log('  ev', (st.time - t0).toFixed(2), e.type, e.playerId, e.part, 'sel', st.selected[0]);
        if (process.env.TRACE3 && e.type === 'touch' && e.team === 0 && !result.touch) { const bv = phys.ball.linvel(); console.log('  touch', (st.time - t0).toFixed(2), e.part, 'pos', e.position && [e.position.x, e.position.y, e.position.z].map(v => v.toFixed(2)).join(','), 'ballvAfter', bv.x.toFixed(1), bv.y.toFixed(1), bv.z.toFixed(1), 'mode', me.receive?.mode, 'footV', e.footVelocity && Math.hypot(e.footVelocity.x, e.footVelocity.y, e.footVelocity.z).toFixed(1), 'speedIn', e.speed ?? e.relativeSpeed); }
        if (e.type === 'touch' && (process.env.POLICY === 'ai' ? e.team === 0 : e.playerId === st.selected[0]) && !result.touch) { result.touch = true; result.touchT = st.time - t0; result.part = e.part; }
        if (e.type === 'ground' && !result.touch) result.landed = true;
        if (e.type === 'ground' && result.touch && st.time - t0 - result.touchT < 1.2) groundAfter = true;
      }
      const b2 = phys.ball.translation();
      if (result.touch && st.time - t0 - result.touchT < 1.2) { peak = Math.max(peak, b2.y); maxX = Math.max(maxX, b2.x); }
      if (result.landed || (result.touch && st.time - t0 - result.touchT >= 1.2) || st.phase !== 'rally') break;
    }
    result.ok = result.touch && /^(foot|lowerLeg)/.test(result.part || '') && peak >= 1.8 && maxX < 0.3;
    result.after = { peak: +peak.toFixed(2), maxX: +maxX.toFixed(2), groundAfter, part: result.part, dt: result.touchT && +result.touchT.toFixed(2) }; if (process.env.DEBUG) console.log(dist, k, JSON.stringify(result));
    return { ...result, ownTouch: st.possession === 0, touches: st.touches, phase: st.phase, msg: st.lastMessage };
  } finally { game.dispose(); }
}

for (const d of DISTS) {
  let touches = 0, good = 0, n = 0, saveMsgs = {};
  for (let k = 0; k < TRIALS; k++) {
    const r = trial(d, k);
    n++; if (r.touch) touches++;
    const cat = !r.touch ? 'no-touch' : !/^(foot|lowerLeg)/.test(r.part || '') ? 'body:' + (r.part || '').replace(/[LR]$/, '') : r.after.peak < 1.8 ? 'foot-weak' : r.after.maxX >= 0.3 ? 'foot-over-net' : 'ok';
    cats[cat] = (cats[cat] || 0) + 1;
    if (r.ok) good++;
    saveMsgs[r.msg] = (saveMsgs[r.msg] || 0) + 1;
  }
  rows.push({ dist: d, touchRate: +(touches / n).toFixed(2), goodRate: +(good / n).toFixed(2), n });
}
console.log(JSON.stringify({ PRESS, TFLIGHT, rows }));
console.log(JSON.stringify(cats));
