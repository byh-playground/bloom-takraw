/** REINFORCE: 정책 + 탐험 + 기준선 + 최적화기를 조합한다(has-a). 한 번의 행동(밴딧) 장면에 맞춘 정책 기울기다. */
class Reinforce {
  constructor({ policy, exploration, baseline, optimizer }) { Object.assign(this, { policy, exploration, baseline, optimizer }); }

  /** 관측에서 탐험 행동을 뽑는다. update에 넘길 에피소드 조각을 돌려준다. */
  sample(obs) {
    const mean = this.policy.forward(obs);
    return { obs, mean, action: this.exploration.sample(mean) };
  }

  /** episodes: { obs, mean, action, reward }[]. 한 배치로 한 번 갱신하고 배치 평균 보상을 돌려준다. */
  update(episodes) {
    const meanReward = episodes.reduce((s, e) => s + e.reward, 0) / episodes.length;
    this.baseline.update(meanReward);
    this.policy.zeroGradient();
    for (const e of episodes) {
      const advantage = this.baseline.advantage(e.reward), score = this.exploration.scoreGradient(e.mean, e.action);
      this.policy.forward(e.obs); // 역전파가 쓰는 층별 입력·출력을 이 에피소드로 다시 채운다
      this.policy.backward(score.map(g => -g * advantage / episodes.length)); // 손실 = −기대 보상
    }
    this.optimizer.step(this.policy.parameters());
    return meanReward;
  }
}

export { Reinforce };
