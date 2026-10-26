/** 최적화기 규약: 가중치 목록과 같은 모양의 기울기로 손실을 줄이는 방향으로 가중치를 갱신한다. */
class Optimizer {
  step() { throw new Error('step을 구현해야 합니다.'); }
}

class Adam extends Optimizer {
  constructor({ learningRate = 0.01, beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8 } = {}) {
    super();
    Object.assign(this, { learningRate, beta1, beta2, epsilon });
    this.t = 0; this.m = []; this.v = [];
  }
  /** parameters: { weights, gradient }[]. gradient는 손실의 기울기이며 weights에서 빼는 방향으로 이동한다. */
  step(parameters) {
    this.t++;
    const c1 = 1 - this.beta1 ** this.t, c2 = 1 - this.beta2 ** this.t;
    parameters.forEach(({ weights, gradient }, k) => {
      const m = this.m[k] ??= new Float64Array(weights.length), v = this.v[k] ??= new Float64Array(weights.length);
      for (let i = 0; i < weights.length; i++) {
        const g = gradient[i];
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * g;
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * g * g;
        weights[i] -= this.learningRate * (m[i] / c1) / (Math.sqrt(v[i] / c2) + this.epsilon);
      }
    });
  }
}

export { Optimizer, Adam };
