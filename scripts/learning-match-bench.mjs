// 경기 승률 측정: 학습한 조정을 쓰는 팀 대 조정 없는 규칙 AI 팀. 같은 조건에서 좌우 자리를 바꿔 가며 비교한다.
// 방식: 같은 조건에서 좌우 자리를 바꿔 가며 정해진 시간 동안 득점을 비교한다.
// 실행: RAPIER_MODULE=<rapier3d-compat 진입 파일 경로> node scripts/learning-match-bench.mjs
// 환경 변수: STATS(학습 스탯 목록, 기본 5,20), MATCHES(조건 수), SEED(학습 난수), MAX_SECONDS(판당 경기 시간, 기본 180초),
//   CACHE(학습한 정책을 저장·읽는 JSON 경로: 있으면 학습을 건너뛴다), TRAIN_ONLY=1(학습만 하고 저장), EVAL(경기를 돌릴 스탯 목록, 기본 전부, 0 = 규칙 대 규칙)
// 조건 = 시작 tick 오프셋. 게임에 난수가 없어 같은 조건은 항상 같은 경기가 되므로, 오프셋으로 AI 판단 주기의 위상을 바꿔 서로 다른 경기를 만든다.
import { TAKRAW_CONFIG } from '../src/config/game.js';
import fs from 'node:fs';
import { TakrawGame } from '../src/simulation/game.js';
import { LinearPolicy, Adam, GaussianExploration, EmaBaseline, Reinforce, Trainer, ReceiveTask, ReceiveObservation, TuningSpec, TeammateLearning } from '../src/learning/index.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded;
await RAPIER.init();
const env = (name, fallback) => process.env[name] ?? fallback;
const STATS = env('STATS', '5,20').split(',').map(Number), MATCHES = +env('MATCHES', 24), SEED = +env('SEED', 1), MAX_SECONDS = +env('MAX_SECONDS', 180);
const spec = new TuningSpec(), random = ReceiveTask.mulberry32(SEED * 97 + 5);
const createGame = () => new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });

// 학습: 스탯 1개 = 100 epoch. 목표 스탯마다 4비트로 양자화한 정책을 base64로 남긴다(저장될 가중치 그대로 평가).
const CACHE = env('CACHE', ''), policies = new Map();
if (CACHE && fs.existsSync(CACHE)) for (const [stat, text] of Object.entries(JSON.parse(fs.readFileSync(CACHE, 'utf8')))) policies.set(+stat, TeammateLearning.decode(text));
else {
  const task = new ReceiveTask({ createGame, spec });
  const policy = new LinearPolicy(ReceiveObservation.size, spec.size);
  const trainer = new Trainer({ task, algorithm: new Reinforce({ policy, exploration: new GaussianExploration({ sigma: 0.35, random }), baseline: new EmaBaseline(0.9), optimizer: new Adam({ learningRate: 0.01 }) }), random, batchSize: 8 });
  let stat = 0; const saved = {};
  for (const target of STATS) {
    await trainer.run((target - stat) * 100, { yieldToUi: async () => {} }); stat = target;
    const copy = new LinearPolicy(ReceiveObservation.size, spec.size); copy.copyFrom(policy);
    saved[target] = TeammateLearning.encode(copy); policies.set(target, TeammateLearning.decode(saved[target])); console.log(`학습 완료 스탯 ${target}`);
  }
  if (CACHE) fs.writeFileSync(CACHE, JSON.stringify(saved));
}
if (env('TRAIN_ONLY', '')) process.exit(0);

/**
 * 정해진 경기 시간 동안 돌리며 팀별 득점을 센다. 규칙 AI끼리는 한 판이 600초를 넘기는 경우가 많아 경기 단위 승패 대신 득점으로 비교한다.
 * side = 학습 조정을 쓰는 팀(0|1|null). offset = 시작 tick.
 */
function play(side, actor, offset) {
  const game = createGame(), points = [0, 0];
  try {
    if (side !== null) game.setTuner(side, TeammateLearning.tuner(actor, spec));
    game.reset('match');
    let previous = game.state.phase;
    const limit = offset + MAX_SECONDS * 60;
    for (let tick = offset; tick < limit && game.state.phase !== 'finished'; tick++) {
      game.step({ tick, tickRate: 60, inputs: [] });
      const phase = game.state.phase;
      if (previous === 'rally' && (phase === 'point' || phase === 'finished')) points[game.state.pointWinner]++;
      previous = phase;
    }
    return points;
  } finally { game.dispose(); }
}

// 조건마다 (학습 팀 득점 − 규칙 팀 득점)을 모아 평균과 표준오차를 낸다. 규칙 대 규칙(스탯 0)은 자리 편향을 재는 기준선이며 team 0을 기준 팀으로 센다.
const EVAL = env('EVAL', '').split(',').filter(Boolean).map(Number);
for (const [stats, actor] of [[0, null], ...policies].filter(([stats]) => !EVAL.length || EVAL.includes(stats))) {
  const diffs = []; let mine = 0, theirs = 0;
  for (let i = 0; i < MATCHES; i++) for (const side of actor ? [0, 1] : [0]) {
    const points = play(actor ? side : null, actor, i * 7 + 1), base = actor ? side : 0;
    mine += points[base]; theirs += points[1 - base]; diffs.push(points[base] - points[1 - base]);
    if (diffs.length % 8 === 0) console.log(`  진행 스탯 ${stats}: ${diffs.length}판`);
  }
  const n = diffs.length, mean = diffs.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(diffs.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1));
  console.log(JSON.stringify({ 스탯: stats, 판수: n, 득점: mine, 실점: theirs, 득점률: +(mine / Math.max(1, mine + theirs)).toFixed(3), 판당득실평균: +mean.toFixed(2), 표준오차: +(sd / Math.sqrt(n)).toFixed(2), 이긴판: diffs.filter(x => x > 0).length, 진판: diffs.filter(x => x < 0).length, 비긴판: diffs.filter(x => x === 0).length }));
}
