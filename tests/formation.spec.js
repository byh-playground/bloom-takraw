import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { AiFormation } from '../src/simulation/ai-formation.js';

const options = TAKRAW_CONFIG.ai.fill, court = TAKRAW_CONFIG.court;
const formation = new AiFormation(options, { speed: 3.15, court });
// 자기 코트 방향 좌표(x가 음수): 기본 자리
const home = role => ({ x: TAKRAW_CONFIG.formation[role].x, z: TAKRAW_CONFIG.formation[role].z });
const allies = roles => roles.map((role, index) => ({ id: index + 10, role, home: home(role) }));

test('빈자리 채우기: 사람이 제자리에 있으면 동료도 기본 자리에 남는다', () => {
  for (const human of ['receiver', 'setter', 'attacker']) {
    const rest = ['receiver', 'setter', 'attacker'].filter(role => role !== human);
    const plan = formation.plan(home(human), allies(rest), home(human));
    for (const ally of allies(rest)) expect(plan.get(ally.id)).toEqual(ally.home);
  }
});

test('빈자리 채우기: 사람이 한쪽 끝으로 가면 동료가 그쪽으로 옮기고, 같은 입력엔 같은 결과가 나온다', () => {
  const rest = allies(['receiver', 'setter']), spot = { x: -1.0, z: -2.0 };
  const first = formation.plan(spot, rest, home('attacker')), second = formation.plan(spot, rest, home('attacker'));
  expect([...first]).toEqual([...second]);
  const moved = rest.some(ally => Math.hypot(first.get(ally.id).x - ally.home.x, first.get(ally.id).z - ally.home.z) > 0.3);
  expect(moved).toBeTruthy();
  const cost = positions => formation.cost(positions);
  const before = cost([[spot.x, spot.z], ...rest.map(ally => [ally.home.x, ally.home.z])]);
  const after = cost([[spot.x, spot.z], ...rest.map(ally => [first.get(ally.id).x, first.get(ally.id).z])]);
  expect(after).toBeLessThan(before);
});

test('빈자리 채우기: 동료는 역할별 범위와 코트 안에 머문다', () => {
  const rest = allies(['receiver', 'setter']);
  for (const spot of [{ x: -1.0, z: 2.0 }, { x: -5.2, z: -2.0 }, { x: -3.2, z: 0 }, { x: -1.0, z: -2.0 }]) {
    const plan = formation.plan(spot, rest, home('attacker'));
    for (const ally of rest) {
      const point = plan.get(ally.id), box = options.bounds[ally.role].x;
      expect(point.x).toBeGreaterThanOrEqual(box[0] - 1e-9); expect(point.x).toBeLessThanOrEqual(box[1] + 1e-9);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(court.halfWidth - 0.25 + 1e-9);
    }
  }
});
