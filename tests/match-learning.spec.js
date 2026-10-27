import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';
import { MatchLearning, MatchObservation, RallyObserver, TuningSpec, MATCH_TUNING, ReceiveTask } from '../src/learning/index.js';

// 물리 엔진이 필요한 시험은 RAPIER_MODULE(rapier3d-compat 진입 파일 경로)이 있을 때만 돈다.
const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

/** 공을 team의 코트(깊이 depth m, 좌우 z)에 떨어지도록 둔 랠리 중 게임. */
async function rallyGame(RAPIER, { team = 0, x = -3, z = 1 } = {}) {
  const game = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });
  game.reset('match'); game.state.phase = 'rally';
  const n = team === 0 ? 1 : -1;
  game.physics.resetBall({ x: x * n, y: 3, z: z * n }, { x: 0, y: 0, z: 0 });
  return game;
}
const nearestOf = (game, team) => game.physics.players.find(p => p.team === team).id;

test.describe('경기 학습', () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');

  test('입력: 이름 수와 길이가 같고, 팀이 달라도 같은 상황이면 같은 값(방향 정규화)', async () => {
    const RAPIER = await loadRapier(), a = await rallyGame(RAPIER, { team: 0 }), b = await rallyGame(RAPIER, { team: 1 });
    try {
      const va = MatchObservation.encode(a, 0, nearestOf(a, 0)), vb = MatchObservation.encode(b, 1, nearestOf(b, 1));
      expect(va.length).toBe(MatchObservation.NAMES.length);
      expect(Array.from(va).every(Number.isFinite)).toBe(true);
      const index = name => MatchObservation.NAMES.indexOf(name);
      for (const name of ['낙하 깊이', '낙하 좌우', '도착 시간', '공 높이']) expect(va[index(name)]).toBeCloseTo(vb[index(name)], 6);
      expect(va[index('낙하 깊이')]).toBeGreaterThan(0); // 우리 코트 쪽이면 +
    } finally { a.dispose(); b.dispose(); }
  });

  test('시작 정책은 규칙 AI와 같다: 조정 값이 모두 기본값', async () => {
    const RAPIER = await loadRapier(), game = await rallyGame(RAPIER), spec = new TuningSpec(MATCH_TUNING);
    try {
      const learner = new MatchLearning({ random: ReceiveTask.mulberry32(1) });
      expect(MatchLearning.tuner(learner.policy, 0, spec)(game, nearestOf(game, 0))).toEqual(spec.defaults(game));
    } finally { game.dispose(); }
  });

  test('득점한 방향으로 평균이 움직인다(합성 보상: 낙하 깊이가 클 때 첫 조정이 클수록 이김)', async () => {
    const RAPIER = await loadRapier(), game = await rallyGame(RAPIER);
    try {
      const learner = new MatchLearning({ random: ReceiveTask.mulberry32(3), options: { batchSize: 16, learningRate: 0.05 } });
      const id = nearestOf(game, 0), obs = () => MatchObservation.encode(game, 0, id, learner.habit);
      for (let i = 0; i < 600; i++) {
        learner.decide(game, 0, id);
        const sample = learner.pending[0];
        learner.end(sample.action[0] > sample.mean[0] ? 1 : -1);
      }
      expect(learner.policy.act(obs())[0]).toBeGreaterThan(0.25);
      expect(learner.rallies).toBe(600);
    } finally { game.dispose(); }
  });

  test('조정 값은 항상 정해진 범위 안이다', async () => {
    const RAPIER = await loadRapier(), game = await rallyGame(RAPIER), spec = new TuningSpec(MATCH_TUNING);
    try {
      const learner = new MatchLearning({ random: ReceiveTask.mulberry32(9), options: { sigma: 1 } });
      for (let i = 0; i < 200; i++) {
        const values = learner.decide(game, 0, nearestOf(game, 0));
        for (const entry of spec.entries) {
          expect(values[entry.name]).toBeGreaterThanOrEqual(entry.min - 1e-9); expect(values[entry.name]).toBeLessThanOrEqual(entry.max + 1e-9);
        }
        learner.end(1);
      }
    } finally { game.dispose(); }
  });

  test('실제 경기: 접촉마다 결정이 쌓이고 랠리가 끝나면 보상이 붙는다', async () => {
    const RAPIER = await loadRapier(), game = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });
    try {
      game.reset('match', undefined, 11);
      const learner = new MatchLearning({ random: ReceiveTask.mulberry32(2), options: { batchSize: 1000 } }), observer = new RallyObserver({ learner, team: 0 });
      for (let tick = 1; tick < 60 * 60 && learner.rallies < 3; tick++) { game.step({ tick, tickRate: 60, inputs: [] }); observer.observe(game); }
      expect(learner.rallies).toBeGreaterThanOrEqual(1);
      expect(learner.decisions).toBeGreaterThan(learner.rallies); // 랠리당 결정이 여러 개
      const rewards = learner.batch.map(entry => entry.reward);
      expect(rewards.every(reward => Math.abs(reward) <= 1 + 2 * learner.options.auxWeight + 1e-9)).toBe(true); // 랠리 ±1 + 접촉 보상
      expect(rewards.some(reward => Math.abs(Math.abs(reward) - 1) > 1e-9)).toBe(true); // 접촉 보상이 실제로 붙은 결정이 있다
      expect(game.tunerEveryContact[0]).toBe(true);
    } finally { game.dispose(); }
  });
});

test('저장·복원: 4비트 저장 후에도 형식이 맞고, 모양이 다르면 null', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(5) });
  learner.policy.layers[0].weights.fill(0.4);
  const decoded = MatchLearning.decode(MatchLearning.encode(learner.policy));
  expect(decoded).not.toBeNull();
  expect(decoded.layers[0].weights.length).toBe(learner.policy.layers[0].weights.length);
  expect(MatchLearning.decode('not-base64')).toBeNull();
});

test('랠리 관찰자: 첫 관찰에 조정기를 걸고, 랠리 끝에 승패 보상, 경기 종료에 조정기를 뗀다', () => {
  const learner = new MatchLearning({ random: ReceiveTask.mulberry32(7), options: { batchSize: 100 } });
  const tuners = [null, null], game = { state: { phase: 'ready', pointWinner: -1 }, setTuner(team, tuner) { tuners[team] = tuner; } };
  const observer = new RallyObserver({ learner, team: 1 });
  const phase = (name, winner = -1) => { game.state.phase = name; game.state.pointWinner = winner; observer.observe(game); };
  const decide = () => learner.pending.push({ obs: new Float64Array(MatchObservation.size), mean: new Float64Array(15), action: new Float64Array(15), expectOwn: false, aux: 0, at: 'x' });
  phase('ready'); expect(typeof tuners[1]).toBe('function');
  phase('rally'); decide(); decide(); phase('point', 1);
  expect(learner.batch.map(e => e.reward)).toEqual([1, 1]);
  phase('ready'); phase('rally'); decide(); phase('point', 0);
  expect(learner.batch.map(e => e.reward)).toEqual([1, 1, -1]);
  phase('ready'); phase('rally'); phase('finished', 1); // 결정이 없는 랠리는 무시
  expect(learner.batch.length).toBe(3);
  expect(tuners[1]).toBeNull();
});
