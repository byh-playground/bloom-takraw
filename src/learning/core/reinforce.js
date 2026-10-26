import { Algorithm } from './algorithm.js';

/**
 * REINFORCE: 정책 기울기. 정책 + 탐험 + 기준선 + 최적화기를 조합한다(has-a).
 * 어드밴티지 계산만 advantages()로 분리해 두었으므로 액터-크리틱이 이를 바꿔 쓴다(is-a).
 */
class Reinforce extends Algorithm {
  constructor({ policy, exploration, baseline, optimizer }) { super(); Object.assign(this, { policy, exploration, baseline, optimizer }); }

  sample(obs) {
    const mean = this.policy.forward(obs);
    return { obs, mean, action: this.exploration.sample(mean) };
  }
  actor() { return { act: obs => this.policy.act(obs) }; }

  /** 전이별 어드밴티지. 기본은 이동평균 기준선(상태와 무관). */
  advantages(batch) {
    this.baseline.update(batch.reduce((s, e) => s + e.reward, 0) / batch.length);
    return batch.map(e => this.baseline.advantage(e.reward));
  }

  update(batch) {
    const advantages = this.advantages(batch);
    this.policy.zeroGradient();
    batch.forEach((e, i) => {
      const score = this.exploration.scoreGradient(e.mean, e.action);
      this.policy.forward(e.obs); // 역전파가 쓰는 층별 입력·출력을 이 전이로 다시 채운다
      this.policy.backward(score.map(g => -g * advantages[i] / batch.length)); // 손실 = −기대 보상
    });
    this.optimizer.step(this.policy.parameters());
    return batch.reduce((s, e) => s + e.reward, 0) / batch.length;
  }
}

export { Reinforce };
