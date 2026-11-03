import { test, expect } from 'playwright/test';

// 영어 화면에 한국어가 남지 않는지 본다. 언어 선택 버튼의 "한국어"만 예외다(docs/i18n.md).
const HANGUL = /[가-힣]/;
const visibleHangul = page => page.evaluate(pattern => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), found = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement, text = node.textContent.trim();
    if (!text || !new RegExp(pattern).test(text) || element.closest('[lang="ko"]') || !element.getClientRects().length) continue;
    if (getComputedStyle(element).visibility === 'hidden') continue;
    found.push(text);
  }
  const attributes = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].flatMap(element =>
    ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name)).filter(value => value && new RegExp(pattern).test(value)));
  return [...found, ...attributes];
}, HANGUL.source);

async function boot(page, url) {
  const faults = [];
  page.on('pageerror', error => faults.push(error.message));
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => window.__takraw?.diagnostics().ready)).toBe(true);
  return faults;
}

test.describe('영어 화면', () => {
  test.use({ locale: 'en-US' });

  test('브라우저 언어가 영어면 처음 화면·설정·팀 관리·도장깨기·연습에 한국어가 없다', async ({ page }) => {
    const faults = await boot(page, '/');
    expect(await page.evaluate(() => [document.documentElement.lang, document.title])).toEqual(['en', 'Bloom Takraw']);
    await expect(page.locator('#open-start')).toContainText('Play');
    expect(await visibleHangul(page)).toEqual([]);

    await page.locator('#open-start').click();
    expect(await visibleHangul(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('#settings-button').click();
    await expect(page.locator('#dialog-title')).toHaveText('Settings');
    await expect(page.locator('[data-dialog-action="locale"][data-value="en"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await visibleHangul(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('#open-club').click();
    await expect(page.locator('#dialog-title')).toHaveText('My team');
    await expect(page.locator('.club-name-display span')).toHaveText('Bloom Club');
    await expect(page.locator('.club-card').first()).toBeVisible();
    expect(await visibleHangul(page)).toEqual([]);
    await page.locator('[data-club-action="tab"][data-value="draw"]').click();
    expect(await visibleHangul(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.goto('/#/campaign');
    await expect(page.locator('#dialog-title')).toHaveText('School Challenge');
    expect(await visibleHangul(page)).toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('#open-start').click();
    await page.locator('#start-training').click();
    await expect(page.locator('#training-cue')).not.toHaveText('');
    await page.waitForTimeout(1500);
    expect(await visibleHangul(page)).toEqual([]);
    expect(faults).toEqual([]);
  });

  test('설정에서 한국어를 고르면 저장하고 한국어로 다시 연다', async ({ page }) => {
    const faults = await boot(page, '/');
    await page.locator('#settings-button').click();
    await Promise.all([page.waitForURL(/lang=ko/), page.locator('[data-dialog-action="locale"][data-value="ko"]').click()]);
    await expect.poll(() => page.evaluate(() => window.__takraw?.diagnostics().ready)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ko');
    await expect(page.locator('#open-start')).toContainText('게임 시작');
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => window.__takraw?.diagnostics().ready)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ko'); // 저장한 선택이 브라우저 언어보다 먼저다
    expect(faults).toEqual([]);
  });
});
