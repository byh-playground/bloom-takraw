import { TAKRAW_MOTION_DATA } from './data.js';
import { TAKRAW_MOTION_MODEL } from './model.js';

/**
 * Runtime of the authored four-clip learned matcher.
 * Projector chooses a clip/entry pose; stepper predicts phase rate; the
 * decompressor reconstructs reference poses. It never touches Rapier bodies.
 * Reach/joint bounds and an explicit training preference are eligibility
 * constraints, not an alternative rule-based motion-selection controller.
 */
class TakrawMotionMatcher {
  constructor(data = TAKRAW_MOTION_DATA, model = TAKRAW_MOTION_MODEL) {
    this.data = data;
    this.model = model;
    this.clips = data.clips;
    this.index = new Map(this.clips.map((clip, i) => [clip.id, i]));
    this.buffers = new Map();
    for (const net of [model.projector, model.stepper, model.decompressor]) {
      this.buffers.set(net, {
        input: new Float64Array(net.inputMean.length),
        layers: net.layers.map(layer => new Float64Array(layer.output)),
      });
    }
  }

  _clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  _number(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }

  _infer(net, input) {
    const scratch = this.buffers.get(net);
    let values = scratch.input;
    for (let i = 0; i < values.length; i++) values[i] = (input[i] - net.inputMean[i]) / net.inputScale[i];
    for (let n = 0; n < net.layers.length; n++) {
      const layer = net.layers[n], out = scratch.layers[n];
      for (let row = 0; row < layer.output; row++) {
        let total = layer.bias[row];
        const offset = row * layer.input;
        for (let column = 0; column < layer.input; column++) total += layer.weight[offset + column] * values[column];
        out[row] = layer.activation === 'tanh' ? Math.tanh(total) : total;
      }
      values = out;
    }
    if (net.outputMean) for (let i = 0; i < values.length; i++) values[i] = values[i] * net.outputScale[i] + net.outputMean[i];
    return values;
  }

  _query(query) {
    const length = Math.max(0.1, this._number(query.legLength, this.data.legLength));
    const ball = query.ball || {}, foot = query.foot || {}, velocity = query.velocity || {}, body = query.body || {};
    return [
      this._clamp(this._number(ball.forward) / length, -3, 3),
      this._clamp(this._number(ball.height) / length, -3, 4),
      this._clamp(this._number(ball.lateral) / length, -3, 3),
      this._clamp(this._number(foot.forward) / length, -1.2, 1.2),
      this._clamp(this._number(foot.height, -length * .7) / length, -1.2, 1.2),
      this._clamp(this._number(foot.lateral) / length, -1.2, 1.2),
      this._clamp(this._number(velocity.forward) / 8, -2, 2),
      this._clamp(this._number(velocity.height) / 8, -2, 2),
      this._clamp(this._number(velocity.lateral) / 8, -2, 2),
      this._clamp(this._number(body.up, 1), -1, 1),
      this._clamp(this._number(body.forward), -1, 1),
      this._clamp(this._number(body.spin) / 12, -1.5, 1.5),
      this._clamp(this._number(query.timeToContact, .25) / .8, 0, 1.25),
      query.preheld ? 1 : 0,
    ];
  }

  select(query, preference = 'auto') {
    const values = this._infer(this.model.projector, this._query(query));
    const count = this.clips.length;
    let chosen = 0;
    for (let i = 1; i < count; i++) if (values[i] > values[chosen]) chosen = i;
    const top = values[chosen];
    let denominator = 0;
    for (let i = 0; i < count; i++) denominator += Math.exp(values[i] - top);
    const automatic = this.clips[chosen].id;
    let constrained = false;
    if (preference !== 'auto') {
      if (!this.index.has(preference)) throw new Error(`알 수 없는 발차기: ${preference}`);
      chosen = this.index.get(preference);
      constrained = true;
    } else if (query.preheld) {
      // The user's already-held raised leg must continue its downward entry.
      chosen = this.index.get('downward');
      constrained = true;
    }
    const clip = this.clips[chosen];
    return {
      id: clip.id,
      phase: this._clamp(values[count + chosen], 0, clip.contactPhase - .025),
      confidence: Math.exp(values[chosen] - top) / denominator,
      score: values[chosen], automatic, constrained, age: 0,
    };
  }

  sample(id, phase) {
    const index = this.index.get(id);
    if (index === undefined) throw new Error(`알 수 없는 발차기: ${id}`);
    const clip = this.clips[index];
    const at = this._clamp(this._number(phase), 0, 1);
    const input = [0, 0, 0, 0, at]; input[index] = 1;
    const p = this._infer(this.model.decompressor, input);
    const foot = { forward: p[0], height: p[1], lateral: p[2] };
    const reach = Math.hypot(foot.forward, foot.height, foot.lateral);
    if (reach > .99) {
      foot.forward *= .99 / reach; foot.height *= .99 / reach; foot.lateral *= .99 / reach;
    }
    return {
      id, phase: at, duration: clip.duration, contactPhase: clip.contactPhase,
      foot,
      freeLeg: {
        hip: [this._clamp(p[3], -1.5, 1.7), this._clamp(p[4], -1, 1), this._clamp(p[5], -.65, .65)],
        knee: [this._clamp(p[6], .08, 2.4), 0, 0],
        ankle: [this._clamp(p[7], -1.2, 1.2), this._clamp(p[8], -.5, .5), this._clamp(p[9], -.5, .5)],
      },
      activeKnee: [this._clamp(p[10], .08, 2.4), 0, 0],
      waist: [this._clamp(p[11], -.35, .35), this._clamp(p[12], -.35, .35), this._clamp(p[13], -.35, .35)],
      body: { axis: { ...clip.rotation.axis },
        angle: this._clamp(p[14], 0, clip.rotation.totalAngle), totalAngle: clip.rotation.totalAngle },
    };
  }

  advance(state, query, dt) {
    const index = this.index.get(state.id);
    if (index === undefined) throw new Error(`알 수 없는 발차기: ${state.id}`);
    const clip = this.clips[index];
    const phase = this._clamp(this._number(state.phase), 0, 1);
    const nominalTime = Math.max(0, (clip.contactPhase - phase) * clip.duration);
    const input = [0, 0, 0, 0, phase,
      this._clamp(this._number(query.timeToContact, nominalTime) / .8, 0, 1.25)];
    input[index] = 1;
    const rate = this._clamp(this._infer(this.model.stepper, input)[0], .5 / clip.duration, 1.5 / clip.duration);
    const elapsed = this._clamp(this._number(dt), 0, .05);
    state.phase = this._clamp(phase + rate * elapsed, 0, 1);
    state.age = this._number(state.age) + elapsed;
    state.rate = rate;
    return this.sample(state.id, state.phase);
  }
}

export { TakrawMotionMatcher };
