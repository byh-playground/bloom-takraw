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

test('소개영상 대본: 자막은 시드 36 랠리의 실제 사건 틱에 맞고 터치 화면은 조작 이름을 바꾼다', async () => {
  test.skip(!rapierPath, 'RAPIER_MODULE 필요');
  const { TakrawIntroScript } = await import('../src/presentation/intro-script.js');
  const { TAKRAW_INTRO } = await import('../src/config/intro.js');
  expect(TAKRAW_INTRO.seed).toBe(TAKRAW_RUNTIME.watch.showcaseSeed);
  const ticks = TAKRAW_INTRO.chapters.map(chapter => chapter.tick);
  expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  expect(TAKRAW_INTRO.chapters.at(-1).tick * 1000 / TAKRAW_INTRO.tickRate).toBeLessThan(TAKRAW_INTRO.durationMs - 3000);
  // 사건 틱: 서브 75, 스파이크 393, 받아내기 436, 득점 772. 자막은 사건 직전 틱에 바뀌어야 한다.
  const at = title => TAKRAW_INTRO.chapters.find(chapter => chapter.title.includes(title)).tick;
  expect(at('서브')).toBeGreaterThan(75 - 1); expect(at('발차기')).toBeLessThan(393); expect(at('받아내기')).toBeLessThan(436); expect(at('득점')).toBe(772);
  const mouse = new TakrawIntroScript().timeline(), touch = new TakrawIntroScript({ coarse: true }).timeline();
  expect(mouse).toHaveLength(1 + 2 * TAKRAW_INTRO.chapters.length);
  expect(JSON.stringify(mouse)).toContain('좌클'); expect(JSON.stringify(touch)).not.toContain('좌클'); expect(JSON.stringify(touch)).toContain('발차기 버튼');
  // 기다림 항목: 틱이 모자라면 false(호스트가 재시도), 닿으면 true.
  const script = new TakrawIntroScript(), win = { __takraw: { ready: true, game: { state: { tick: 100 } }, watch: seed => seed === 36 } };
  expect(script.run('watch', win)).toBe(true);
  expect(script.run('tick:335', win)).toBe(false);
  win.__takraw.game.state.tick = 335; expect(script.run('tick:335', win)).toBe(true);
  expect(script.run('watch', { __takraw: { ready: false } })).toBe(false);
});
