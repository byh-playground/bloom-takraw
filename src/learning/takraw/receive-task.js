import { Task } from '../core/task.js';
import { ReceiveObservation } from './observation.js';
import { TuningSpec } from './tuning.js';

/** 상대 스파이크를 받는 장면. 값은 장면 표본과 판정의 유일한 정의다. */
const RECEIVE_SCENE = Object.freeze({
  defender: 1, attacker: 2, team: 0, speed: [4, 9], maxSeconds: 4, tickRate: 60,
  landing: { x: [-1.4, 1.4], z: [-1.2, 1.2], y: 0.75 }, from: { x: [0.5, 1.6], y: [2.7, 3.5], zSpread: 1.5 },
  minApex: 2.0, netMargin: 0.1, allyReachSlack: 0.8,
});
const IDLE_INPUT = new Uint8Array(6);

/**
 * 규칙 AI가 받는 스파이크 장면에서 팀 조정 값을 학습하는 과제.
 * 에피소드마다 새 게임을 만든다: reset으로 재사용한 게임은 이전 장면의 물리 상태가 남아 결과가 달라진다.
 */
class ReceiveTask extends Task {
  constructor({ createGame, spec = new TuningSpec(), scene = RECEIVE_SCENE }) {
    super();
    Object.assign(this, { createGame, spec, scene });
  }

  static mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /** chooseAction이 null이면 조정 없이 규칙 AI 그대로 돌린다. */
  rollout(seed, chooseAction = null) {
    const game = this.createGame();
    try { return this._run(game, seed, chooseAction); } finally { game.dispose(); }
  }

  _run(game, seed, chooseAction) {
    const sc = this.scene, random = ReceiveTask.mulberry32(seed * 7919 + 13), U = ([lo, hi]) => lo + (hi - lo) * random();
    const frame = tick => ({ tick, tickRate: sc.tickRate, inputs: [{ playerId: 'learn', input: IDLE_INPUT, commands: [] }] });
    game.reset('training'); game.isolated = true;
    let tick = 0;
    while (game.state.phase !== 'rally' && tick < 400) game.step(frame(tick++));
    const physics = game.physics, g = Math.abs(physics.settings.gravity), home = physics.players[sc.defender].home;
    const netTop = game.config.court.netHeight + physics.settings.ballRadius;
    let landing, from, velocity;
    for (let attempt = 0; attempt < 40; attempt++) {
      landing = { x: home.x + U(sc.landing.x), y: sc.landing.y, z: home.z + U(sc.landing.z) };
      from = { x: U(sc.from.x), y: U(sc.from.y), z: landing.z + U([-sc.from.zSpread, sc.from.zSpread]) };
      const speed = U(sc.speed), d = { x: landing.x - from.x, y: landing.y - from.y, z: landing.z - from.z };
      let best = 0.5, bestError = Infinity;
      for (let t = 0.2; t <= 1.0; t += 0.01) {
        const error = Math.abs(Math.hypot(d.x / t, (d.y + 0.5 * g * t * t) / t, d.z / t) - speed);
        if (error < bestError) { bestError = error; best = t; }
      }
      velocity = { x: d.x / best, y: (d.y + 0.5 * g * best * best) / best, z: d.z / best };
      const toNet = -from.x / velocity.x, atNet = from.y + velocity.y * toNet - 0.5 * g * toNet * toNet;
      if (atNet >= netTop + sc.netMargin) break;
    }
    physics.resetBall(from, velocity);
    Object.assign(game.state, { lastTouch: 3, possession: 1, touches: 1 }); // 상대가 방금 공을 쳤다
    const obs = ReceiveObservation.encode(game, sc.defender);
    const choice = chooseAction ? chooseAction(obs) : null;
    if (choice) game.setTuning(sc.team, this.spec.decode(choice.action, game));

    const start = tick, limit = start + sc.maxSeconds * sc.tickRate;
    let touched = false, settled = false, closest = Infinity, ended = null;
    while (tick < limit && !settled) {
      game.step(frame(tick++));
      const b = physics.ball.translation(), s = physics.players[sc.defender].root.translation();
      if (!touched) closest = Math.min(closest, Math.hypot(b.x - s.x, b.y - 0.6, b.z - s.z));
      for (const e of game.events) if (e.type === 'touch' && e.playerId === sc.defender) touched = true;
      if (game.state.phase !== 'rally') { ended = game.state.pointReason || ''; break; }
      if (touched && physics.ball.linvel().y <= 0 && b.y > 1.2) settled = true;
    }
    const result = { ...(choice ?? { action: null }), seed, obs, nextObs: null, done: true, ticks: tick - start }; // 결정이 한 번뿐인 과제
    if (!touched) return { ...result, success: false, code: 'no_touch', reward: 0.1 * Math.max(0, Math.min(1, 1 - closest / 3)) };
    if (!settled) return { ...result, success: false, code: 'foul/lost', reason: ended, reward: /네트/.test(ended || '') ? -0.5 : -0.3 };
    return { ...result, ...this._judge(game) };
  }

  /** 접촉 뒤 공이 정점에 오른 시점의 판정: 우리 코트 안쪽에 충분히 높게 떨어지고 동료가 닿을 수 있어야 성공이다. */
  _judge(game) {
    const sc = this.scene, physics = game.physics, court = game.config.court, b = physics.ball.translation();
    const land = game.predictAtHeight(game.config.ai.receiveHeight);
    const ownSide = b.x < -0.15 && land.reachable && land.x < -0.2;
    const inCourt = land.reachable && land.x > -court.halfLength && Math.abs(land.z) < court.halfWidth;
    const stance = game.approachPosition(sc.team, land, game.config.ai.toss.receiveOffset);
    let excess = 99;
    for (const ally of physics.players) {
      if (ally.team !== sc.team || ally.id === sc.defender) continue;
      const q = ally.root.translation(), d = Math.hypot(q.x - stance.x, q.z - stance.z);
      excess = Math.min(excess, Math.max(0, d - (ally.settings.movementSpeed * Math.max(0, land.time - 0.1) + sc.allyReachSlack)));
    }
    const high = b.y >= sc.minApex, success = ownSide && inCourt && high && excess === 0 && land.time > 0.3;
    const code = success ? 'connected' : !ownSide ? 'overpass' : !inCourt ? 'out' : !high ? 'low' : 'far';
    const quality = 0.5 * Math.max(0, Math.min(1, b.y / sc.minApex)) + 0.5 * Math.max(0, Math.min(1, 1 - excess / 3));
    return { success, code, reward: success ? 1 : !ownSide ? -0.2 : !inCourt ? 0.1 : 0.2 + 0.3 * quality };
  }
}

export { RECEIVE_SCENE, ReceiveTask };
