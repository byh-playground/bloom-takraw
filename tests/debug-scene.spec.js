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
async function settled(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await page.waitForTimeout(1500);
  return page.screenshot();
}

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
