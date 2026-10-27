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
