import { LinearPolicy, Policy } from '../core/policy.js';
import { Adam } from '../core/optimizer.js';
import { GaussianExploration } from '../core/exploration.js';
import { EmaBaseline } from '../core/baseline.js';
import { Reinforce } from '../core/reinforce.js';
import { TuningSpec } from '../takraw/tuning.js';

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * 접촉 하나를 앞둔 결정 시점의 정책 입력(SSOT). 모든 값이 우리 팀 방향 기준(깊이 +는 우리 코트 쪽)이라 좌우 팀이 같은 정책을 쓴다.
 * 이름 목록 NAMES가 곧 입력 길이이고, encode는 같은 순서로 값을 만든다.
 */
class MatchObservation {
  static get NAMES() {
    return Object.freeze(['편향', '서브권', '내 접촉 순서', '상대 스파이크', '상대 서브', '낙하 깊이', '낙하 좌우', '도착 시간', '공 속도',
      '공 높이', '선수-낙하점 거리', '세터', '공격수', '점수 차']);
  }
  static get size() { return MatchObservation.NAMES.length; }

  /** playerId: 이번 접촉을 맡을 선수(낙하 예상 지점에 가장 가까운 선수). */
  static encode(game, team, playerId) {
    const { state, config } = game, n = team === 0 ? 1 : -1, { halfLength, halfWidth } = config.court;
    const land = game.predictAtHeight(config.ai.receiveHeight), ball = game.physics.ball, p = ball.translation(), v = ball.linvel();
    const player = game.physics.players[playerId], at = player.root.translation();
    const play = state.play, incoming = play && play.team !== team;
    return Float64Array.of(
      1,
      state.serving === team ? 1 : 0,
      state.possession === team ? state.touches / config.rules.contacts : 0,
      incoming && play.kind === 'attack' ? 1 : 0,
      incoming && play.reason === 'serve' ? 1 : 0,
      clamp(-land.x * n / halfLength, -1, 1),
      clamp(land.z * n / halfWidth, -1, 1),
      clamp(land.time, 0, 2) / 2,
      clamp(Math.hypot(v.x, v.y, v.z) / 12, 0, 1.5),
      clamp(p.y / 4, 0, 1.5),
      clamp(Math.hypot(at.x - land.x, at.z - land.z), 0, 4) / 4,
      player.role === 'setter' ? 1 : 0,
      player.role === 'attacker' ? 1 : 0,
      clamp((state.score[team] - state.score[1 - team]) / 5, -1, 1),
    );
  }
}

/**
 * 경기 학습: 실제 경기의 접촉마다 팀 조정 값(TuningSpec)을 조금씩 흔들어 쓰고, 그 랠리를 이기면 그 방향으로 평균을 옮긴다.
 * 결정 단위는 접촉 하나(입력 MatchObservation), 보상 단위는 랠리 하나다. 보상은 득점 +1 / 실점 −1.
 * 정책은 선형 한 층이라 평균 조정 값 = 기본값에서의 이동량이다. 0에서 시작하므로 처음에는 규칙 AI와 같다.
 * 게임·저장소는 모르며 game.setTuning(team, values)만 쓴다(has-a: 정책·탐험·기준선·최적화기).
 */
class MatchLearning {
  static get defaults() { return Object.freeze({ learningRate: 0.02, sigma: 0.3, batchSize: 64, baselineDecay: 0.95 }); }

  constructor({ random = Math.random, options = {}, policy = null, spec = new TuningSpec() } = {}) {
    this.options = { ...MatchLearning.defaults, ...options };
    this.spec = spec;
    this.policy = new LinearPolicy(MatchObservation.size, spec.size);
    if (policy) this.policy.copyFrom(policy);
    this.algorithm = new Reinforce({
      policy: this.policy,
      exploration: new GaussianExploration({ sigma: this.options.sigma, random }),
      baseline: new EmaBaseline(this.options.baselineDecay),
      optimizer: new Adam({ learningRate: this.options.learningRate }),
    });
    this.batch = []; this.pending = []; this.rallies = 0; this.decisions = 0; this.wins = 0;
  }

  /** 저장된 base64 정책. 모양이 맞지 않으면 null이라 새로 시작한다. */
  static decode(text) {
    try {
      const policy = Policy.fromQuantized(fromBase64(text));
      return policy.layers.length === 1 && policy.inputSize === MatchObservation.size && policy.outputSize === new TuningSpec().size ? policy : null;
    } catch { return null; }
  }
  static encode(policy, bits = 4) { return toBase64(policy.toQuantized(bits)); }

  /** 접촉 하나의 결정: 입력을 읽고 탐험 표본을 뽑아 조정 값으로 돌려준다. 랠리가 끝날 때까지 기록해 둔다. */
  decide(game, team, playerId) {
    const sample = this.algorithm.sample(MatchObservation.encode(game, team, playerId));
    this.pending.push(sample);
    return this.spec.decode(sample.action, game);
  }

  /** 팀의 모든 접촉 결정에 이 학습기를 건다. 경기를 시작할 때 한 번 부른다. */
  attach(game, team) { game.setTuner(team, (g, playerId) => this.decide(g, team, playerId), { everyContact: true }); }

  /** 랠리 끝: 이 랠리의 모든 결정에 같은 보상(+1/−1)을 주고, 결정이 batchSize개 모일 때마다 정책을 한 번 갱신한다. */
  end(reward) {
    if (!this.pending.length) return;
    for (const sample of this.pending) this.batch.push({ ...sample, reward });
    this.decisions += this.pending.length; this.pending = []; this.rallies++; this.wins += reward > 0 ? 1 : 0;
    if (this.batch.length >= this.options.batchSize) { this.algorithm.update(this.batch); this.batch = []; }
  }

  /** 경기가 끝나면 조정기를 떼고 조정 값을 기본으로 되돌린다. */
  release(game, team) { game.setTuner(team, null); this.pending = []; }

  /** 학습하지 않고 평균 조정 값만 쓰는 조정기(경기 적용용). */
  static tuner(policy, team, spec = new TuningSpec()) {
    return (game, playerId) => spec.decode(policy.act(MatchObservation.encode(game, team, playerId)), game);
  }
}

/** 한 팀의 랠리 경계를 지켜보며 MatchLearning에 알린다. 매 step 뒤에 observe(game)를 부른다. */
class RallyObserver {
  constructor({ learner, team }) { this.learner = learner; this.team = team; this.previous = null; this.attached = false; }

  observe(game) {
    const phase = game.state.phase;
    if (!this.attached) { this.learner.attach(game, this.team); this.attached = true; }
    if (this.previous === 'rally' && phase !== 'rally') {
      this.learner.end(game.state.pointWinner === this.team ? 1 : -1);
      if (phase === 'finished') this.learner.release(game, this.team);
    }
    this.previous = phase;
  }
}

export { MatchObservation, MatchLearning, RallyObserver };
