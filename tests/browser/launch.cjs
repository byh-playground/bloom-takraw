const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../../scripts/dev-server.cjs');
const { root, ports, baseURL, outputDir } = require('./support.cjs');
const browsers = [];
const server = createServer(process.env.SERVE_DIR || root);
async function close() { await Promise.all(browsers.map(browser => browser.close())); server.close(); }
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(new URL(baseURL).port || 80), '127.0.0.1', resolve); });
  for (let i = 0; i < 2; i++) {
    const browser = await chromium.launch({ headless: false, args: [`--remote-debugging-port=${ports[i]}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--window-position=${i * 650},20`, '--window-size=960,800'] });
    browsers.push(browser);
    const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
    const page = await context.newPage();
    page.on('pageerror', error => fs.appendFileSync(path.join(outputDir, `browser-${i + 1}-errors.log`), error.stack + '\n'));
    await page.goto(baseURL);
    console.log('browser', i + 1, 'started');
  }
})().catch(async error => { console.error(error); await close(); process.exitCode = 1; });
