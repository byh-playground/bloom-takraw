// 조정 값 하나씩 흔들었을 때 득점률이 어떻게 변하는지 측정한다(나머지는 기본값). 학습이 개선할 여지가 있는 값을 찾는 용도다.
// 실행: RAPIER_MODULE=<rapier3d-compat 진입 파일> PART=0 PARTS=2 EVAL=16 SEC=60 node scripts/tuning-scan.mjs
// 환경 변수: EVAL(조건 수, 좌우 2판씩), SEC(경기 시간 초), PART·PARTS(설정 목록을 나눠 병렬 실행), LEVEL(출력 크기, 기본 0.5)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';
import { TuningSpec, MATCH_TUNING } from '../src/learning/index.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat');
const RAPIER = loaded.default ?? loaded; await RAPIER.init();
const env = (name, fallback) => +(process.env[name] ?? fallback);
const EVAL = env('EVAL', 16), SEC = env('SEC', 60), PART = env('PART', 0), PARTS = env('PARTS', 1), LEVEL = env('LEVEL', 0.5);
const spec = new TuningSpec(MATCH_TUNING);

function play({ side, output, seed, offset }) {
  const game = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG }), points = [0, 0];
  try {
    game.reset('match', undefined, seed);
    if (output) game.setTuning(side, spec.decode(output, game));
    let previous = game.state.phase;
    for (let tick = offset; tick < offset + SEC * 60 && game.state.phase !== 'finished'; tick++) {
      game.step({ tick, tickRate: 60, inputs: [] });
      const phase = game.state.phase;
      if (previous === 'rally' && phase !== 'rally') points[game.state.pointWinner]++;
      previous = phase;
    }
    return points;
  } finally { game.dispose(); }
}

const settings = spec.entries.flatMap((entry, i) => [-LEVEL, LEVEL].map(level => ({ name: entry.name, level, index: i })));
settings.forEach((setting, k) => {
  if (k % PARTS !== PART) return;
  const output = new Float64Array(spec.size); output[setting.index] = setting.level;
  let mine = 0, theirs = 0; const diffs = [];
  for (let i = 0; i < EVAL; i++) for (const side of [0, 1]) {
    const points = play({ side, output, seed: 9000 + i, offset: i * 7 + 1 });
    mine += points[side]; theirs += points[1 - side]; diffs.push(points[side] - points[1 - side]);
  }
  const n = diffs.length, mean = diffs.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(diffs.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1));
  console.log(JSON.stringify({ 값: setting.name, 수준: setting.level, 득점: mine, 실점: theirs, 득점률: +(mine / Math.max(1, mine + theirs)).toFixed(3), 판당득실평균: +mean.toFixed(2), 표준오차: +(sd / Math.sqrt(n)).toFixed(2) }));
});
