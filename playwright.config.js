import { defineConfig } from 'playwright/test';

const baseURL = 'http://127.0.0.1:8766/';
export default defineConfig({
  testDir: './tests',
  testMatch: ['user-flow.spec.js', 'mobile-flow.spec.js'], // 고정 사용자 시나리오만 둔다(PM-009·PM-014)
  workers: 1,
  retries: 0,
  timeout: 150_000,
  globalTimeout: 170_000,
  expect: { timeout: 10_000 },
  outputDir: './artifacts/e2e',
  reporter: [['list'], ['json', { outputFile: './artifacts/e2e/report.json' }]],
  use: { baseURL, locale: 'ko-KR' }, // 시나리오의 문구 확인은 한국어 기준이다(docs/i18n.md).
  webServer: {
    command: 'node scripts/dev-server.cjs',
    url: baseURL,
    env: { PORT: new URL(baseURL).port },
    timeout: 15_000,
    reuseExistingServer: false,
  },
});
