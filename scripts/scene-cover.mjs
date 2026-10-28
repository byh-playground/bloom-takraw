// 빈자리 측정: 사람이 자기 자리를 떠난 뒤(공이 상대 쪽에 있을 때) 우리 코트 전체를 세 선수가 얼마나 빨리 덮는지 잰다.
// 덮는 시간 = 격자 각 점에서 가장 가까운 선수가 이동속도로 닿는 시간(초). 미커버 = 그 시간이 LIMIT초를 넘는 점의 비율.
// 실행: RAPIER_MODULE=<rapier3d-compat 진입 파일> node scripts/scene-cover.mjs   (환경: LIMIT 기본 0.9, SETTLE 기본 5초, OVERRIDE 설정 덮어쓰기 JSON)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (name, fallback) => process.env[name] ?? fallback;
const LIMIT = +env('LIMIT', 0.9), SETTLE = +env('SETTLE', 5), SPEED = TAKRAW_CONFIG.physics?.movementSpeed ?? 3.15;
const CONFIG = structuredClone(TAKRAW_CONFIG);
if (process.env.OVERRIDE) { const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v; return a; }; merge(CONFIG, JSON.parse(process.env.OVERRIDE)); }
const byte = value => Math.round(Math.max(-1, Math.min(1, value)) * 127) & 255;
// 사람이 가는 자리: 앞쪽(네트 근처) 양옆, 가운데, 뒤쪽 양옆, 그대로 둠.
const SPOTS = { 그대로: null, 앞왼쪽: { x: -1.0, z: -2.0 }, 앞오른쪽: { x: -1.0, z: 2.0 }, 가운데: { x: -3.2, z: 0 }, 뒤왼쪽: { x: -5.2, z: -2.0 }, 뒤오른쪽: { x: -5.2, z: 2.0 } };

function coverage(positions) {
  const times = [];
  for (let x = -5.8; x <= -0.79; x += 0.5) for (let z = -2.9; z <= 2.91; z += 0.5) {
    times.push(Math.min(...positions.map(p => Math.max(0, Math.hypot(p.x - x, p.z - z) - 0.3) / SPEED)) + 0.1);
  }
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { uncovered: times.filter(t => t > LIMIT).length / times.length, mean, worst: Math.max(...times) };
}

const rows = {};
for (const [name, spot] of Object.entries(SPOTS)) {
  const game = new TakrawGame({ RAPIER, config: CONFIG });
  try {
    game.reset('match', undefined, 31);
    let tick = 1;
    for (; tick < 60 * 20 && game.state.phase !== 'rally'; tick++) game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [0, 0, 0], commands: [] }] });
    const state = game.state, physics = game.physics, id = state.selected[0];
    state.possession = 1; state.touches = 1; state.lastTouch = 3; state.serving = 1;
    for (let i = 0; i < SETTLE * 60 && state.phase === 'rally'; i++, tick++) {
      physics.resetBall({ x: 3.5, y: 6, z: 0 }, { x: 0, y: 0, z: 0 }); // 공을 상대 쪽 허공에 붙잡아 두어 아무도 받으러 가지 않게 한다.
      const here = physics.players[id].root.translation();
      let ix = 0, iz = 0;
      if (spot) { const dx = spot.x - here.x, dz = spot.z - here.z, len = Math.hypot(dx, dz); if (len > 0.1) { ix = dx / len; iz = dz / len; } }
      game.step({ tick, tickRate: 60, inputs: [{ playerId: 'h', input: [byte(ix), byte(iz), 0], commands: [] }] });
    }
    const positions = physics.players.filter(p => p.team === 0).map(p => p.root.translation());
    rows[name] = { ...coverage(positions), human: physics.players[id].root.translation().x.toFixed(1) + ',' + physics.players[id].root.translation().z.toFixed(1),
      allies: physics.players.filter(p => p.team === 0 && p.id !== id).map(p => `${p.role}(${p.root.translation().x.toFixed(1)},${p.root.translation().z.toFixed(1)})`).join(' ') };
  } finally { game.dispose(); }
}
const mean = key => Object.values(rows).reduce((a, r) => a + r[key], 0) / Object.keys(rows).length;
for (const [name, r] of Object.entries(rows)) console.log(`${name.padEnd(6)} 미커버 ${(r.uncovered * 100).toFixed(0).padStart(3)}%  평균 ${r.mean.toFixed(2)}초  최대 ${r.worst.toFixed(2)}초  사람 (${r.human})  동료 ${r.allies}`);
console.log(`합계    미커버 평균 ${(mean('uncovered') * 100).toFixed(1)}%  평균 시간 ${mean('mean').toFixed(3)}초  (LIMIT ${LIMIT}초)`);
