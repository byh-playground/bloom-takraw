/** 학습 실행과 평가. 알고리즘과 과제를 조합(has-a)하며 어느 쪽도 게임을 직접 알지 못한다. */
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

class Trainer {
  /** epoch 1회 = 장면 1회. batchSize 장면마다 정책을 한 번 갱신한다. */
  constructor({ task, algorithm, random, batchSize = 8, seedBase = 1000 }) {
    Object.assign(this, { task, algorithm, random, batchSize, seedBase });
    this.epochs = 0;
  }

  /**
   * epochs만큼 학습한다. 배치마다 화면에 양보하며 onBatch({ epochs, meanReward, successRate })를 부른다.
   * shouldStop()이 true를 돌려주면 그 배치 뒤에 멈춘다. 돌려주는 값은 실제로 돌린 epoch 수다.
   */
  async run(epochs, { onBatch = null, shouldStop = () => false, yieldToUi = nextTask } = {}) {
    let done = 0;
    while (done < epochs && !shouldStop()) {
      const size = Math.min(this.batchSize, epochs - done), batch = [];
      for (let i = 0; i < size; i++) {
        const seed = this.seedBase + Math.floor(this.random() * 100000);
        batch.push(this.task.rollout(seed, obs => this.algorithm.sample(obs)));
      }
      const meanReward = this.algorithm.update(batch);
      done += size; this.epochs += size;
      onBatch?.({ epochs: this.epochs, meanReward, successRate: batch.filter(e => e.success).length / size });
      await yieldToUi();
    }
    return done;
  }
}

/** 고정 시드 장면에서 정책(또는 조정 없는 규칙 AI)을 평가한다. 정책의 평균 출력만 쓰고 탐험하지 않는다. */
function evaluate(task, policy, seeds) {
  const by = {}; let success = 0, reward = 0;
  for (const seed of seeds) {
    const episode = task.rollout(seed, policy ? obs => ({ action: policy.act(obs) }) : null);
    success += episode.success ? 1 : 0; reward += episode.reward; by[episode.code] = (by[episode.code] || 0) + 1;
  }
  return { success, n: seeds.length, meanReward: reward / seeds.length, by };
}

export { Trainer, evaluate };
