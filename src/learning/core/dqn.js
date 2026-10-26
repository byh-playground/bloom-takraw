import { Algorithm } from './algorithm.js';
import { ReplayBuffer } from './replay-buffer.js';

/** 분기별로 levels 단계 중 하나를 고르는 행동 공간. branches = 1이면 일반 DQN의 이산 행동이다. */
class BranchActions {
  constructor({ branches = 1, values = [-1, 0, 1] }) { Object.assign(this, { branches, values }); }
  get levels() { return this.values.length; }
  get outputSize() { return this.branches * this.levels; }
  toAction(indices) { return indices.map(i => this.values[i]); }
  /** Q 출력에서 분기별 최댓값 인덱스(동점이면 낮은 번호)를 고른다. */
  greedy(q) {
    return Array.from({ length: this.branches }, (_, b) => {
      let best = 0; for (let l = 1; l < this.levels; l++) if (q[b * this.levels + l] > q[b * this.levels + best]) best = l;
      return best;
    });
  }
}

/**
 * DQN(분기형). Q망(출력 활성 'identity') + 목표망 + 리플레이 + 입실론-탐욕.
 * 목표값 y = r + γ·(분기 평균 max Q_target(s')) (done이면 r). 손실은 Huber(기울기 ±1로 제한).
 */
class Dqn extends Algorithm {
  constructor({ qPolicy, targetPolicy, actions, optimizer, random, gamma = 0.97, batchSize = 32, updatesPerBatch = 8,
    minReplay = 64, replayCapacity = 5000, targetEvery = 25, epsilon = { start: 1, end: 0.05, steps: 800 } }) {
    super();
    if (qPolicy.outputSize !== actions.outputSize) throw new Error('Q망 출력 수가 행동 공간과 다릅니다.');
    Object.assign(this, { qPolicy, targetPolicy: targetPolicy.copyFrom(qPolicy), actions, optimizer, random, gamma, batchSize,
      updatesPerBatch, minReplay, targetEvery, epsilonSchedule: epsilon });
    this.replay = new ReplayBuffer(replayCapacity, random); this.samples = 0; this.updates = 0;
  }

  get epsilon() { const e = this.epsilonSchedule; return Math.max(e.end, e.start + (e.end - e.start) * this.samples / e.steps); }

  sample(obs) {
    this.samples++;
    const greedy = this.actions.greedy(this.qPolicy.forward(obs));
    const indices = greedy.map(best => this.random() < this.epsilon ? Math.floor(this.random() * this.actions.levels) : best);
    return { obs, indices, action: this.actions.toAction(indices) };
  }
  actor() { return { act: obs => this.actions.toAction(this.actions.greedy(this.qPolicy.forward(obs))) }; }

  update(batch) {
    for (const e of batch) this.replay.push({ obs: e.obs, indices: e.indices, reward: e.reward, nextObs: e.nextObs ?? null, done: e.done ?? true });
    if (this.replay.size >= this.minReplay) for (let k = 0; k < this.updatesPerBatch; k++) this._step();
    return batch.reduce((s, e) => s + e.reward, 0) / batch.length;
  }

  _step() {
    const { actions } = this, samples = this.replay.sample(this.batchSize);
    this.qPolicy.zeroGradient();
    for (const t of samples) {
      let target = t.reward;
      if (!t.done && t.nextObs) {
        const next = this.targetPolicy.forward(t.nextObs), best = actions.greedy(next);
        target += this.gamma * best.reduce((s, l, b) => s + next[b * actions.levels + l], 0) / actions.branches;
      }
      const q = this.qPolicy.forward(t.obs), grad = new Array(actions.outputSize).fill(0);
      t.indices.forEach((l, b) => { const at = b * actions.levels + l; grad[at] = Math.max(-1, Math.min(1, q[at] - target)) / (samples.length * actions.branches); });
      this.qPolicy.backward(grad);
    }
    this.optimizer.step(this.qPolicy.parameters());
    if (++this.updates % this.targetEvery === 0) this.targetPolicy.copyFrom(this.qPolicy);
  }
}

export { BranchActions, Dqn };
