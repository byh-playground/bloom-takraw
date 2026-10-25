import { defineConfig } from 'playwright/test';

const baseURL = 'http://127.0.0.1:8766/';
export default defineConfig({
  testDir: './tests',
  testMatch: 'user-flow.spec.js',
  workers: 1,
  retries: 0,
  timeout: 150_000,
  globalTimeout: 170_000,
  expect: { timeout: 10_000 },
  outputDir: './artifacts/e2e',
  reporter: [['list'], ['json', { outputFile: './artifacts/e2e/report.json' }]],
  use: { baseURL },
  webServer: {
    command: 'node scripts/dev-server.cjs',
    url: baseURL,
    env: { PORT: new URL(baseURL).port },
    timeout: 15_000,
    reuseExistingServer: false,
  },
});
