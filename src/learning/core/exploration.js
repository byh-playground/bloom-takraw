/** 탐험 규약: 정책 평균 출력에서 실제 행동을 뽑는다. */
class Exploration {
  sample() { throw new Error('sample을 구현해야 합니다.'); }
}

/** 평균 출력에 정규 잡음을 더하고 [min, max]로 자른다. random은 [0, 1) 난수 함수다. */
class GaussianExploration extends Exploration {
  constructor({ sigma = 0.35, random, min = -1, max = 1 }) {
    super();
    if (typeof random !== 'function') throw new Error('random 함수가 필요합니다.');
    Object.assign(this, { sigma, random, min, max });
  }
  gaussian() { return Math.sqrt(-2 * Math.log(this.random() + 1e-12)) * Math.cos(2 * Math.PI * this.random()); }
  sample(mean) { return mean.map(m => Math.max(this.min, Math.min(this.max, m + this.sigma * this.gaussian()))); }
  /** 행동이 평균에서 나올 로그 확률의 평균 방향 기울기: (행동 − 평균) / σ². */
  scoreGradient(mean, action) { return mean.map((m, i) => (action[i] - m) / (this.sigma * this.sigma)); }
}

export { Exploration, GaussianExploration };
