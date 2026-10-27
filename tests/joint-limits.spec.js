import { test, expect } from 'playwright/test';
import { HUMAN_JOINT_LIMITS, jointAngles, excessOf } from '../src/simulation/joint-limits.js';

test('한계표는 몸통·목·어깨·손목만 담고 모든 축에 min<max다', () => {
  expect(Object.keys(HUMAN_JOINT_LIMITS).sort()).toEqual(['neck', 'shoulder', 'waist', 'wrist']);
  for (const joint of Object.values(HUMAN_JOINT_LIMITS)) for (const [min, max] of Object.values(joint)) expect(min).toBeLessThan(max);
});

test('jointAngles: 회전 없음은 0, x축 30° 회전은 x=30°', () => {
  const id = { x: 0, y: 0, z: 0, w: 1 }, half = 15 * Math.PI / 180;
  const zero = jointAngles(id, id);
  expect(Math.abs(zero.x) + Math.abs(zero.z) + Math.abs(zero.twist)).toBeLessThan(1e-9);
  const tilted = jointAngles(id, { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) });
  expect(tilted.x * 180 / Math.PI).toBeCloseTo(30, 5);
});

test('excessOf: 한계 안은 0, 밖은 넘은 양(부호 포함)', () => {
  const r = Math.PI / 180;
  expect(excessOf(10 * r, [-20, 20])).toBe(0);
  expect(excessOf(30 * r, [-20, 20])).toBeCloseTo(10 * r, 9);
  expect(excessOf(-30 * r, [-20, 20])).toBeCloseTo(-10 * r, 9);
});

test('팔꿈치는 아래팔이 앞으로만 굽는다(윗팔 기준 뒤로 꺾임 0프레임)', async () => {
  test.skip(!process.env.RAPIER_MODULE, 'RAPIER_MODULE이 없어 건너뜀');
  const { TAKRAW_CONFIG } = await import('../src/config/game.js');
  const { TakrawGame } = await import('../src/simulation/game.js');
  const loaded = await import(process.env.RAPIER_MODULE), RAPIER = loaded.default ?? loaded; await RAPIER.init();
  const game = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG }); game.reset('local');
  // 벡터 v를 쿼터니언 q로 회전
  const rotate = ({ x, y, z, w }, v) => {
    const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
    return { x: v.x + w * tx + y * tz - z * ty, y: v.y + w * ty + z * tx - x * tz, z: v.z + w * tz + x * ty - y * tx };
  };
  let behind = 0, bent = 0;
  for (let tick = 1; tick <= 1800; tick++) {
    game.step({ tick, tickRate: 60, inputs: [] });
    for (const p of game.physics.players) for (const side of ['L', 'R']) {
      const upper = p.byName['upperArm' + side].body.rotation(), fore = p.byName['forearm' + side].body.rotation();
      const down = rotate(fore, { x: 0, y: -1, z: 0 });
      const local = rotate({ x: -upper.x, y: -upper.y, z: -upper.z, w: upper.w }, down);
      if (local.z < -0.05) behind++; if (local.z > 0.3) bent++;
    }
  }
  expect(bent).toBeGreaterThan(0);
  expect(behind).toBe(0);
  game.dispose();
});
