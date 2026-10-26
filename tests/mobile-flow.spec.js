import { test, expect } from 'playwright/test';
import { chromium } from 'playwright';

test('터치로 시작·이동·점프·킥 → 메뉴 → 회전·연습 → 퇴장', async ({}, testInfo) => {
  const browser = await chromium.launch({ headless: false,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const evidence = { environment: 'Windows Chromium 모바일 뷰포트·터치 에뮬레이션 (실물 휴대폰 아님)', stages: [], layouts: [] };
  const faults = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => faults.push(error.message));
    const cdp = await context.newCDPSession(page), fingers = new Map();
    async function down(id, selector, offset = 0) {
      const box = await page.locator(selector).boundingBox();
      fingers.set(id, { id, x: box.x + box.width / 2 + offset, y: box.y + box.height / 2, radiusX: 5, radiusY: 5 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...fingers.values()] });
    }
    async function up(id) {
      const released = fingers.get(id);
      fingers.delete(id);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [released] });
    }
    async function cancel() {
      fingers.clear(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    }
    async function neutral() {
      await expect.poll(() => page.evaluate(() => window.__takraw.diagnostics().input.slice(0, 3))).toEqual([0, 0, 0]);
      await expect(page.locator('.touch-actions .is-down')).toHaveCount(0);
    }
    async function layout(label, selectors) {
      const boxes = await page.evaluate(selectors => selectors.map(selector => {
        const b = document.querySelector(selector).getBoundingClientRect();
        return { selector, x: b.x, y: b.y, width: b.width, height: b.height };
      }), selectors);
      const viewport = page.viewportSize();
      for (const b of boxes) {
        expect(b.width, b.selector).toBeGreaterThanOrEqual(44);
        expect(b.height, b.selector).toBeGreaterThanOrEqual(44);
        expect(b.x, b.selector).toBeGreaterThanOrEqual(0);
        expect(b.y, b.selector).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, b.selector).toBeLessThanOrEqual(viewport.width + 1);
        expect(b.y + b.height, b.selector).toBeLessThanOrEqual(viewport.height + 1);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
          `${label}: ${a.selector} / ${b.selector}`).toBeFalsy();
      }
      evidence.layouts.push({ label, viewport, boxes });
    }
    await page.goto(testInfo.project.use.baseURL);
    await expect(page.locator('#start-match')).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('.home-touch-controls')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('mobile-home.png') });
    await page.locator('#start-match').tap();
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('#rally-status')).toHaveText('랠리 진행 중');
    const controls = ['#move-pad', '[data-touch="jump"]', '[data-touch="kick"]', '#pause-button'];
    await layout('390×844 경기', controls);
    const before = await page.evaluate(() => ({ ...window.__takraw.game.physics.players[2].root.translation() }));
    await down(1, '#move-pad', 32);
    await expect.poll(() => page.evaluate(() => window.__takraw.diagnostics().input.slice(0, 2).some(value => value !== 0))).toBeTruthy();
    await expect.poll(() => page.evaluate(() => {
      const v = window.__takraw.game.physics.players[2].root.translation(); return { x: v.x, z: v.z };
    })).not.toEqual({ x: before.x, z: before.z });
    await down(2, '[data-touch="jump"]'); await down(3, '[data-touch="kick"]');
    await expect.poll(() => page.evaluate(() => window.__takraw.diagnostics().input[2] & 3)).toBe(3);
    await expect.poll(() => page.evaluate(() => window.__takraw.game.physics.players[2].jump.active)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('mobile-multitouch.png') });
    await up(2);
    await expect(page.locator('[data-touch="kick"]')).toHaveClass(/is-down/);
    await down(4, '[data-touch="kick"]', -12); await up(3);
    await expect(page.locator('[data-touch="kick"]')).toHaveClass(/is-down/);
    await cancel(); await neutral();
    evidence.stages.push('실제 터치 이벤트로 이동·점프·킥 동시 조작, 일부 손가락 해제, 취소');

    await down(1, '#move-pad', 30); await down(2, '[data-touch="kick"]');
    await down(3, '#pause-button'); await up(3);
    await expect(page.locator('#dialog-panel')).toBeVisible();
    await cancel(); await neutral();
    await page.locator('#dialog-close').tap();
    await down(1, '#move-pad', 30);
    await page.setViewportSize({ width: 844, height: 390 });
    await cancel(); await neutral();
    await layout('844×390 경기', controls);
    await page.screenshot({ path: testInfo.outputPath('mobile-landscape.png') });
    await page.locator('#pause-button').tap(); await page.locator('[data-dialog-action="quit"]').tap();
    await page.locator('#start-training').tap();
    await expect(page.locator('#training-lesson option')).toHaveCount(5);
    await page.locator('#training-lesson').selectOption('scissors');
    await page.waitForFunction(() => window.__takraw.game.state.training?.lesson === 'scissors');
    // Watch actual unattended feeds: a usable set stays on our court until
    // the player attacks. Observe whole attempts, not just one upward sample.
    await page.evaluate(() => {
      const game = window.__takraw.game;
      window.__trainingFeeds = [];
      let attempt = null, seen = -1;
      function observe() {
        const state = game.state, training = state.training, ball = game.physics.ball.translation();
        if (state.phase === 'rally' && training.attempt !== seen) {
          seen = training.attempt; attempt = { number: seen, foot: false, set: false, crossed: false, peak: 0 };
        }
        if (attempt && state.phase === 'rally') {
          if (state.play?.from === 1) attempt.foot ||= /^foot/.test(state.play.part);
          attempt.set ||= training.setAt !== null;
          attempt.crossed ||= ball.x > game.physics.settings.ballRadius;
          attempt.peak = Math.max(attempt.peak, ball.y);
        }
        if (attempt && state.phase === 'point') { window.__trainingFeeds.push(attempt); attempt = null; }
        if (window.__trainingFeeds.length < 3) requestAnimationFrame(observe);
      }
      observe();
    });
    try {
      await page.waitForFunction(() => window.__trainingFeeds.length === 3, {}, { timeout: 25000 });
    } finally {
      evidence.trainingFeeds = await page.evaluate(() => window.__trainingFeeds);
      evidence.trainingState = await page.evaluate(() => ({ ...window.__takraw.game.state.training,
        phase: window.__takraw.game.state.phase, time: window.__takraw.game.state.time }));
    }
    expect(evidence.trainingFeeds.every(feed => feed.foot && feed.set && !feed.crossed && feed.peak >= 3.3)).toBeTruthy();
    await expect(page.locator('#training-sequence')).not.toContainText('좌클');
    await layout('844×390 연습', [...controls, '#training-lesson', '#training-reset']);
    await page.screenshot({ path: testInfo.outputPath('mobile-training-landscape.png') });
    await page.locator('#training-reset').tap();
    await page.setViewportSize({ width: 390, height: 568 });
    await layout('390×568 연습', [...controls, '#training-lesson', '#training-reset']);
    await page.screenshot({ path: testInfo.outputPath('mobile-training-short.png') });
    evidence.stages.push('팝업·화면 회전 입력 해제, 가로·짧은 세로 연습 선택과 재시도');
    await page.locator('#help-button').tap();
    await expect(page.locator('#dialog-content')).toContainText('왼쪽 패드');
    await expect(page.locator('#dialog-content')).not.toContainText('좌클');
    await page.locator('#dialog-close').tap();
    await page.locator('#pause-button').tap(); await page.locator('[data-dialog-action="quit"]').tap();
    await layout('390×568 홈', ['#start-match', '#start-training', '#start-local', '#open-network', '#open-club']);
    await page.screenshot({ path: testInfo.outputPath('mobile-home-short.png') });
    evidence.stages.push('터치 도움말 확인 → 메뉴 퇴장 → 짧은 화면 홈');
    expect(faults).toEqual([]);
  } finally {
    evidence.faults = faults;
    await testInfo.attach('mobile-flow-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await browser.close();
  }
});
