import { test, expect } from 'playwright/test';
import { chromium } from 'playwright';
import { captureMetrics, replaySession } from './metrics.js';

test('클럽 저장·플레이·친구 입장·연결 복구·퇴장', async ({}, testInfo) => {
  const url = testInfo.project.use.baseURL;
  const browsers = [], pages = [], faults = [], sent = [];
  const evidence = { stages: [], checkpoints: [] };
  const stage = name => { evidence.stages.push(name); console.log(name); };
  async function connected() {
    await Promise.all(pages.map(page => expect(page.locator('#connection-indicator')).toContainText('친구와 연결됨', { timeout: 45000 })));
  }
  async function equalState(label) {
    const boundaries = await Promise.all(pages.map(page => page.evaluate(() => window.__takraw.session.confirmedTick)));
    const tick = Math.min(...boundaries) + 1;
    const hashes = await Promise.all(pages.map(page => page.evaluate(t => window.__takraw.session.getStateHash(t), tick)));
    expect(hashes.every(Number.isInteger)).toBeTruthy(); expect(hashes[0]).toBe(hashes[1]);
    evidence.checkpoints.push({ label, tick, hash: hashes[0] });
  }
  async function quit(page) {
    await page.locator('#pause-button').click();
    await page.locator('[data-dialog-action="quit"]').click();
    await expect(page.locator('#home-panel')).toBeVisible();
  }
  try {
    for (let i = 0; i < 2; i++) {
      const browser = await chromium.launch({ headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--window-position=${i * 650},20`] });
      browsers.push(browser);
      const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
      sent.push(await captureMetrics(context));
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', error => faults.push(error.message));
      await page.goto(url);
      await expect(page.locator('#start-match')).toBeEnabled({ timeout: 30000 });
    }
    evidence.browser = browsers[0].version();
    const [host, guest] = pages;
    evidence.renderer = await host.evaluate(() => {
      const gl = window.__takraw.view.renderer.getContext();
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : 'not exposed';
    });
    stage('홈 → 클럽 이름 저장 → 새로고침으로 복구');
    await host.locator('#open-club').click();
    await host.locator('[data-club-action="rename-edit"]').click();
    await host.locator('#club-name').fill('새싹 세팍 클럽');
    await host.locator('#club-name').press('Enter');
    await expect(host.locator('#dialog-content')).toContainText('새싹 세팍 클럽');
    await host.reload();
    await expect(host.locator('#dialog-content')).toContainText('새싹 세팍 클럽');
    await host.locator('#dialog-close').click();

    stage('AI 경기 시작 → 메뉴에서 퇴장 → 훈련');
    await Promise.all(pages.map(async page => { await page.locator('#open-start').click(); await page.locator('#start-match').click(); }));
    await Promise.all(pages.map(page => expect(page.locator('#rally-status')).not.toHaveText('')));
    await Promise.all(pages.map(quit));
    await host.locator('#open-start').click(); await host.locator('#start-training').click();
    await host.locator('#training-lesson').selectOption('scissors');
    await expect(host.locator('#training-lesson')).toHaveValue('scissors');
    await expect(host.locator('#training-stage')).not.toHaveText('');
    await quit(host);

    stage('친구에게 방 코드 전달 → 실제 Nostr/WebRTC 입장');
    await host.locator('#open-start').click(); await host.locator('#open-multi').click(); await host.locator('#open-network').click();
    await host.locator('[data-dialog-action="host"]').click();
    await expect(host.locator('#room-code')).toHaveValue(/^\d{4}$/, { timeout: 30000 });
    await host.locator('.network-debug summary').click();
    await expect(host.locator('#network-log')).toContainText('session-open');
    const code = await host.locator('#room-code').inputValue();
    await guest.locator('#open-start').click(); await guest.locator('#open-multi').click(); await guest.locator('#open-network').click(); await guest.locator('#room-input').fill(code);
    await guest.locator('[data-dialog-action="join"]').click(); await connected();
    await expect(host.locator('#rally-status')).toHaveText('랠리 진행 중');
    await equalState('입장');
    await guest.locator('canvas').focus(); await guest.keyboard.down('a');
    await guest.waitForTimeout(250); await guest.keyboard.up('a');
    await host.waitForTimeout(500); await equalState('양쪽 입력 반영');

    stage('실제 RTC 단절 → 자동 재연결');
    // Fault injection closes the real connection; gameplay and signaling remain real.
    await guest.evaluate(() => { for (const peer of window.__takraw.session.room.peerConnections.values()) peer.close(); });
    await expect(host.locator('#connection-indicator')).toContainText('연결이 끊겨');
    await connected(); await host.waitForTimeout(500); await equalState('RTC 복구');

    for (const [label, page] of [['참가자', guest], ['방장', host]]) {
      stage(`${label} 새로고침 → 기존 경기 재접속`);
      const before = await page.evaluate(() => ({ id: window.__takraw.session.localPlayerId, tick: window.__takraw.session.tick }));
      await page.reload(); await connected();
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({ id: window.__takraw.session.localPlayerId, tick: window.__takraw.session.tick }));
      expect(after.id).toBe(before.id); expect(after.tick).toBeGreaterThanOrEqual(before.tick - 24);
      await equalState(label + ' 복귀');
    }
    stage('온라인 경기 기록(재접속 구간 포함)을 새 게임에서 다시 계산');
    evidence.replays = await Promise.all(pages.map(replaySession));
    expect(evidence.replays.every(segments => segments.length > 0 && segments.every(segment => segment.same))).toBeTruthy();
    await host.screenshot({ path: testInfo.outputPath('online-host.png') });
    await guest.screenshot({ path: testInfo.outputPath('online-guest.png') });
    evidence.final = await Promise.all(pages.map(page => page.evaluate(() => window.__takraw.diagnostics())));
    expect(evidence.final.every(d => !d.failed && !d.errors.length && d.session.hashMismatches === 0)).toBeTruthy();

    stage('양쪽 명시적 퇴장 → 새로고침 후 자동 재입장 없음');
    for (const page of pages) {
      await quit(page); await page.reload();
      await expect(page.locator('#start-match')).toBeEnabled();
      await expect(page.locator('#home-panel')).toBeVisible();
      expect(await page.evaluate(() => window.__takraw.diagnostics().mode)).toBeNull();
    }
    stage('지표: 운영 서버 대신 가로챈 배치에 행동 이벤트');
    // 마지막 새로고침의 숨김 전송까지 받는다.
    await expect.poll(() => sent[0].events()).toEqual(expect.arrayContaining(['menu:match:click', 'match:match:start',
      'match:match:quit', 'menu:training:click', 'match:training:start', 'online:host:click', 'match:online:start']));
    await expect.poll(() => sent[1].events()).toEqual(expect.arrayContaining(['online:join:click', 'match:online:start']));
    evidence.metrics = sent.map(capture => ({ batches: capture.batches.length, events: capture.events() }));
    expect(sent.every(capture => capture.batches.every(batch => batch.game === 'bloom-takraw'))).toBeTruthy();
    // 세션 시작에는 게임이 고른 언어, 구간으로 내린 화면 크기, 주 입력(마우스)이 붙는다. 정확한 크기는 보내지 않는다.
    const pageLocale = await pages[0].evaluate(() => document.documentElement.lang);
    expect(sent[0].sessionStarts()[0]).toEqual({ locale: pageLocale, viewport: expect.stringMatching(/^\d+x\d+$/), touch: false });
    expect(faults).toEqual([]);
  } finally {
    evidence.faults = faults;
    await testInfo.attach('user-flow-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await Promise.all(browsers.map(browser => browser.close()));
  }
});
