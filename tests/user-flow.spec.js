import { test, expect } from 'playwright/test';
import { chromium } from 'playwright';

test('클럽 저장·플레이·친구 입장·연결 복구·퇴장', async ({}, testInfo) => {
  const url = testInfo.project.use.baseURL;
  const browsers = [], pages = [], faults = [];
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

    stage('AI 경기 조작 → 메뉴에서 퇴장 → 훈련');
    await host.locator('#start-match').click();
    await expect(host.locator('#match-type')).toHaveText('AI 대전');
    stage('상대 AI의 리시브 → 세터 → 세 번째 스파이크가 네트를 넘음');
    await host.evaluate(() => {
      const game = window.__takraw.game;
      const witness = window.__teamPlayWitness = { contacts: [], completed: null };
      let seen = game.metrics.contacts, sequence = [], attack = null;
      function observe() {
        const state = game.state;
        if (game.metrics.contacts !== seen) {
          seen = game.metrics.contacts;
          const play = state.play;
          const contact = play && { rally: state.rally, team: play.team, number: state.touches,
            role: game.physics.players[play.from].role, player: play.from, kind: play.kind, part: play.part, tick: state.tick };
          if (contact) {
            witness.contacts.push(contact);
            if (contact.team !== 1 || contact.number === 1) { sequence = []; attack = null; }
            if (contact.team === 1) sequence.push(contact);
            if (sequence.length === 3 && sequence.every((c, i) => c.number === i + 1 && c.rally === contact.rally) &&
                sequence.map(c => c.role).join(',') === 'receiver,setter,attacker' &&
                contact.kind === 'attack' && /^foot/.test(contact.part)) attack = { ...contact, sequence: sequence.slice() };
          }
        }
        const ball = game.physics.ball.translation();
        if (attack && state.phase === 'rally' && state.rally === attack.rally && state.lastTouch === attack.player &&
            ball.x < -game.physics.settings.ballRadius && Math.abs(ball.z) <= game.config.court.halfWidth) {
          witness.completed = { ...attack, crossing: { ...ball }, velocity: { ...game.physics.ball.linvel() } };
          return;
        }
        requestAnimationFrame(observe);
      }
      observe();
    });
    await host.waitForFunction(() => window.__teamPlayWitness.completed, {}, { timeout: 45000 });
    evidence.threeTouchAttack = await host.evaluate(() => window.__teamPlayWitness.completed);
    await host.screenshot({ path: testInfo.outputPath('three-touch-attack.png') });
    await host.locator('canvas').focus(); await host.keyboard.press('Space');
    await expect(host.locator('#rally-status')).toHaveText('랠리 진행 중');
    await quit(host);
    await host.locator('#start-training').click();
    await host.locator('#training-lesson').selectOption('scissors');
    await expect(host.locator('#training-lesson')).toHaveValue('scissors');
    await expect(host.locator('#training-stage')).not.toHaveText('');
    await quit(host);

    stage('친구에게 방 코드 전달 → 실제 Nostr/WebRTC 입장');
    await host.locator('#open-network').click();
    await host.locator('[data-dialog-action="host"]').click();
    await expect(host.locator('#room-code')).toHaveValue(/^\d{4}$/, { timeout: 30000 });
    await host.locator('.network-debug summary').click();
    await expect(host.locator('#network-log')).toContainText('session-open');
    const code = await host.locator('#room-code').inputValue();
    await guest.locator('#open-network').click(); await guest.locator('#room-input').fill(code);
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
    expect(faults).toEqual([]);
  } finally {
    evidence.faults = faults;
    await testInfo.attach('user-flow-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    await Promise.all(browsers.map(browser => browser.close()));
  }
});
