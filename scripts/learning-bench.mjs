// 학습 모듈 검증: 스파이크 리시브 장면에서 규칙 AI와 학습 정책을 고정 시드로 비교한다.
// 실행: RAPIER_MODULE=<rapier3d-compat 진입 파일 경로> node scripts/learning-bench.mjs
// 환경 변수: SEED(학습 난수), LR(학습률), SIGMA(탐험 폭), STATS(평가할 스탯, 쉼표 구분), EVAL_N(평가 장면 수), BITS(저장 비트)
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';
import { LinearPolicy, Adam, GaussianExploration, EmaBaseline, Reinforce, Trainer, ReceiveTask, ReceiveObservation, TuningSpec, evaluate } from '../src/learning/index.js';

const loaded = await import(process.env.RAPIER_MODULE || '@dimforge/rapier3d-compat').catch(() => {
  throw new Error('Rapier를 찾지 못했습니다. RAPIER_MODULE에 @dimforge/rapier3d-compat 진입 파일 경로를 지정하세요.');
});
const RAPIER = loaded.default ?? loaded;
await RAPIER.init();

const env = (name, fallback) => process.env[name] ?? fallback;
const SEED = +env('SEED', 1), LR = +env('LR', 0.01), SIGMA = +env('SIGMA', 0.35), BITS = +env('BITS', 4), EVAL_N = +env('EVAL_N', 160);
const STATS = env('STATS', '1,2,5,10,20').split(',').map(Number), EVAL_FIRST = 2001, STAT_EPOCHS = 100;
const random = ReceiveTask.mulberry32(SEED * 97 + 5), spec = new TuningSpec();
const task = new ReceiveTask({ createGame: () => new TakrawGame({ RAPIER, config: TAKRAW_CONFIG }), spec });
const seeds = Array.from({ length: EVAL_N }, (_, i) => EVAL_FIRST + i);
const policy = new LinearPolicy(ReceiveObservation.size, spec.size);
const algorithm = new Reinforce({ policy, exploration: new GaussianExploration({ sigma: SIGMA, random }),
  baseline: new EmaBaseline(0.9), optimizer: new Adam({ learningRate: LR }) });
const trainer = new Trainer({ task, algorithm, random, batchSize: 8 });
const show = (label, result, extra = {}) => console.log(label, JSON.stringify({ ...result, meanReward: +result.meanReward.toFixed(3), ...extra }));

show('규칙 AI', evaluate(task, null, seeds));
show('스탯 0 (학습 전)', evaluate(task, policy, seeds));
let stat = 0;
for (const target of STATS) {
  const started = performance.now();
  await trainer.run((target - stat) * STAT_EPOCHS, { yieldToUi: async () => {} });
  const seconds = (performance.now() - started) / 1000; stat = target;
  show(`스탯 ${target}`, evaluate(task, policy, seeds), { trainSeconds: +seconds.toFixed(1), perStat: +(seconds / (STATS.indexOf(target) === 0 ? target : target - STATS[STATS.indexOf(target) - 1])).toFixed(1) });
}
const quantized = policy.toQuantized(BITS);
const restored = (await import('../src/learning/index.js')).Policy.fromQuantized(quantized);
show(`스탯 ${stat} · ${BITS}비트 저장 복원 후 (${quantized.length} 바이트)`, evaluate(task, restored, seeds));
