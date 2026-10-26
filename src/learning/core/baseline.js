/** 보상 기준선 규약. advantage = 보상 − 기준선. */
class Baseline {
  update() { throw new Error('update를 구현해야 합니다.'); }
  advantage() { throw new Error('advantage를 구현해야 합니다.'); }
}

class EmaBaseline extends Baseline {
  constructor(decay = 0.9) { super(); this.decay = decay; this.value = null; }
  update(batchMean) { this.value = this.value === null ? batchMean : this.decay * this.value + (1 - this.decay) * batchMean; }
  advantage(reward) { return reward - (this.value ?? 0); }
}

export { Baseline, EmaBaseline };
