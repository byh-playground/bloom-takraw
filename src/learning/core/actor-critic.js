import { Reinforce } from './reinforce.js';

/**
 * 액터-크리틱: REINFORCE에 상태 가치망(크리틱)을 붙인다. 어드밴티지 = r + γ·V(s') − V(s).
 * 크리틱은 출력이 하나인 정책이며 활성 함수가 'identity'여야 한다.
 */
class ActorCritic extends Reinforce {
  constructor({ policy, critic, exploration, optimizer, criticOptimizer, gamma = 0.97 }) {
    super({ policy, exploration, baseline: null, optimizer });
    Object.assign(this, { critic, criticOptimizer, gamma });
    if (critic.outputSize !== 1) throw new Error('크리틱 출력은 1개여야 합니다.');
  }

  value(obs) { return this.critic.forward(obs)[0]; }
  target(e) { return e.reward + (e.done || !e.nextObs ? 0 : this.gamma * this.value(e.nextObs)); }

  advantages(batch) { this.targets = batch.map(e => this.target(e)); return batch.map((e, i) => this.targets[i] - this.value(e.obs)); }

  update(batch) {
    const meanReward = super.update(batch);
    this.critic.zeroGradient();
    batch.forEach((e, i) => { this.critic.forward(e.obs); this.critic.backward([(this.critic.layers.at(-1).lastOutput[0] - this.targets[i]) / batch.length]); });
    this.criticOptimizer.step(this.critic.parameters());
    return meanReward;
  }
}

export { ActorCritic };
