import { test, expect } from 'playwright/test';
import { chromium } from 'playwright';
import { TAKRAW_RUNTIME } from '../src/config/runtime.js';
import { TakrawHighlight } from '../src/presentation/highlight.js';

const settings = { ...TAKRAW_RUNTIME.highlight, tickRate: 60 };
const touch = (tick, team, spike = false) => ({ type: 'touch', tick, team, spike });

/** 워커 없이 판정만 보는 기록기. record는 anchored일 때만 기록하므로 워커 자리에 빈 우편함을 둔다. */
function judging(overrides = {}) {
  const highlight = new TakrawHighlight({ ...settings, ...overrides }, {});
  highlight.anchored = true;
  highlight.worker = { postMessage() {} };
  return highlight;
}

function feed(highlight, tick, events = []) {
  highlight.record({ tick, tickRate: 60, inputs: [] }, { events, state: { tick } });
}

test('명장면 판정: 스파이크 결정타는 슬로가 붙고, 짧은 실책 득점은 고르지 않는다', () => {
  const spike = judging();
  feed(spike, 100, [{ type: 'serve', tick: 100 }]);
  [[130, 1], [170, 0], [200, 0], [230, 0, true]].forEach(([tick, team, hit]) => feed(spike, tick, [touch(tick, team, hit)]));
  feed(spike, 260, [{ type: 'ground', tick: 260 }, { type: 'point', tick: 260, team: 0 }]);
  expect(spike.pending).toEqual({ from: 170 - settings.leadTicks, to: 260 + settings.tailTicks, slowAt: 230, reason: 'spike' });

  const fault = judging();
  feed(fault, 100, [{ type: 'serve', tick: 100 }]);
  feed(fault, 130, [touch(130, 1)]);
  feed(fault, 200, [{ type: 'ground', tick: 200 }, { type: 'point', tick: 200, team: 0 }]);
  expect(fault.pending).toBeNull();
});

test('그림자 경기가 미리 가도 되는 틱은 그 뒤 어떤 득점의 재생 구간보다도 앞선다', () => {
  // 매번 다른 랠리(터치 간격·길이·스파이크 여부)를 만들어, 득점 전 모든 틱의 safeTick이 결국 정해진 from보다 작은지 본다.
  let random = 7;
  const next = () => (random = (random * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let rally = 0; rally < 300; rally++) {
    const highlight = judging({ longRallyTouches: 0 }), safe = [];
    let tick = 1;
    feed(highlight, tick, [{ type: 'serve', tick }]);
    const touches = 1 + Math.floor(next() * 14);
    for (let i = 0; i < touches; i++) {
      for (const end = tick + 10 + Math.floor(next() * 70); tick < end; tick++) { safe.push(highlight.safeTick(tick)); feed(highlight, tick); }
      feed(highlight, tick, [touch(tick, i % 2, next() < .3)]);
    }
    tick += 20;
    feed(highlight, tick, [{ type: 'ground', tick }, { type: 'point', tick, team: 0 }]);
    expect(Math.max(...safe)).toBeLessThan(highlight.pending.from);
  }
});

test('재생 시계: 스파이크 앞뒤는 느리게 흐르고 끝 장면을 받으면 끝난다', () => {
  const highlight = judging();
  const ticks = Array.from({ length: 101 }, (_, i) => ({ tick: 200 + i, selected: [2, 5], ballSpeed: 0 }));
  highlight.clip = { from: 200, to: 300, slowAt: 250, reason: 'spike', at: 200, ids: ['ball'], ticks, data: ticks.map(() => new Float32Array(8)), done: true, receivedAt: performance.now() };
  let frames = 0;
  while (highlight.advance(1 / 60) && frames < 1000) frames++;
  const slow = settings.slowBefore + settings.slowAfter;
  // 느린 구간은 slowRate 배속이라 그만큼 프레임을 더 쓴다.
  expect(frames).toBeGreaterThan(100 - slow + slow / settings.slowRate - 3);
  expect(frames).toBeLessThan(100 - slow + slow / settings.slowRate + 3);
  expect(highlight.playing).toBe(false);
});

test('워커 그림자 경기: 시작 상태 + 입력으로 다시 만든 공 위치가 실제 경기와 같고 0.5초 안에 첫 장면이 온다', async ({}, testInfo) => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  await page.goto('/');
  await page.waitForFunction(() => window.__takraw?.ready, null, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const deps = __takraw.diagnostics().dependencies;
    const loaded = await import(deps.rapier.url), RAPIER = loaded.default ?? loaded;
    await RAPIER.init();
    const { createValueCodec } = await import(deps['@bloom-gamekit/deterministic'].url);
    const { TakrawGame } = await import('/src/simulation/game.js');
    const { TAKRAW_CONFIG } = await import('/src/config/game.js');
    const { TAKRAW_RUNTIME } = await import('/src/config/runtime.js');
    const { TakrawHighlight } = await import('/src/presentation/highlight.js');
    const codec = createValueCodec();
    const live = new TakrawGame({ RAPIER, config: TAKRAW_CONFIG });
    live.reset('match', undefined, 2);
    // 모든 득점을 고르게 해 첫 득점을 재생한다. 판정 기준만 낮추고 계산 경로는 실제와 같다.
    const highlight = new TakrawHighlight({ ...TAKRAW_RUNTIME.highlight, tickRate: 60, longRallyTouches: 0 },
      { rapierUrl: deps.rapier.url, codecUrl: deps['@bloom-gamekit/deterministic'].url });
    const start = codec.encode(live.save()).slice();
    live.load(codec.decode(start));
    highlight.anchor(start);
    const balls = new Map();
    let begun = false;
    for (let tick = 0; tick < 3000 && !begun; tick++) {
      // 실제 경기처럼 사람 자리에 빈 입력이 들어온다.
      const frame = { tick, tickRate: 60, inputs: [{ playerId: 'local', input: new Uint8Array(6), commands: [] }] };
      live.step(frame);
      const view = live.getView(), ball = view.entities.find(entity => entity.id === 'ball');
      balls.set(tick, [ball.x, ball.y, ball.z].map(Math.fround));
      highlight.record(frame, view);
      begun = highlight.begin();
      if (tick % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const clip = highlight.clip;
    await new Promise((resolve, reject) => {
      const deadline = performance.now() + 20000;
      const wait = () => clip.done ? resolve() : performance.now() > deadline ? reject(new Error('worker did not finish')) : setTimeout(wait, 20);
      wait();
    });
    const index = clip.ids.indexOf('ball');
    const mismatched = clip.ticks.filter((frame, i) => {
      const expected = balls.get(frame.tick), got = Array.from(clip.data[i].slice(index * 8, index * 8 + 3));
      return !expected || expected.some((value, k) => value !== got[k]);
    }).map(frame => frame.tick);
    highlight.dispose(); live.dispose();
    return { begun, from: clip.from, to: clip.to, first: clip.ticks[0]?.tick, last: clip.ticks.at(-1)?.tick, count: clip.ticks.length, mismatched, latency: highlight.lastLatencyMs };
  });
  await browser.close();
  expect(result.begun).toBe(true);
  expect(result.first).toBe(result.from);
  expect(result.last).toBe(result.to);
  expect(result.count).toBe(result.to - result.from + 1);
  expect(result.mismatched).toEqual([]);
  expect(result.latency).toBeLessThan(500);
});
