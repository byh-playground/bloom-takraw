/**
 * 정책 가중치의 양자화 저장. 출력 행마다 최댓값 기준 대칭 양자화(bits 비트)하고 비트 단위로 이어 붙인다.
 * 형식: 'B' 'P', 버전, bits, 층 수 | 층마다 활성 함수 id(1), 입력 수(2), 출력 수(2) | 행별 스케일 float32 | 비트열
 */
const MAGIC = [0x42, 0x50], VERSION = 1;

class Quantizer {
  static levels(bits) { return 2 ** (bits - 1) - 1; }

  /** 행 하나를 양자화한다. 돌려주는 scale은 float32로 저장되는 값과 같다. */
  static quantizeRow(values, bits) {
    const L = Quantizer.levels(bits);
    let peak = 0; for (const v of values) peak = Math.max(peak, Math.abs(v));
    const scale = Math.fround(peak / L || 1), q = values.map(v => Math.max(-L, Math.min(L, Math.round(v / scale))));
    return { scale, q };
  }

  /** 가중치를 양자화했다가 되돌린 값. 저장 전에 학습 중 정책에 적용해 두면 저장·복원이 같은 값을 만든다. */
  static roundTrip(weights, rows, columns, bits) {
    const out = new Float64Array(weights.length);
    for (let r = 0; r < rows; r++) {
      const { scale, q } = Quantizer.quantizeRow(Array.from(weights.subarray(r * columns, (r + 1) * columns)), bits);
      q.forEach((value, c) => { out[r * columns + c] = value * scale; });
    }
    return out;
  }

  static encode(layout, parameters, bits = 4) {
    if (!Number.isInteger(bits) || bits < 2 || bits > 8) throw new Error('bits는 2~8의 정수여야 합니다.');
    return Quantizer._write(layout, parameters, bits, Quantizer.levels(bits));
  }

  static _write(layout, parameters, bits, L) {
    const header = 5 + layout.length * 5, scaleCount = parameters.reduce((n, p) => n + p.rows, 0);
    const valueCount = parameters.reduce((n, p) => n + p.rows * p.columns, 0);
    const bytes = new Uint8Array(header + scaleCount * 4 + Math.ceil(valueCount * bits / 8)), view = new DataView(bytes.buffer);
    bytes.set(MAGIC); bytes[2] = VERSION; bytes[3] = bits; bytes[4] = layout.length;
    layout.forEach((l, i) => { const o = 5 + i * 5; bytes[o] = l.activation; view.setUint16(o + 1, l.inputs); view.setUint16(o + 3, l.outputs); });
    let scaleAt = header, bit = (header + scaleCount * 4) * 8;
    for (const p of parameters) for (let r = 0; r < p.rows; r++) {
      const { scale, q } = Quantizer.quantizeRow(Array.from(p.weights.subarray(r * p.columns, (r + 1) * p.columns)), bits);
      view.setFloat32(scaleAt, scale); scaleAt += 4;
      for (const value of q) { Quantizer._put(bytes, bit, value + L, bits); bit += bits; }
    }
    return bytes;
  }

  /** 바이트 → { layout, weights: 층별 Float64Array }. 형식이 맞지 않으면 예외를 던진다. */
  static decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) throw new Error('정책 데이터 형식이 아닙니다.');
    if (bytes[2] !== VERSION) throw new Error(`지원하지 않는 정책 데이터 버전: ${bytes[2]}`);
    const bits = bytes[3], count = bytes[4], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), L = Quantizer.levels(bits);
    if (bits < 2 || bits > 8 || count < 1) throw new Error('정책 데이터 헤더가 올바르지 않습니다.');
    const layout = Array.from({ length: count }, (_, i) => { const o = 5 + i * 5; return { activation: bytes[o], inputs: view.getUint16(o + 1), outputs: view.getUint16(o + 3) }; });
    const header = 5 + count * 5, scaleCount = layout.reduce((n, l) => n + l.outputs, 0);
    const valueCount = layout.reduce((n, l) => n + l.outputs * (l.inputs + 1), 0);
    if (bytes.length !== header + scaleCount * 4 + Math.ceil(valueCount * bits / 8)) throw new Error('정책 데이터 길이가 맞지 않습니다.');
    let scaleAt = header, bit = (header + scaleCount * 4) * 8;
    const weights = layout.map(l => {
      const w = new Float64Array(l.outputs * (l.inputs + 1));
      for (let r = 0; r < l.outputs; r++) {
        const scale = view.getFloat32(scaleAt); scaleAt += 4;
        for (let c = 0; c <= l.inputs; c++) { w[r * (l.inputs + 1) + c] = (Quantizer._get(bytes, bit, bits) - L) * scale; bit += bits; }
      }
      return w;
    });
    return { layout, weights, bits };
  }

  static _put(bytes, bit, value, bits) { for (let i = 0; i < bits; i++) if ((value >> i) & 1) bytes[(bit + i) >> 3] |= 1 << ((bit + i) & 7); }
  static _get(bytes, bit, bits) { let v = 0; for (let i = 0; i < bits; i++) v |= ((bytes[(bit + i) >> 3] >> ((bit + i) & 7)) & 1) << i; return v; }
}

/** 믹스인: 층 목록(layout()/parameters())을 가진 정책에 양자화 저장·복원 능력을 더한다. */
const Quantizable = Base => class extends Base {
  toQuantized(bits = 4) { return Quantizer.encode(this.layout(), this.parameters(), bits); }
  /** 양자화한 값으로 가중치를 바꾼다. 학습 중 정책을 저장 형식과 같은 값으로 맞출 때 쓴다. */
  snapToQuantized(bits = 4) { for (const p of this.parameters()) p.weights.set(Quantizer.roundTrip(p.weights, p.rows, p.columns, bits)); }
  static fromQuantized(bytes) {
    const { layout, weights } = Quantizer.decode(bytes), policy = this.fromLayout(layout);
    policy.parameters().forEach((p, i) => p.weights.set(weights[i]));
    return policy;
  }
};

export { Quantizer, Quantizable };
