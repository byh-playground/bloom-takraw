/**
 * AI 선수 한 명의 행동 상태머신.
 *
 * 구조
 * - AiState(is-a): 상태 하나가 "어디에 서는가(target)"와 "들어올 때 한 번 정하는 값(enter)"을 소유한다.
 *   Ready · Cover · Receive 와 접근형 Attack · Set · Chase 가 서브클래스다.
 * - Temperament(has-a): 경기 시드·선수·랠리 번호로 정해지는 성향(반응 시간, 간격, 위치 흔들림). 경기마다 상황이 달라지는 원천이다.
 * - AiBrain: 매 AI 틱에 "지금 필요한 상태"를 구하고 전이 규칙(긴급 상태는 즉시, Ready→Cover는 반응 시간 뒤)을 적용한다.
 *
 * 현재 상태는 선수별 기록(record: { mode, since, pending, pendingSince, lane })에만 있다.
 * 기록은 순수 데이터라 스냅샷에 그대로 저장되고 롤백 때 복원된다. 같은 시드·입력이면 같은 상태열이 나온다(Math.random 없음).
 * 킥·점프 타이밍은 이 상태머신의 책임이 아니며 game.js가 상태 이름(mode)을 읽어 쓴다.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = ([min, max], t) => min + (max - min) * t;

/** 정수 값 여러 개를 섞어 [0, 1)을 만드는 결정론 해시. gamekit 모듈이 노드 시험에서 불러와지지 않아 시뮬레이션 쪽에 둔다. */
function seededUnit(...values) {
  let h = 0x9e3779b9;
  for (const value of values) {
    h = Math.imul(h ^ (Math.floor(value) | 0), 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** 문자열을 32비트 정수로 만든다(온라인 방 코드에서 경기 시드를 정할 때 쓴다). */
function seedFromText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

class Temperament {
  static validConfig(value) {
    const range = (array, minimum) => Array.isArray(array) && array.length === 2 &&
      Array.from(array).every(number => Number.isFinite(number) && number >= minimum) && array[0] <= array[1];
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 4 &&
      ['reaction', 'clearance', 'depth', 'lateral'].every(key => Object.hasOwn(value, key)) &&
      range(value.reaction, 0) && range(value.clearance, 0) &&
      Number.isFinite(value.depth) && value.depth >= 0 && Number.isFinite(value.lateral) && value.lateral >= 0;
  }
  /** personality는 경기 내내 같고(반응·간격), jitter는 랠리마다 바뀐다(위치 흔들림·옆 선택). */
  constructor(config, seed, playerId, rally) {
    const u = (...salt) => seededUnit(seed, playerId, ...salt);
    this.reaction = lerp(config.reaction, u(1));
    this.clearance = lerp(config.clearance, u(2));
    this.depth = (u(3, rally) * 2 - 1) * config.depth;
    this.lateral = (u(4, rally) * 2 - 1) * config.lateral;
    this.side = u(5, rally) < 0.5 ? -1 : 1;
  }
}

/** 공이 target 자리로 날아오는 선 위에서 x에 해당하는 z. */
function ballPathZ(ball, point, x) {
  const run = ball.x - point.x;
  const along = Math.abs(run) > 1e-3 ? clamp((ball.x - x) / run, 0, 1) : 1;
  return ball.z + (point.z - ball.z) * along;
}

class AiState {
  constructor(name, { urgent = true } = {}) { this.name = name; this.urgent = urgent; }
  enter() {}
  target() { throw new Error(`${this.name}: target 미구현`); }
}

/** 기본 자리에서 성향만큼 앞뒤·옆으로 선 자리. 대기와 보조(공격수·세터의 x)가 같이 쓴다. */
function stanceTarget({ player, game, temperament }) {
  const n = player.toward, { halfLength, halfWidth } = game.config.court;
  return {
    x: n * clamp(player.home.x * n + temperament.depth, -halfLength + 0.35, -0.6),
    z: clamp(player.home.z + temperament.lateral, -halfWidth + 0.25, halfWidth - 0.25),
  };
}

/**
 * 공이 아직 이 자리를 지나가기 전이고 도착 지점(aim)이 우리 쪽이면, 공 궤적에서 clearance 이상 떨어진 같은 쪽으로 비킨다.
 * 서 있던 쪽(z 부호)을 유지해 좌우로 흔들리지 않는다. 받는 선수가 아닌 모든 선수가 같은 규칙을 쓴다.
 */
function stepAsideFromBall(ctx, target) {
  const { player, ball, aim, game, temperament } = ctx, n = player.toward;
  if (!aim || ball.x * n <= target.x * n || aim.x * n > target.x * n) return target;
  const limit = game.config.court.halfWidth - 0.25, pathZ = ballPathZ(ball, aim, target.x);
  if (Math.abs(target.z - pathZ) >= temperament.clearance) return target;
  const here = player.root.translation().z - pathZ, side = Math.abs(here) > 0.05 ? Math.sign(here) : temperament.side;
  const z = pathZ + side * temperament.clearance;
  return { x: target.x, z: clamp(Math.abs(z) <= limit ? z : pathZ - side * temperament.clearance, -limit, limit) };
}

/** 공과 무관한 대기. */
class ReadyState extends AiState {
  constructor() { super('ready', { urgent: false }); }
  target(ctx) { return stepAsideFromBall(ctx, stanceTarget(ctx)); }
}

/** 동료가 받는 동안의 보조. 들어올 때 공 궤적의 어느 쪽에 설지 정하고 그 옆을 유지한다. */
class CoverState extends AiState {
  constructor() { super('cover', { urgent: false }); }
  enter({ player, ball, defense, temperament }, record) {
    const pathZ = ballPathZ(ball, defense.plan.point, player.home.x), here = player.root.translation().z;
    record.lane = Math.abs(here - pathZ) > 0.05 ? Math.sign(here - pathZ) : temperament.side;
  }
  target(ctx, record) {
    const { player, game, ball, defense, temperament } = ctx;
    if (player.role === 'attacker') return stepAsideFromBall(ctx, stanceTarget(ctx));
    if (player.role !== 'setter') return stepAsideFromBall(ctx, game.receiveCover(player, defense));
    const limit = game.config.court.halfWidth - 0.25, x = stanceTarget(ctx).x;
    const pathZ = ballPathZ(ball, defense.plan.point, x);
    // 공 길목(머리 높이)에 서면 맞는다. 궤적에서 clearance 이상 떨어진 같은 쪽을 유지하고, 코트 밖이면 반대쪽으로 바꾼다.
    let z = pathZ + record.lane * temperament.clearance;
    if (Math.abs(z) > limit) { record.lane = -record.lane; z = pathZ + record.lane * temperament.clearance; }
    return { x, z: clamp(z, -limit, limit) };
  }
}

/** 실제로 공을 받는 선수. 물리 계획이 정한 자리에 선다. */
class ReceiveState extends AiState {
  constructor() { super('receive'); }
  target({ defense }) { return { ...defense.plan.stance }; }
}

/** 공을 향해 다가서는 상태의 공통 부분. 자리는 aim에서 offset 떨어진 곳이다. */
class ApproachState extends AiState {
  offset() { throw new Error(`${this.name}: offset 미구현`); }
  target(ctx) { return ctx.game.approachPosition(ctx.team, ctx.aim, this.offset(ctx)); }
}
class AttackState extends ApproachState {
  constructor() { super('attack'); }
  offset({ game }) { return game.config.ai.toss.attack.offset; }
}
class SetState extends ApproachState {
  constructor() { super('set'); }
  offset({ game, team }) {
    const toss = game.config.ai.toss;
    return game.state.possession === team ? toss.receiveOffset : toss.incomingOffset;
  }
}
class ChaseState extends ApproachState {
  constructor() { super('chase'); }
  offset() { return 0.95; }
}

class AiBrain {
  constructor() {
    this.states = new Map([new ReadyState(), new CoverState(), new ReceiveState(), new AttackState(), new SetState(), new ChaseState()]
      .map(state => [state.name, state]));
  }

  static blankRecord() { return { mode: 'ready', since: 0, pending: null, pendingSince: 0, lane: 1 }; }

  /** 스냅샷의 상태 기록이 형식에 맞는지. */
  static validRecord(record) {
    return !!record && ['ready', 'cover', 'receive', 'attack', 'set', 'chase'].includes(record.mode) &&
      Number.isFinite(record.since) && Number.isFinite(record.pendingSince) && (record.lane === 1 || record.lane === -1) &&
      (record.pending === null || typeof record.pending === 'string');
  }

  /** ctx: { game, player, team, ball, aim, defense, active, highContact, setTarget, record, temperament, now } */
  wanted(ctx) {
    if (ctx.defense) return ctx.player === ctx.active ? 'receive' : 'cover';
    if (ctx.player === ctx.active) return ctx.highContact ? 'attack' : ctx.setTarget ? 'set' : 'chase';
    return 'ready';
  }

  /** 전이를 적용하고 현재 상태의 이름과 목표 자리를 돌려준다. */
  update(ctx) {
    const record = ctx.record, wanted = this.wanted(ctx), next = this.states.get(wanted);
    if (record.mode !== wanted) {
      // 긴급 상태(받기·공격·세트·추격)와 대기로 돌아가는 전이는 즉시. 대기→보조만 성향의 반응 시간 뒤에 한다.
      const delayed = !next.urgent && record.mode === 'ready';
      if (delayed && record.pending !== wanted) { record.pending = wanted; record.pendingSince = ctx.now; }
      if (!delayed || ctx.now - record.pendingSince >= ctx.temperament.reaction) {
        record.mode = wanted; record.since = ctx.now; record.pending = null;
        next.enter(ctx, record);
      }
    } else record.pending = null;
    const state = this.states.get(record.mode);
    return { mode: record.mode, target: state.target(ctx, record) };
  }
}

export { AiBrain, AiState, Temperament, seededUnit, seedFromText };
