import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };
const hex = bytes => Buffer.from(bytes).toString('hex');

test('reset: 몇 번째 reset이든 새 인스턴스와 같은 경기·같은 저장 바이트를 만든다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const RAPIER = await loadRapier();
  const make = () => new TakrawGame({ RAPIER, config: structuredClone(TAKRAW_CONFIG) });
  const play = (game, seed, ticks = 600) => {
    game.reset('ai', undefined, seed);
    const trace = [];
    for (let tick = 1; tick <= ticks; tick++) {
      game.step({ tick, tickRate: 60, inputs: [] });
      for (const event of game.events) if ((event.tick === game.state.tick || event.tick === tick) && ['touch', 'point', 'serve'].includes(event.type)) trace.push(`${tick}:${event.type}:${event.team ?? ''}`);
    }
    const ball = game.physics.ball.translation();
    return `${trace.join(' ')} ${ball.x.toFixed(6)},${ball.y.toFixed(6)},${ball.z.toFixed(6)}`;
  };
  const expected = new Map([36, 27].map(seed => [seed, play(make(), seed)]));
  const reused = make();
  for (const seed of [36, 36, 27, 36, 27]) expect(play(reused, seed), `시드 ${seed}`).toBe(expected.get(seed));
  // 사용한 게임을 reset하면 처음 저장 상태(시계·월드 직렬화 포함)가 새 게임과 바이트까지 같다.
  const pristine = make(); pristine.reset('ai', undefined, 36);
  const used = make(); play(used, 5, 400); used.reset('ai', undefined, 36);
  const a = pristine.save(), b = used.save();
  expect(b.rallyStart).toBe(a.rallyStart); expect(b.physics.time).toBe(a.physics.time);
  expect(hex(b.physics.snapshot)).toBe(hex(a.physics.snapshot));
});

test('롤백 경로: 중간 저장→복원은 같은 게임이든 새 게임이든 이어서 돌린 결과와 같다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const RAPIER = await loadRapier();
  const make = () => new TakrawGame({ RAPIER, config: structuredClone(TAKRAW_CONFIG) });
  const step = (game, from, to) => {
    for (let tick = from; tick <= to; tick++) game.step({ tick, tickRate: 60, inputs: [] });
    const ball = game.physics.ball, p = ball.translation(), v = ball.linvel();
    return [p.x, p.y, p.z, v.x, v.y, v.z, ...game.physics.players.flatMap(player => { const r = player.root.translation(); return [r.x, r.y, r.z]; })].map(n => n.toFixed(9)).join(',');
  };
  const game = make(); game.reset('ai', undefined, 36); step(game, 1, 150);
  const snapshot = game.save(), continued = step(game, 151, 450);
  game.load(snapshot); expect(step(game, 151, 450)).toBe(continued);
  const other = make(); other.load(snapshot); expect(step(other, 151, 450)).toBe(continued);
});

test('시작 틱: 호스트가 넘기는 tick이 0이든 1이든 임의의 값이든 같은 시드는 같은 경기다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const RAPIER = await loadRapier();
  // 게임킷 세션은 틱 0부터, 시뮬레이션 도구는 틱 1부터 step을 부른다. AI 갱신 주기가 frame.tick에 묶이면 위상이 달라져 다른 경기가 된다.
  const play = (seed, firstTick) => {
    const game = new TakrawGame({ RAPIER, config: structuredClone(TAKRAW_CONFIG) });
    game.reset('ai', undefined, seed);
    const trace = [];
    for (let step = 1; step <= 1200 && !game.state.score[0] && !game.state.score[1]; step++) {
      game.step({ tick: firstTick + step - 1, tickRate: 60, inputs: [] });
      for (const event of game.events) if (['touch', 'point', 'serve'].includes(event.type)) trace.push(`${step}:${event.type}:${event.team ?? ''}`);
    }
    const spikes = game.metrics.spikes;
    game.dispose();
    return { trace: trace.join(' '), spikes };
  };
  for (const seed of [1013, 36, 19]) {
    const base = play(seed, 1);
    for (const firstTick of [0, 2, 37]) expect(play(seed, firstTick), `시드 ${seed} 시작 틱 ${firstTick}`).toEqual(base);
  }
  // 브라우저 관전(?watch=1013)이 노드와 달라 사용자가 "스파이크 한 번 못하고 끝난다"고 본 시드: 첫 점은 틱 831에 팀 0, 스파이크 5번이다.
  const watched = play(1013, 0);
  expect(watched.trace).toContain('831:point:0');
  expect(watched.spikes).toBe(5);
});
