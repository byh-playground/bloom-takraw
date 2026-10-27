import { LinearPolicy, Policy } from './core/policy.js';
import { Adam } from './core/optimizer.js';
import { GaussianExploration } from './core/exploration.js';
import { EmaBaseline } from './core/baseline.js';
import { Reinforce } from './core/reinforce.js';
import { Trainer, evaluate } from './trainer.js';
import { ReceiveObservation } from './takraw/observation.js';
import { ReceiveTask } from './takraw/receive-task.js';
import { TuningSpec } from './takraw/tuning.js';

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/**
 * 우리 팀 동료 AI의 스파이크 받기 학습. 한 번의 학습 = 정해진 epoch 수의 REINFORCE이며,
 * 이전 정책이 있으면 그 가중치에서 이어서 학습한다. 게임과 저장소는 모르고 createGame만 받는다(has-a).
 */
// TOBE(learning) 학습 목표 검증: 이 클래스는 장면 성공률만 높인다. 경기 득점은 `scripts/learning-match-bench.mjs`로만 확인할 수 있고,
// 학습 화면에는 경기 지표가 없다. 경기 득점률이 규칙 AI 이상임이 확인되기 전까지 화면 문구는 '장면 성공률'로 한정한다(docs/learning-tobe.md ③).
class TeammateLearning {
  static get defaults() { return Object.freeze({ learningRate: 0.01, sigma: 0.35, batchSize: 8, evalScenes: 16, evalFirstSeed: 2001 }); }

  constructor({ createGame, random = Math.random, options = {} }) {
    this.options = { ...TeammateLearning.defaults, ...options };
    this.spec = new TuningSpec();
    this.task = new ReceiveTask({ createGame, spec: this.spec });
    this.random = random;
  }

  /** 저장된 base64 정책 또는 새 선형 정책. 정책 모양이 맞지 않으면 새로 시작한다. */
  static decode(text) {
    try {
      const policy = Policy.fromQuantized(fromBase64(text));
      return policy.layers.length === 1 && policy.inputSize === ReceiveObservation.size && policy.outputSize === new TuningSpec().size ? policy : null;
    } catch { return null; }
  }
  static encode(policy, bits = 4) { return toBase64(policy.toQuantized(bits)); }

  /** 경기 중에 쓰는 조정기: 게임 상황 → 팀 조정 값. 연산은 사칙연산만이라 브라우저 간에 같다. */
  static tuner(policy, spec = new TuningSpec()) {
    return (game, playerId) => spec.decode(policy.act(ReceiveObservation.encode(game, playerId)), game);
  }

  /** 시작 정책(없으면 새 정책)에서 epochs만큼 학습해 { policy, epochs, completed, curve, before, after }를 돌려준다. */
  async learn({ start = null, epochs, onBatch = null, onPhase = null, shouldStop = () => false }) {
    const { learningRate, sigma, batchSize, evalScenes, evalFirstSeed } = this.options;
    const policy = new LinearPolicy(ReceiveObservation.size, this.spec.size);
    if (start) policy.copyFrom(start);
    const algorithm = new Reinforce({ policy, exploration: new GaussianExploration({ sigma, random: this.random }),
      baseline: new EmaBaseline(0.9), optimizer: new Adam({ learningRate }) });
    const trainer = new Trainer({ task: this.task, algorithm, random: this.random, batchSize });
    const seeds = Array.from({ length: evalScenes }, (_, i) => evalFirstSeed + i);
    onPhase?.('before');
    const before = evaluate(this.task, start, seeds);
    onPhase?.('train');
    const curve = [];
    const done = await trainer.run(epochs, { shouldStop, onBatch: batch => { curve.push(batch); onBatch?.(batch); } });
    if (done < epochs) return { policy: null, epochs: done, completed: false, curve, before, after: null };
    onPhase?.('after');
    policy.snapToQuantized(); // 저장될 4비트 가중치 그대로 평가한다
    const after = evaluate(this.task, policy, seeds);
    return { policy, epochs: done, completed: true, curve, before, after };
  }
}

export { TeammateLearning };
