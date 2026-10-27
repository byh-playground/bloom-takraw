import { LinearPolicy, Policy } from '../core/policy.js';
import { Adam } from '../core/optimizer.js';
import { GaussianExploration } from '../core/exploration.js';
import { EmaBaseline } from '../core/baseline.js';
import { Reinforce } from '../core/reinforce.js';
import { TuningSpec } from '../takraw/tuning.js';

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** 랠리 시작 때의 정책 입력(하나뿐). [편향 1, 우리 팀이 서브하는가]. 모든 값이 팀 방향과 무관하다. */
class MatchObservation {
  static get size() { return 2; }
  static encode(game, team) { return Float64Array.of(1, game.state.serving === team ? 1 : 0); }
}

/**
 * 경기 학습: 실제 경기의 랠리마다 팀 조정 값(TuningSpec)을 조금씩 흔들어 쓰고, 랠리를 이기면 그 방향으로 평균을 옮긴다.
 * 학습 단위는 랠리 하나다(받는 장면이 아니라 경기에서 실제로 벌어진 상황 전체). 보상은 득점 +1 / 실점 −1.
 * 정책은 선형 한 층이라 평균 조정 값 = 기본값에서의 이동량이다. 0에서 시작하므로 처음에는 규칙 AI와 같다.
 * 게임·저장소는 모르며 game.setTuning(team, values)만 쓴다(has-a: 정책·탐험·기준선·최적화기).
 */
class MatchLearning {
  static get defaults() { return Object.freeze({ learningRate: 0.02, sigma: 0.3, batchSize: 16, baselineDecay: 0.95 }); }

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
    this.batch = []; this.pending = null; this.rallies = 0; this.wins = 0;
  }

  /** 저장된 base64 정책. 모양이 맞지 않으면 null이라 새로 시작한다. */
  static decode(text) {
    try {
      const policy = Policy.fromQuantized(fromBase64(text));
      return policy.layers.length === 1 && policy.inputSize === MatchObservation.size && policy.outputSize === new TuningSpec().size ? policy : null;
    } catch { return null; }
  }
  static encode(policy, bits = 4) { return toBase64(policy.toQuantized(bits)); }

  /** 랠리 시작: 탐험 표본을 뽑아 team의 조정 값으로 적용한다. */
  begin(game, team) {
    this.pending = this.algorithm.sample(MatchObservation.encode(game, team));
    game.setTuning(team, this.spec.decode(this.pending.action, game));
  }

  /** 랠리 끝: 보상(+1/−1)을 모으고 batchSize마다 정책을 한 번 갱신한다. 시작 없이 끝나면 무시한다. */
  end(reward) {
    if (!this.pending) return;
    this.batch.push({ ...this.pending, reward });
    this.pending = null; this.rallies++; this.wins += reward > 0 ? 1 : 0;
    if (this.batch.length >= this.options.batchSize) { this.algorithm.update(this.batch); this.batch = []; }
  }

  /** 경기가 끝나면 조정을 기본으로 되돌린다. */
  release(game, team) { game.setTuning(team, null); this.pending = null; }

  /** 학습하지 않고 평균 조정 값만 쓰는 조정기(경기 적용용). */
  static tuner(policy, spec = new TuningSpec()) {
    return (game, team) => spec.decode(policy.act(MatchObservation.encode(game, team)), game);
  }
}

/** 한 팀의 랠리 경계를 지켜보며 MatchLearning에 알린다. 매 step 뒤에 observe(game)를 부른다. */
class RallyObserver {
  constructor({ learner, team }) { this.learner = learner; this.team = team; this.previous = null; }

  observe(game) {
    const phase = game.state.phase;
    if (this.previous !== 'rally' && phase === 'rally') this.learner.begin(game, this.team);
    else if (this.previous === 'rally' && phase !== 'rally') {
      this.learner.end(game.state.pointWinner === this.team ? 1 : -1);
      if (phase === 'finished') this.learner.release(game, this.team);
    }
    this.previous = phase;
  }
}

export { MatchObservation, MatchLearning, RallyObserver };
