import { LinearPolicy, Policy } from '../core/policy.js';
import { Adam } from '../core/optimizer.js';
import { GaussianExploration } from '../core/exploration.js';
import { EmaBaseline } from '../core/baseline.js';
import { Reinforce } from '../core/reinforce.js';
import { MATCH_TUNING, TuningSpec } from '../takraw/tuning.js';

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DOWN = /fall|recover|down/i;

/** 상대가 최근 스파이크를 보낸 곳의 이동평균(우리 팀 방향 기준 깊이·좌우, -1~1). 경기마다 0에서 다시 쌓는다. */
class OpponentHabit {
  constructor(rate = 0.3) { this.rate = rate; this.reset(); }
  reset() { this.depth = 0; this.lateral = 0; this.count = 0; }
  record(depth, lateral) {
    const rate = this.count === 0 ? 1 : this.rate;
    this.depth += (depth - this.depth) * rate; this.lateral += (lateral - this.lateral) * rate; this.count++;
  }
}

/**
 * 접촉 하나를 앞둔 결정 시점의 정책 입력(SSOT). 모든 값이 우리 팀 방향 기준(깊이 +는 우리 코트 쪽, 좌우는 팀 방향으로 뒤집음)이라 좌우 팀이 같은 정책을 쓴다.
 * NAMES가 곧 입력 길이이고 encode가 같은 순서로 값을 만든다.
 */
class MatchObservation {
  static get NAMES() {
    const players = prefix => [0, 1, 2].flatMap(k => [`${prefix} ${k} 깊이`, `${prefix} ${k} 좌우`]);
    return Object.freeze(['편향', '서브권', '내 접촉 순서', '상대 스파이크', '상대 서브', '낙하 깊이', '낙하 좌우', '도착 시간', '공 속도',
      '공 높이', '선수-낙하점 거리', '세터', '공격수', '점수 차',
      ...players('우리'), ...players('상대'),
      '상대 스파이크 깊이 평균', '상대 스파이크 좌우 평균',
      '내 점프 중', '내 쓰러짐', '우리 쓰러진 수', '상대 쓰러진 수']);
  }
  static get size() { return MatchObservation.NAMES.length; }
  static indexOf(name) { return MatchObservation.NAMES.indexOf(name); }

  /** playerId: 이번 접촉을 맡을 선수(낙하 예상 지점에 가장 가까운 선수). habit: OpponentHabit. */
  static encode(game, team, playerId, habit = new OpponentHabit()) {
    const { state, config } = game, n = team === 0 ? 1 : -1, { halfLength, halfWidth } = config.court;
    const land = game.predictAtHeight(config.ai.receiveHeight), ball = game.physics.ball, p = ball.translation(), v = ball.linvel();
    const player = game.physics.players[playerId], at = player.root.translation();
    const play = state.play, incoming = play && play.team !== team;
    const depth = x => clamp(-x * n / halfLength, -1.5, 1.5), lateral = z => clamp(z * n / halfWidth, -1.5, 1.5);
    const all = game.physics.players, mine = all.filter(q => q.team === team), theirs = all.filter(q => q.team !== team);
    const spot = list => list.flatMap(q => { const t = q.root.translation(); return [depth(t.x), lateral(t.z)]; });
    return Float64Array.of(
      1,
      state.serving === team ? 1 : 0,
      state.possession === team ? state.touches / config.rules.contacts : 0,
      incoming && play.kind === 'attack' ? 1 : 0,
      incoming && play.reason === 'serve' ? 1 : 0,
      depth(land.x), lateral(land.z),
      clamp(land.time, 0, 2) / 2,
      clamp(Math.hypot(v.x, v.y, v.z) / 12, 0, 1.5),
      clamp(p.y / 4, 0, 1.5),
      clamp(Math.hypot(at.x - land.x, at.z - land.z), 0, 4) / 4,
      player.role === 'setter' ? 1 : 0,
      player.role === 'attacker' ? 1 : 0,
      clamp((state.score[team] - state.score[1 - team]) / 5, -1, 1),
      ...spot(mine), ...spot(theirs),
      habit.depth, habit.lateral,
      player.jump.active ? 1 : 0,
      DOWN.test(player.state) ? 1 : 0,
      mine.filter(q => DOWN.test(q.state)).length / 2,
      theirs.filter(q => DOWN.test(q.state)).length / 3,
    );
  }
}

/**
 * 경기 학습: 실제 경기의 접촉마다 팀 조정 값(TuningSpec)을 조금씩 흔들어 쓰고, 보상을 받은 방향으로 평균을 옮긴다.
 * 결정 단위는 접촉 하나(입력 MatchObservation). 보상은 두 층이다.
 * - 랠리: 득점 +1 / 실점 −1을 그 랠리의 모든 결정에 준다.
 * - 접촉: 결정 뒤에 우리 팀 접촉이 이어지면 +auxWeight, 이어져야 했는데 끊기고 랠리를 지면 −auxWeight(받기·이어치기 성공 신호).
 * 정책은 선형 한 층이라 평균 조정 값 = 기본값에서의 이동량이다. 0에서 시작하므로 처음에는 규칙 AI와 같다.
 * 게임·저장소는 모르며 game.setTuner(team, 조정기)만 쓴다(has-a: 정책·탐험·기준선·최적화기·상대 습관).
 */
class MatchLearning {
  static get defaults() { return Object.freeze({ learningRate: 0.02, sigma: 0.3, batchSize: 64, baselineDecay: 0.95, auxWeight: 0.3 }); }

