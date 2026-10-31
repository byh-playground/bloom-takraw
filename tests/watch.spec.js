import { test, expect } from 'playwright/test';
import { TAKRAW_CONFIG } from '../src/config/game.js';
import { TAKRAW_RUNTIME } from '../src/config/runtime.js';
import { TAKRAW_SCHOOLS, takrawWatchSchools } from '../src/config/schools.js';
import { TakrawGame } from '../src/simulation/game.js';

const rapierPath = process.env.RAPIER_MODULE;
const loadRapier = async () => { const loaded = await import(rapierPath); const RAPIER = loaded.default ?? loaded; await RAPIER.init(); return RAPIER; };

test('관전 학교: 시드가 같으면 같고 두 학교는 항상 다르며 모든 학교가 나온다', () => {
  const seen = new Set();
  for (let seed = 0; seed < 400; seed++) {
    const [a, b] = takrawWatchSchools(seed);
    expect(a.id).not.toBe(b.id);
    expect(takrawWatchSchools(seed).map(school => school.id)).toEqual([a.id, b.id]);
    seen.add(a.id); seen.add(b.id);
  }
  expect(seen.size).toBe(TAKRAW_SCHOOLS.length);
});

test('관전 경기: 소개영상 시드는 사람 입력이 있어도 같은 AI 랠리를 재현한다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const RAPIER = await loadRapier(), seed = TAKRAW_RUNTIME.watch.showcaseSeed;
  const play = async inputs => {
    const game = new TakrawGame({ RAPIER, config: structuredClone(TAKRAW_CONFIG) });
    game.reset('ai', undefined, seed);
    const touches = [];
    let point = null;
    for (let tick = 1; tick < 1000 && !point; tick++) {
      game.step({ tick, tickRate: 60, inputs: inputs(tick) });
      for (const event of game.events) {
        if (event.tick !== game.state.tick && event.tick !== tick) continue;
        if (event.type === 'touch') touches.push(tick);
        if (event.type === 'point') point = `${tick}:${event.team}`;
      }
    }
    game.dispose();
    return { touches, point };
  };
  const empty = await play(() => []);
  // 러닝 런타임은 로컬 플레이어 입력을 매 틱 보낸다. 관전 모드에서는 두 팀 모두 AI라 결과가 같아야 한다.
  const held = await play(() => [{ playerId: 'local', input: Uint8Array.of(127, 127, 3, 127, 127, 3), commands: [{ payload: Uint8Array.of(1) }] }]);
  expect(empty.point).toBe('772:1');
  expect(empty.touches).toHaveLength(10);
  expect(held).toEqual(empty);
});

test('소개영상 대본: 랠리 문구는 시드 36의 실제 사건 틱에 맞고, 시스템 소개는 득점 장이 보인 뒤에 나온다', async () => {
  const { TakrawIntroScript } = await import('../src/presentation/intro-script.js');
  const { TAKRAW_INTRO } = await import('../src/config/intro.js');
  expect(TAKRAW_INTRO.seed).toBe(TAKRAW_RUNTIME.watch.showcaseSeed);
  const timeline = new TakrawIntroScript().timeline();
  const timed = timeline.map(item => item.atMs);
  expect(timed).toEqual([...timed].sort((a, b) => a - b));
  expect(timed.at(-1)).toBeLessThan(TAKRAW_INTRO.durationMs - 2500);
  // 글은 장마다 한 줄이고 조작 장치 이름을 쓰지 않는다(조작은 영상 속 눌림 표시가 보여 준다).
  for (const chapter of TAKRAW_INTRO.chapters) {
    expect(chapter.title.length).toBeLessThanOrEqual(16);
    expect(chapter.title).not.toMatch(/좌클|우클|Space|W A S D|버튼|패드/);
  }
  // 사건 틱: 서브 75, 스파이크 393, 받아내기 436, 득점 772. 문구는 사건 직전 틱에 바뀌어야 한다.
  const at = id => TAKRAW_INTRO.chapters.find(chapter => chapter.id === id).tick;
  expect(at('serve')).toBeGreaterThan(75 - 1); expect(at('kick')).toBeLessThan(393); expect(at('dig')).toBeLessThan(436); expect(at('point')).toBe(772);
  // 시스템 소개 장(afterMs)은 틱 장 뒤에만 오고, 득점 장이 충분히 보인 뒤에 바뀐다.
  const firstAfter = TAKRAW_INTRO.chapters.findIndex(chapter => chapter.tick === undefined);
  expect(TAKRAW_INTRO.chapters.slice(firstAfter).every(chapter => chapter.tick === undefined && chapter.afterMs >= 2000)).toBe(true);
  expect(timeline).toHaveLength(1 + 2 * TAKRAW_INTRO.chapters.length);
  expect(timeline.filter(item => item.action === 'chapter').map(item => item.title)).toEqual(TAKRAW_INTRO.chapters.map(chapter => chapter.title));
  // 기다림 항목: 틱이 모자라면 false(호스트가 재시도), 닿으면 true. afterMs는 마지막으로 통과한 틱 기다림부터 잰다.
  let clock = 0;
  const script = new TakrawIntroScript({ now: () => clock }), win = { __takraw: { ready: true, game: { state: { tick: 100 } }, watch: seed => seed === 36 } };
  expect(script.run('watch', win)).toBe(true);
  expect(script.run('after:2200', win)).toBe(false);
  expect(script.run('tick:772', win)).toBe(false);
  win.__takraw.game.state.tick = 772; clock = 20000; expect(script.run('tick:772', win)).toBe(true);
  win.__takraw.game.state.tick = 3; // 관전이 랠리를 처음부터 다시 열어도 시스템 장은 계속된다
  clock = 22100; expect(script.run('after:2200', win)).toBe(false);
  clock = 22200; expect(script.run('after:2200', win)).toBe(true);
  expect(script.run('watch', { __takraw: { ready: false } })).toBe(false);
});

test('추천 경기: 라벨의 받아내기 횟수·터치 수가 그 시드의 첫 점 랠리와 같다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const RAPIER = await loadRapier();
  const labeled = TAKRAW_RUNTIME.watch.featured.filter(item => /^받아내기 \d+번 · \d+터치$/.test(item.label));
  expect(labeled.map(item => item.seed)).toEqual(expect.arrayContaining([27, 1013, 19]));
  for (const { seed, label } of labeled) {
    const game = new TakrawGame({ RAPIER, config: structuredClone(TAKRAW_CONFIG) });
    game.reset('ai', undefined, seed);
    const touches = [];
    for (let tick = 1; tick < 1500 && !game.state.score[0] && !game.state.score[1]; tick++) {
      game.step({ tick, tickRate: 60, inputs: [] });
      for (const event of game.events) if (event.type === 'touch') touches.push(event);
    }
    game.dispose();
    // 받아내기 = 스파이크 바로 다음 터치가 상대 팀인 경우.
    const received = touches.filter((event, index) => event.spike && touches[index + 1] && touches[index + 1].team !== event.team).length;
    expect(label, `시드 ${seed}`).toBe(`받아내기 ${received}번 · ${touches.length}터치`);
  }
});
