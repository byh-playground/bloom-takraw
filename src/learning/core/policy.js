/** 정책 신경망. 층(Layer)을 조합(has-a)하고, 양자화 저장은 Quantizable 믹스인이 붙인다(can-be). */
import { Quantizable } from './quantize.js';

/** 부호 있는 포화 함수. tanh 대신 쓰는 이유: 사칙연산만 써서 엔진이 달라도 결과가 같다(롤백 락스텝 추론). */
const ACTIVATIONS = Object.freeze({
  identity: { id: 0, apply: x => x, slope: () => 1 },
  bounded: { id: 1, apply: x => x / (1 + Math.abs(x)), slope: y => (1 - Math.abs(y)) * (1 - Math.abs(y)) },
});

/** 층의 공통 규약: 순전파로 출력을 만들고, 역전파로 입력 기울기를 돌려주며 가중치 기울기를 누적한다. */
class Layer {
  forward() { throw new Error('forward를 구현해야 합니다.'); }
  backward() { throw new Error('backward를 구현해야 합니다.'); }
}

/** 완전 연결 층. 가중치는 outputs × (inputs + 1) 행 우선 행렬이며 마지막 열이 편향이다. */
class DenseLayer extends Layer {
  constructor(inputs, outputs, activation = 'bounded') {
    super();
    if (!ACTIVATIONS[activation]) throw new Error(`알 수 없는 활성 함수: ${activation}`);
    this.inputs = inputs; this.outputs = outputs; this.activation = activation;
    this.weights = new Float64Array(outputs * (inputs + 1));
    this.gradient = new Float64Array(this.weights.length);
    this.lastInput = null; this.lastOutput = new Float64Array(outputs);
  }
  get columns() { return this.inputs + 1; }
  forward(x) {
    const { inputs, outputs, weights } = this, act = ACTIVATIONS[this.activation], y = this.lastOutput;
    this.lastInput = x;
    for (let k = 0; k < outputs; k++) {
      const row = k * (inputs + 1);
      let z = weights[row + inputs];
      for (let i = 0; i < inputs; i++) z += weights[row + i] * x[i];
      y[k] = act.apply(z);
    }
    return y;
  }
  /** gradOutput: 목적 함수의 출력 기울기. 가중치 기울기를 this.gradient에 더하고 입력 기울기를 돌려준다. */
  backward(gradOutput) {
    const { inputs, outputs, weights, gradient, lastInput: x } = this, act = ACTIVATIONS[this.activation];
    const gradInput = new Float64Array(inputs);
    for (let k = 0; k < outputs; k++) {
      const dz = gradOutput[k] * act.slope(this.lastOutput[k]), row = k * (inputs + 1);
      for (let i = 0; i < inputs; i++) { gradient[row + i] += dz * x[i]; gradInput[i] += dz * weights[row + i]; }
      gradient[row + inputs] += dz;
    }
    return gradInput;
  }
}

class Policy extends Quantizable(Object) {
  constructor(layers) { super(); this.layers = layers; }
  get inputSize() { return this.layers[0].inputs; }
  get outputSize() { return this.layers[this.layers.length - 1].outputs; }
  /** 관측 → [-1, 1] 범위의 출력. 마지막 층이 bounded일 때만 범위가 보장된다. */
  forward(obs) { let x = obs; for (const layer of this.layers) x = layer.forward(x); return Array.from(x); }
  act(obs) { return this.forward(obs); }
  /** 직전 forward 호출에 대한 출력 기울기를 역전파한다. */
  backward(gradOutput) { let g = Float64Array.from(gradOutput); for (let i = this.layers.length - 1; i >= 0; i--) g = this.layers[i].backward(g); }
  /** 같은 구조의 다른 정책 가중치를 복사한다(DQN 목표망 갱신). */
  copyFrom(other) { this.layers.forEach((layer, i) => layer.weights.set(other.layers[i].weights)); return this; }
  zeroGradient() { for (const layer of this.layers) layer.gradient.fill(0); }
  /** 최적화·양자화가 다루는 가중치와 기울기 목록. */
  parameters() { return this.layers.map(layer => ({ weights: layer.weights, gradient: layer.gradient, rows: layer.outputs, columns: layer.columns })); }
  layout() { return this.layers.map(layer => ({ inputs: layer.inputs, outputs: layer.outputs, activation: ACTIVATIONS[layer.activation].id })); }
  static fromLayout(layout) {
    return new Policy(layout.map(({ inputs, outputs, activation }) => {
      const name = Object.keys(ACTIVATIONS).find(key => ACTIVATIONS[key].id === activation);
      if (!name) throw new Error(`알 수 없는 활성 함수 id: ${activation}`);
      return new DenseLayer(inputs, outputs, name);
    }));
  }
}

/** 입력 → 출력 한 층. 가장 작은 정책이다. */
class LinearPolicy extends Policy {
  /** output: 출력 활성 함수. 행동 평균은 'bounded'([-1, 1]), 가치(Q·V)는 'identity'. */
  constructor(inputs, outputs, { output = 'bounded' } = {}) { super([new DenseLayer(inputs, outputs, output)]); }
}

/** 은닉층을 가진 정책. hidden은 은닉 크기 배열이다. */
class MlpPolicy extends Policy {
  constructor(inputs, hidden, outputs, { output = 'bounded' } = {}) {
    const sizes = [inputs, ...hidden, outputs];
    super(sizes.slice(1).map((size, i) => new DenseLayer(sizes[i], size, i === sizes.length - 2 ? output : 'bounded')));
  }
}

export { ACTIVATIONS, Layer, DenseLayer, Policy, LinearPolicy, MlpPolicy };
