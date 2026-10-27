// 경기 학습 측정: 실제 경기의 랠리 결과로 조정 값을 계속 학습시키고, 학습 전후 득점률을 규칙 AI와 비교한다.
// 실행: RAPIER_MODULE=<rapier3d-compat 진입 파일> TRAIN=40 node scripts/match-learning-bench.mjs
// 환경 변수: TRAIN(학습 경기 수), SEC(경기 시간 초, 기본 120), SEED, EVAL(평가 조건 수, 기본 24), LR, SIGMA, BATCH, OUT(학습한 정책 저장 경로)
import fs from 'node:fs';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';
import { MatchLearning, RallyObserver, LinearPolicy, MatchObservation, TuningSpec } from '../src/learning/index.js';
import { ReceiveTask } from '../src/learning/index.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (name, fallback) => process.env[name] ?? fallback;
const TRAIN = +env('TRAIN', 40), SEC = +env('SEC', 120), SEED = +env('SEED', 1), EVAL = +env('EVAL', 24);
const options = {}; for (const [key, name] of [['learningRate', 'LR'], ['sigma', 'SIGMA'], ['batchSize', 'BATCH']]) if (process.env[name]) options[key] = +process.env[name];
const random = ReceiveTask.mulberry32(SEED * 7919 + 3), spec = new TuningSpec();
const createGame = () => new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });

/** 한 경기를 정해진 시간 동안 돌린다. learner: 학습/적용을 받는 팀 side의 MatchLearning(없으면 규칙 AI). */
function play({ side, learner, frozen = null, seed, offset }) {
  const game = createGame(), points = [0, 0];
  try {
    game.reset('match', undefined, seed);
    const observer = learner ? new RallyObserver({ learner, team: side }) : null;
    if (frozen) game.setTuner(side, null); // 평가: 고정 정책은 랠리마다 평균 조정만 적용(아래)
    let previous = game.state.phase;
    for (let tick = offset; tick < offset + SEC * 60 && game.state.phase !== 'finished'; tick++) {
      game.step({ tick, tickRate: 60, inputs: [] });
      const phase = game.state.phase;
      if (observer) observer.observe(game);
      if (frozen && previous !== 'rally' && phase === 'rally') game.setTuning(side, MatchLearning.tuner(frozen, spec)(game, side));
      if (previous === 'rally' && phase !== 'rally') points[game.state.pointWinner]++;
      previous = phase;
    }
    return points;
  } finally { game.dispose(); }
}

const learner = new MatchLearning({ random, options });
const log = [];
console.log(`학습 경기 ${TRAIN}판 (경기당 ${SEC}초), 옵션`, learner.options);
for (let m = 0; m < TRAIN; m++) {
  const side = m % 2, points = play({ side, learner, seed: 5000 + SEED * 1000 + m, offset: m * 7 + 1 });
  const share = points[side] / Math.max(1, points[0] + points[1]);
  log.push(share);
  if ((m + 1) % 5 === 0) {
    const block = log.slice(-5), mean = block.reduce((x, y) => x + y, 0) / block.length;
    const mu = learner.policy.layers[0].weights, norm = Math.hypot(...mu);
    console.log(`  ${m + 1}판: 최근 5판 득점률 ${mean.toFixed(3)}, 랠리 ${learner.rallies}, 승 ${learner.wins}, |가중치| ${norm.toFixed(2)}`);
  }
}
if (env('OUT', '')) fs.writeFileSync(env('OUT', ''), MatchLearning.encode(learner.policy));

// 평가: 학습한 평균 조정(탐험 없음) 대 규칙 AI, 좌우를 바꿔 가며. 규칙 대 규칙은 같은 장치의 기준선이다.
function evaluate(label, frozen) {
  const diffs = []; let mine = 0, theirs = 0;
  for (let i = 0; i < EVAL; i++) for (const side of [0, 1]) {
    const points = play({ side, learner: null, frozen, seed: 9000 + i, offset: i * 7 + 1 });
    mine += points[side]; theirs += points[1 - side]; diffs.push(points[side] - points[1 - side]);
  }
  const n = diffs.length, mean = diffs.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(diffs.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1));
  console.log(JSON.stringify({ 대상: label, 판수: n, 득점: mine, 실점: theirs, 득점률: +(mine / Math.max(1, mine + theirs)).toFixed(3), 판당득실평균: +mean.toFixed(2), 표준오차: +(sd / Math.sqrt(n)).toFixed(2) }));
}
const control = new LinearPolicy(MatchObservation.size, spec.size);
evaluate('대조군(조정 0)', control);
evaluate('학습 정책', learner.policy);
