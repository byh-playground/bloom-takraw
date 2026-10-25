const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { root, outputDir, baseURL, ports } = require('./support.cjs');
const baseline = path.join(root, 'artifacts/baseline/index.html');
fs.mkdirSync(path.dirname(baseline), { recursive: true });
fs.writeFileSync(baseline, execFileSync('git', ['show', 'a01855b833ec5c09db6834e4c4ceeeb6d8088fd7:index.html'], { cwd: root, maxBuffer: 2 * 1024 * 1024 }));
const report = { baselineCommit: 'a01855b833ec5c09db6834e4c4ceeeb6d8088fd7', candidates: [] };
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + ports[0]);
  const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
  try {
    for (const [label, relative] of [['baseline', 'artifacts/baseline/index.html'], ['modules', ''], ['dist', 'dist/']]) {
      const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      const started = Date.now(); await page.goto(new URL(relative, baseURL).href); await page.waitForFunction(() => window.__takraw?.ready, {}, { timeout: 60000 });
      const bootMs = Date.now() - started;
      await page.screenshot({ path: path.join(outputDir, `${label}-home.png`) });
      const result = await page.evaluate(async () => {
        const source = __takraw.game; const game = new source.constructor({ RAPIER: source.physics.R, config: source.config });
        const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        const records = []; let stepMs = 0;
        try {
          game.reset('match');
          for (let tick = 0; tick < 1200; tick++) {
            if ([120, 450, 900].includes(tick)) game.load(game.save());
            const start = performance.now(); game.step({ tick, tickRate: 60, inputs: [] }); stepMs += performance.now() - start;
            if ([0, 119, 449, 899, 1199].includes(tick)) {
              const state = game.save(); const physics = game.physics.world.takeSnapshot(); delete state.physics.snapshot;
              records.push({ tick: tick + 1, physics: await hash(physics), metadata: await hash(new TextEncoder().encode(JSON.stringify(state))) });
            }
            if (tick % 30 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          }
          return { records, stepMs, diagnostics: __takraw.diagnostics(), resources: performance.getEntriesByType('resource').map(r => ({ name: r.name, transferSize: r.transferSize, duration: r.duration })) };
        } finally { game.physics.dispose(); }
      });
      assert.deepEqual(errors, []); report.candidates.push({ label, bootMs, ...result }); await page.close();
    }
    assert.deepEqual(report.candidates[1].records, report.candidates[0].records);
    assert.deepEqual(report.candidates[2].records, report.candidates[0].records);
    // A missing shared module must show an actionable error instead of an inert home screen.
    const failed = await context.newPage();
    await failed.route('**/rollback.js', route => route.abort());
    await failed.goto(baseURL);
    await failed.waitForFunction(() => document.getElementById('boot-message').textContent.includes('불러오지 못했어요'));
    assert.ok(await failed.locator('#reload-button').isVisible());
    report.dependencyFailureUI = true;
    const noWebGL = await context.newPage();
    await noWebGL.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return /webgl/i.test(type) ? null : original.call(this, type, ...args);
      };
    });
    await noWebGL.goto(baseURL);
    await noWebGL.waitForFunction(() => document.getElementById('boot-message').textContent.includes('WebGL2'));
    report.webglFailureUI = true; report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack; throw error; }
  finally { fs.writeFileSync(path.join(outputDir, 'refactor.json'), JSON.stringify(report, null, 2)); await context.close(); await browser.close(); }
  console.log('PASS baseline/module/dist: 1,200 ticks, post-restore physics and metadata, dependency failure UI');
})().catch(error => { console.error(error); process.exitCode = 1; });
