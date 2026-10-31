import { test, expect } from 'playwright/test';
import { chromium } from 'playwright';

// 헤드리스 기본 설정은 WebGL을 켜지 못해 소프트웨어 렌더러를 명시한다.
const launch = () => chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// 확인용 주소(?debug=1&scene=…)가 같은 장면을 틱 단위로 재현하는지 본다.
async function open(page, query) {
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.__bloomDebug && (window.__bloomDebug.ready || window.__bloomDebug.error), null, { timeout: 60000 });
  return page.evaluate(() => ({ ready: __bloomDebug.ready, error: __bloomDebug.error, state: __bloomDebug.ready ? __bloomDebug.state() : null }));
}
// 유한 CSS 애니메이션은 끝 상태로, 무한 애니메이션은 시작 상태로 고정해 찍는다.
const settled = page => page.screenshot({ animations: 'disabled' });

test('관전 장면: 같은 시드·틱 주소는 같은 상태와 같은 화면을 만든다', async ({}, testInfo) => {
  const browser = await launch(), baseURL = testInfo.project.use.baseURL, shots = [];
  for (const query of ['seed=3&tick=120', 'seed=3&tick=120']) {
    const page = await browser.newPage({ baseURL, viewport: { width: 1000, height: 600 } });
    const result = await open(page, `debug=1&scene=watch&${query}`);
    expect(result.error).toBeNull();
    expect(result.state).toMatchObject({ scene: 'watch', params: { seed: '3' }, mode: 'watch', seed: 3 });
    expect(result.state.tick).toBe(Number(query.split('tick=')[1]));
    shots.push(await settled(page));
    await page.close();
  }
  await browser.close();
  expect(shots[0].equals(shots[1])).toBe(true);
});

test('관전 장면: 시드가 없으면 기본값으로 바뀌지 않고 실패한다', async ({}, testInfo) => {
  const browser = await launch(), page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  const noSeed = await open(page, 'debug=1&scene=watch&tick=10');
  expect(noSeed.ready).toBe(false);
  expect(noSeed.error).toContain('watch needs an integer seed');
  await browser.close();
});

test('클럽 장면: 시드·코인·뽑기 주소는 같은 팀을 만들고 실제 팀 저장은 건드리지 않는다', async ({}, testInfo) => {
  const browser = await launch(), context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1000, height: 700 } });
  const stored = async page => page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('bloom-takraw-club', 1);
    request.onsuccess = () => { const read = request.result.transaction('club').objectStore('club').get('my-team'); read.onsuccess = () => { resolve(read.result); request.result.close(); }; };
  }));
  const real = await context.newPage();
  await real.goto('/');
  await real.waitForFunction(() => window.__takraw?.diagnostics?.().club?.status === 'ready', null, { timeout: 60000 });
  const before = await stored(real);
  await real.close();
  const shots = [];
  for (let run = 0; run < 2; run++) {
    const page = await context.newPage();
    const result = await open(page, 'debug=1&scene=club&seed=7&credits=2000&draws=3');
    expect(result.error).toBeNull();
    expect(result.state).toMatchObject({ scene: 'club', status: 'ready', credits: 1100 });
    expect(result.state.roster).toHaveLength(6);
    shots.push(await settled(page));
    await page.close();
  }
  const check = await context.newPage();
  await check.goto('/');
  expect(await stored(check)).toEqual(before);
  const short = await open(check, 'debug=1&scene=club&seed=7&credits=100&draws=1');
  expect(short.error).toContain('뽑기에 200 C가 더 필요해요');
  await browser.close();
  expect(shots[0].equals(shots[1])).toBe(true);
});
