// 세트 반복 측정: 공격수(사람 선수)를 제자리에 세워 두고, 세터가 받는 공을 같은 조건으로 반복해 내려 주어 세트가 공격수 기준 어디에 오는지 잰다.
// 좌표는 팀0 기준(앞=+x, 오른쪽=+z). 공이 높이 H(기본 3.3 m)를 내려가며 지나는 지점의 공격수 대비 위치, 공격수 접촉 가능 반경(R, 기본 0.8 m) 안 비율을 출력한다.
// 실행: RAPIER_MODULE=<진입 파일> node scripts/scene-set-repeat.mjs  (환경: TRIALS, H, R, FEED(세터 위 떨어뜨릴 높이), OVERRIDE)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (k, d) => process.env[k] ?? d;
const TRIALS = +env('TRIALS', 30), H = +env('H', 3.3), R = +env('R', 0.8), FEED = +env('FEED', 2.4);
const CONFIG = structuredClone(TAKRAW_CONFIG);
if (process.env.OVERRIDE) { const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return a; }; merge(CONFIG, JSON.parse(process.env.OVERRIDE)); }
const rows = [];
for (let k = 0; k < TRIALS; k++) {
  const game = new TakrawGame({ RAPIER, config: CONFIG });
  try {
    game.reset('match', undefined, 3000 + k);
    let tick = 1;
    const idle = [{ playerId: 'h', input: [0, 0, 0], commands: [] }];
    for (; tick < 60 * 20 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: idle });
    const st = game.state, phys = game.physics, setter = phys.players[1], human = phys.players[st.selected[0]];
    const s = setter.root.translation();
    // 리시브가 끝난 뒤 세터에게 공이 떨어지는 상황: 우리 팀 첫 터치를 받은 것으로 하고, 세터 앞 위에서 공을 놓는다.
    phys.resetBall({ x: s.x + 0.8, y: FEED, z: s.z - 0.1 }, { x: 0, y: 1.5, z: 0 });
    st.possession = 0; st.touches = 1; st.lastTouch = 0; st.serving = 0; st.toss = null; st.play = null; game.aiDirty = true;
    const home = human.root.translation(), at = { x: home.x, z: home.z };
    let prevY = 9, got = false, sawSet = false;
    for (let i = 0; i < 60 * 6 && st.phase === 'rally' && !got; i++, tick++) {
      game.step({ tick, tickRate: 60, inputs: idle });
      if (st.toss?.to === human.id) sawSet = true;
      const b = phys.ball.translation(), h = human.root.translation();
      if (sawSet && prevY > H && b.y <= H) { rows.push({ x: b.x - h.x, z: b.z - h.z, moved: Math.hypot(h.x - at.x, h.z - at.z) }); got = true; }
      prevY = b.y;
    }
    if (!got) rows.push({ miss: true });
  } finally { game.dispose(); }
}
const ok = rows.filter(r => !r.miss), q = (key, f) => { const v = ok.map(r => r[key]).sort((a, b) => a - b); return +v[Math.floor((v.length - 1) * f)].toFixed(2); };
const mean = key => +(ok.reduce((a, r) => a + r[key], 0) / ok.length).toFixed(2);
console.log(`세트 ${ok.length}/${rows.length}회  공격수 대비 앞(+x) 평균 ${mean('x')} 중앙 ${q('x', .5)} (25%~75% ${q('x', .25)}~${q('x', .75)})  오른쪽(+z) 평균 ${mean('z')} 중앙 ${q('z', .5)} (25%~75% ${q('z', .25)}~${q('z', .75)})`);
const right = ok.filter(r => r.z > 0.3).length, left = ok.filter(r => r.z < -0.3).length, inR = ok.filter(r => Math.hypot(r.x - 0.7, r.z + 0.1) <= R).length;
console.log(`오른쪽(+z 0.3 m 초과) ${right}  왼쪽(-0.3 m 미만) ${left}  기준점(앞 0.7, 옆 -0.1) 반경 ${R} m 안 ${inR}/${ok.length}`);
