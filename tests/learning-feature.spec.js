import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';
import { TakrawClub, TAKRAW_CLUB_RULES } from '../src/club/club.js';
import { TeammateLearning, ReceiveTask } from '../src/learning/index.js';

// 물리 엔진이 필요한 시험은 RAPIER_MODULE(rapier3d-compat 진입 파일 경로)이 있을 때만 돈다.
const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const POLICY = 'x'.repeat(8);

test('클럽 저장 형식: 학습 필드는 선택이며 있으면 엄격히 검증한다', () => {
  const club = new TakrawClub({});
  const record = club._default();
  expect(record.learning).toEqual({ runs: 0, policy: null });
  expect(() => club._validate(record)).not.toThrow();
  const { learning, ...legacy } = record;
  expect(() => club._validate(legacy)).not.toThrow(); // 학습 필드가 없는 이전 저장본
  for (const bad of [{ runs: 1, policy: null }, { runs: 0, policy: 'AAAA' }, { runs: -1, policy: null }, { runs: 1, policy: '!!' }, { runs: 1, policy: 'A'.repeat(TAKRAW_CLUB_RULES.learning.policyLength + 1) }, null, 3]) {
    expect(() => club._validate({ ...record, learning: bad }), JSON.stringify(bad)).toThrow();
  }
  expect(() => club._validate({ ...record, learning: { runs: 2, policy: 'AAAA' } })).not.toThrow();
});

test('클럽 학습 저장: 포인트 1을 쓰고 정책과 횟수를 기록하며, 부족하면 거부한다', async () => {
  const club = new TakrawClub({});
  club.record = club._default();
  club._mutate = async (mutate, message) => { const next = structuredClone(club.record); const result = mutate(next); if (result !== false) { club._validate(next); club.record = next; } return { changed: result !== false, message }; };
  await expect(club.learn('')).rejects.toThrow();
  await expect(club.learn('가나다')).rejects.toThrow();
  const points = club.record.trainingPoints;
  if (points < TAKRAW_CLUB_RULES.learning.cost) await expect(club.learn(POLICY)).rejects.toThrow('포인트');
  club.record.trainingPoints = 3;
  await club.learn(POLICY); await club.learn('AAAA');
  expect(club.record.trainingPoints).toBe(1);
  expect(club.learnedPolicy()).toEqual({ policy: 'AAAA', runs: 2 });
  club.record.trainingPoints = 0;
  await expect(club.learn(POLICY)).rejects.toThrow('포인트');
  expect(club.learnedPolicy().runs).toBe(2); // 거부된 학습은 아무것도 바꾸지 않는다
  expect(club.getView().learning).toEqual({ runs: 2 });
});

test.describe('물리 엔진 필요', () => {
  test.skip(!rapierPath, 'RAPIER_MODULE이 없어 건너뜀');
  test.setTimeout(240000);

  test('팀 조정기: 상대 스파이크 뒤 착지점에 가장 가까운 선수 기준으로 조정 값을 갱신한다', async () => {
    const RAPIER = await loadRapier(), game = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });
    try {
      const calls = [];
      game.reset('match'); game.state.phase = 'rally';
      game.setTuner(0, (g, id) => { calls.push(id); return { aimDx: 0.5 }; });
      game.physics.resetBall({ x: 1, y: 3, z: 0 }, { x: -6, y: 0, z: 0 });
      game.applyTuner();
      expect(calls).toEqual([]); // 상대가 치기 전에는 호출하지 않는다
      game.retuneTeam = 0; game.applyTuner();
      expect(calls).toHaveLength(1);
      expect(game.physics.players[calls[0]].team).toBe(0);
      expect(game.tuning[0]).toEqual({ aimDx: 0.5 });
      expect(game.retuneTeam).toBe(-1);
      game.releaseTuning(0); // 받는 첫 접촉 뒤에는 기본값으로 돌아가지만 조정기는 남는다
      expect(game.tuning[0]).toBeNull();
      expect(typeof game.tuners[0]).toBe('function');
      game.retuneTeam = 0; game.applyTuner();
      expect(game.tuning[0]).toEqual({ aimDx: 0.5 });
      game.setTuner(0, null);
      expect(game.tuning[0]).toBeNull();
      expect(() => game.setTuner(0, 3)).toThrow();
    } finally { game.dispose(); }
  });

  test('받기 학습: 끝까지 돌면 저장 가능한 정책과 전후 비교를, 중단하면 정책 없이 돌려준다', async () => {
    const RAPIER = await loadRapier();
    const learner = new TeammateLearning({ createGame: () => new TakrawGame({ RAPIER, config: TAKRAW_CONFIG }), random: ReceiveTask.mulberry32(7), options: { evalScenes: 3, batchSize: 4 } });
    const phases = [];
    const done = await learner.learn({ epochs: 8, onPhase: phase => phases.push(phase) });
    expect(done.completed).toBe(true);
    expect(done.epochs).toBe(8);
    expect(phases).toEqual(['before', 'train', 'after']);
    expect(done.before.n).toBe(3); expect(done.after.n).toBe(3);
    const text = TeammateLearning.encode(done.policy);
    expect(text.length).toBeLessThanOrEqual(TAKRAW_CLUB_RULES.learning.policyLength);
    const restored = TeammateLearning.decode(text);
    expect(restored).not.toBeNull();
    const probe = new Float64Array(24).fill(0.1);
    expect(restored.act(probe)).toEqual(done.policy.act(probe)); // 저장 가중치 그대로 평가했으므로 같다
    expect(TeammateLearning.decode('AAAA')).toBeNull(); // 깨진 저장값은 무시한다

    const resumed = await learner.learn({ start: restored, epochs: 4 });
    expect(resumed.completed).toBe(true);
    let batches = 0;
    const stopped = await learner.learn({ epochs: 100, onBatch: () => { batches++; }, shouldStop: () => batches >= 1 });
    expect(stopped.completed).toBe(false);
    expect(stopped.policy).toBeNull();
    expect(stopped.epochs).toBeLessThan(100);
  });
});