  constructor({ random = Math.random, options = {}, policy = null, spec = new TuningSpec(MATCH_TUNING) } = {}) {
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
    this.habit = new OpponentHabit();
    this.batch = []; this.pending = []; this.rallies = 0; this.decisions = 0; this.wins = 0;
  }

  /** 저장된 base64 정책. 모양이 맞지 않으면 null이라 새로 시작한다. */
  static decode(text) {
    try {
      const policy = Policy.fromQuantized(fromBase64(text));
      return policy.layers.length === 1 && policy.inputSize === MatchObservation.size && policy.outputSize === new TuningSpec(MATCH_TUNING).size ? policy : null;
    } catch { return null; }
  }
  static encode(policy, bits = 4) { return toBase64(policy.toQuantized(bits)); }

  /** 접촉 순서·소유를 한 문자열로. 같은 접촉인지 가린다. */
  static contactKey(game) { const { possession, touches, lastTouch } = game.state; return `${possession}:${touches}:${lastTouch}`; }

  /** 접촉 하나의 결정: 입력을 읽고 탐험 표본을 뽑아 조정 값으로 돌려준다. 랠리가 끝날 때까지 기록해 둔다. */
  decide(game, team, playerId) {
    const sample = this.algorithm.sample(MatchObservation.encode(game, team, playerId, this.habit));
    const { state, config } = game;
    // 상대 공이 오는 중이거나 우리 접촉이 3회 미만이면 우리 접촉이 이어져야 한다. 서브 결정과 3번째 접촉 뒤에는 기대가 없다.
    const expectOwn = state.lastTouch >= 0 && (state.possession !== team || state.touches < config.rules.contacts);
    this.pending.push({ ...sample, expectOwn, aux: 0, at: MatchLearning.contactKey(game) });
    if (state.play && state.play.team !== team && state.play.kind === 'attack') {
      this.habit.record(sample.obs[MatchObservation.indexOf('낙하 깊이')], sample.obs[MatchObservation.indexOf('낙하 좌우')]);
    }
    return this.spec.decode(sample.action, game);
  }

  /** 접촉이 일어났다: 그 접촉 전에 한 결정 중 "우리 접촉이 이어져야 했던 것"을 해결한다. */
  contact(game, team) {
    const key = MatchLearning.contactKey(game);
    for (const entry of this.pending) {
      if (!entry.expectOwn || entry.at === key) continue;
      if (team === this.team) entry.aux = this.options.auxWeight;
      entry.expectOwn = false;
    }
  }

  /** 팀의 모든 접촉 결정에 이 학습기를 건다. 경기를 시작할 때 한 번 부른다. */
  attach(game, team) {
    this.team = team; this.habit.reset();
    game.setTuner(team, (g, playerId) => this.decide(g, team, playerId), { everyContact: true });
  }

  /** 랠리 끝: 결정마다 랠리 보상(+1/−1)과 접촉 보상을 합쳐 모으고, 결정이 batchSize개 모일 때마다 정책을 한 번 갱신한다. */
  end(reward) {
    if (!this.pending.length) return;
    for (const entry of this.pending) {
      const dropped = entry.expectOwn && reward < 0 ? -this.options.auxWeight : 0;
      this.batch.push({ obs: entry.obs, mean: entry.mean, action: entry.action, reward: reward + entry.aux + dropped });
    }
    this.decisions += this.pending.length; this.pending = []; this.rallies++; this.wins += reward > 0 ? 1 : 0;
    if (this.batch.length >= this.options.batchSize) { this.algorithm.update(this.batch); this.batch = []; }
  }

  /** 경기가 끝나면 조정기를 떼고 조정 값을 기본으로 되돌린다. */
  release(game, team) { game.setTuner(team, null); this.pending = []; this.habit.reset(); }

  /** 학습하지 않고 평균 조정 값만 쓰는 조정기(경기 적용용). 상대 습관은 호출마다 새로 쌓는다. */
  static tuner(policy, team, spec = new TuningSpec(MATCH_TUNING)) {
    const habit = new OpponentHabit();
    return (game, playerId) => {
      const obs = MatchObservation.encode(game, team, playerId, habit), play = game.state.play;
      if (play && play.team !== team && play.kind === 'attack') habit.record(obs[MatchObservation.indexOf('낙하 깊이')], obs[MatchObservation.indexOf('낙하 좌우')]);
      return spec.decode(policy.act(obs), game);
    };
  }
}

/** 한 팀의 랠리·접촉 경계를 지켜보며 MatchLearning에 알린다. 매 step 뒤에 observe(game)를 부른다. */
class RallyObserver {
  constructor({ learner, team }) { this.learner = learner; this.team = team; this.previous = null; this.attached = false; this.contactKey = null; }

  observe(game) {
    const phase = game.state.phase;
    if (!this.attached) { this.learner.attach(game, this.team); this.attached = true; }
    if (phase === 'rally' && game.state.lastTouch >= 0) {
      const key = MatchLearning.contactKey(game);
      if (key !== this.contactKey) { this.contactKey = key; this.learner.contact(game, game.state.possession); }
    }
    if (this.previous === 'rally' && phase !== 'rally') {
      this.learner.end(game.state.pointWinner === this.team ? 1 : -1);
      this.contactKey = null;
      if (phase === 'finished') this.learner.release(game, this.team);
    }
    this.previous = phase;
  }
}

export { MatchObservation, OpponentHabit, MatchLearning, RallyObserver };
