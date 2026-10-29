// 토스 착지 오차 측정: 세터가 공격수에게 보낸 토스(state.toss 시작)의 목표점과, 공이 내려오며 높이 H(기본 2.9 m)를 지날 때 위치의 차이를 팀 좌표(앞=+x, 오른쪽=+z가 아니라 팀 진행 방향 기준 z*n)로 모은다.
// 실행: RAPIER_MODULE=<진입 파일> node scripts/scene-toss.mjs  (환경: MATCHES, SEC, H, OVERRIDE)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (k, d) => process.env[k] ?? d;
const MATCHES = +env('MATCHES', 6), SEC = +env('SEC', 100), H = +env('H', 2.9);
const CONFIG = structuredClone(TAKRAW_CONFIG);
if (process.env.OVERRIDE) { const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return a; }; merge(CONFIG, JSON.parse(process.env.OVERRIDE)); }
const rows = [];
for (let m = 0; m < MATCHES; m++) {
  const game = new TakrawGame({ RAPIER, config: CONFIG });
  game.reset('match', undefined, 500 + m);
  let pending = null, prevY = 0;
  for (let tick = 1; tick < SEC * 60 && game.state.phase !== 'finished'; tick++) {
    game.step({ tick, tickRate: 60, inputs: [] });
    const st = game.state, b = game.physics.ball.translation();
    if (st.toss?.pending !== undefined && st.toss && !pending?.id !== undefined) {
      const key = `${st.toss.from}:${st.toss.started}`;
      if (!pending || pending.key !== key) {
        const target = game.inputs[st.toss.from]?.tossTarget, team = st.toss.team, n = team === 0 ? 1 : -1, to = game.physics.players[st.toss.to];
        if (target && to?.role === 'attacker') { const p = to.root.translation(); const f = game.physics.players[st.toss.from].root.translation(); pending = { key, target, team, n, attacker: { x: p.x, z: p.z }, lateral: (target.z - f.z) * n, forward: (target.x - f.x) * n, done: false }; prevY = b.y; }
      }
    }
    if (pending && !pending.done) {
      if (prevY > H && b.y <= H && b.y < prevY) { // 내려오며 H를 지남
        const n = pending.n, to = game.physics.players[st.toss?.to ?? 2]?.root.translation() ?? pending.attacker;
        rows.push({ lateral: pending.lateral, forward: pending.forward, team: pending.team, dx: (b.x - pending.target.x) * n, dz: (b.z - pending.target.z) * n, fromAttackerX: (b.x - pending.attacker.x) * n, fromAttackerZ: (b.z - pending.attacker.z) * n });
        pending.done = true;
      }
      prevY = b.y;
      if (st.phase !== 'rally') pending = null;
    }
  }
  game.dispose();
}
const stat = key => { const v = rows.map(r => r[key]), mean = v.reduce((a, b) => a + b, 0) / v.length; return { mean: +mean.toFixed(2), sd: +Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length).toFixed(2) }; };
console.log('토스', rows.length, '회  목표 대비 dx(앞+)', JSON.stringify(stat('dx')), 'dz(팀 기준 +z)', JSON.stringify(stat('dz')), '| 공격수 위치 대비 x', JSON.stringify(stat('fromAttackerX')), 'z', JSON.stringify(stat('fromAttackerZ')));
for (const [name, pick] of [['세터보다 오른쪽 1 m 이상', r => r.lateral > 1], ['세터와 비슷한 줄', r => Math.abs(r.lateral) <= 1], ['세터보다 왼쪽 1 m 이상', r => r.lateral < -1]]) {
  const sub = rows.filter(pick); if (!sub.length) continue; const med = key => sub.map(r => r[key]).sort((a, b) => a - b)[Math.floor((sub.length - 1) / 2)];
  console.log(name.padEnd(18), String(sub.length).padStart(3), '회  dx 중앙값', med('dx').toFixed(2), ' dz 중앙값', med('dz').toFixed(2));
}
const q = (key, f) => { const v = rows.map(r => r[key]).sort((a, b) => a - b); return +v[Math.floor((v.length - 1) * f)].toFixed(2); };
console.log('목표 대비 중앙값(25%~75%)  dx', q('dx', .5), `(${q('dx', .25)}~${q('dx', .75)})`, ' dz', q('dz', .5), `(${q('dz', .25)}~${q('dz', .75)})`);
console.log('공격수 대비 중앙값  x', q('fromAttackerX', .5), ' z', q('fromAttackerZ', .5), '(기준점은 x +0.7, z -0.1)');
const e = rows.map(x => Math.hypot(x.dx, x.dz)).sort((a, b) => a - b); console.log('목표와의 거리 중앙값', e[Math.floor(e.length / 2)].toFixed(2), '75%', e[Math.floor(e.length * .75)].toFixed(2));
const r = rows.map(x => Math.hypot(x.fromAttackerX, x.fromAttackerZ)).sort((a, b) => a - b);
console.log('공격수 대비 거리 중앙값', r[Math.floor(r.length / 2)]?.toFixed(2), '90%', r[Math.floor(r.length * 0.9)]?.toFixed(2));
