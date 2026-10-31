import { test, expect } from 'playwright/test';

// 일반 주소는 sw.js를 등록하고 manifest·아이콘을 내준다. 격리 장면(?showcaseDemo=1)은 등록하지 않는다.
test('PWA: 일반 화면은 서비스 워커를 등록하고 manifest 아이콘을 읽는다', async ({ page }) => {
  await page.goto('/');
  const registration = await page.evaluate(async () => { const value = await navigator.serviceWorker.ready; return value.scope; });
  expect(registration).toBe(new URL('/', page.url()).href);
  const manifest = await page.evaluate(async () => {
    const value = await (await fetch(document.querySelector('link[rel=manifest]').href)).json();
    const sizes = [];
    for (const icon of value.icons) { const image = await createImageBitmap(await (await fetch(icon.src)).blob()); sizes.push(`${icon.purpose} ${image.width}x${image.height}`); }
    return { name: value.name, display: value.display, sizes };
  });
  expect(manifest).toEqual({ name: '블룸 발 배구', display: 'standalone', sizes: ['any 192x192', 'any 512x512', 'maskable 512x512'] });
});

test('PWA: 소개영상 격리 화면은 서비스 워커를 등록하지 않는다', async ({ page }) => {
  await page.goto('/?showcaseDemo=1');
  await page.waitForFunction(() => window.__takraw?.diagnostics?.().ready, null, { timeout: 60000 });
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});
