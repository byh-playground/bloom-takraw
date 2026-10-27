import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { MatchLearning, MatchObservation, RallyObserver, TuningSpec, ReceiveTask } from '../src/learning/index.js';

// 물리 엔진 없이 쓰는 가짜 게임: 조정 값 해석에 필요한 설정과 setTuning·state만 가진다.
const settings = { groundToss: { attackApex: 3.6, contactHeight: 0.7, strokeTime: 0.12 } };
function fakeGame(serving = 0) {
  const game = { config: TAKRAW_CONFIG, physics: { settings }, state: { phase: 'ready', serving, pointWinner: -1 }, tuning: [null, null],
    setTuning(team, values) { this.tuning[team] = values; } };
  return game;
}

test('시작 정책은 규칙 AI와 같다: 조정 값이 모두 기본값', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(1) }), game = fakeGame(), spec = new TuningSpec();
  const values = MatchLearning.tuner(learner.policy, spec)(game, 0);
  expect(values).toEqual(spec.defaults(game));
});

test('서브 여부만 입력으로 쓴다', () => {
  expect(Array.from(MatchObservation.encode(fakeGame(0), 0))).toEqual([1, 1]);
  expect(Array.from(MatchObservation.encode(fakeGame(0), 1))).toEqual([1, 0]);
});

test('득점한 방향으로 평균이 움직인다(합성 보상: 첫 조정이 클수록 이김)', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(3), options: { batchSize: 8, learningRate: 0.05 } }), game = fakeGame();
  for (let i = 0; i < 400; i++) {
    learner.begin(game, 0);
    learner.end(learner.pending.action[0] > learner.policy.act(MatchObservation.encode(game, 0))[0] ? 1 : -1);
  }
  expect(learner.policy.act(MatchObservation.encode(game, 0))[0]).toBeGreaterThan(0.25);
  expect(learner.rallies).toBe(400);
});

test('조정 값은 항상 정해진 범위 안이다', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(9), options: { sigma: 1 } }), game = fakeGame(), spec = new TuningSpec();
  for (let i = 0; i < 200; i++) {
    learner.begin(game, 0);
    for (const entry of spec.entries) {
      const value = game.tuning[0][entry.name];
      expect(value).toBeGreaterThanOrEqual(entry.min - 1e-9); expect(value).toBeLessThanOrEqual(entry.max + 1e-9);
    }
    learner.end(i % 2 ? 1 : -1);
  }
});

test('저장·복원: 4비트 저장 후에도 형식이 맞고, 모양이 다르면 null', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(5) });
  learner.policy.layers[0].weights.fill(0.4);
  const decoded = MatchLearning.decode(MatchLearning.encode(learner.policy));
  expect(decoded).not.toBeNull();
  expect(decoded.layers[0].weights.length).toBe(learner.policy.layers[0].weights.length);
  expect(MatchLearning.decode('not-base64')).toBeNull();
});

test('랠리 관찰자: 시작에 조정 적용, 끝에 승패 보상, 경기 종료에 조정 해제', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(7), options: { batchSize: 100 } }), game = fakeGame(1);
  const observer = new RallyObserver({ learner, team: 1 });
  const phase = (name, winner = -1) => { game.state.phase = name; game.state.pointWinner = winner; observer.observe(game); };
  phase('ready'); expect(game.tuning[1]).toBeNull();
  phase('rally'); expect(game.tuning[1]).not.toBeNull();
  phase('point', 1);
  expect(learner.batch.map(e => e.reward)).toEqual([1]);
  phase('ready'); phase('rally'); phase('point', 0);
  expect(learner.batch.map(e => e.reward)).toEqual([1, -1]);
  phase('ready'); phase('rally'); phase('finished', 1);
  expect(learner.batch.length).toBe(3);
  expect(game.tuning[1]).toBeNull();
});
