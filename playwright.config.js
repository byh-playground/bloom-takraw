import { defineConfig } from 'playwright/test';

const baseURL = 'http://127.0.0.1:8766/';
export default defineConfig({
  testDir: './tests',
  testMatch: ['campaign.spec.js', 'joint-limits.spec.js', 'ai-brain.spec.js', 'sync.spec.js', 'receive-assist.spec.js', 'formation.spec.js', 'block.spec.js', 'quick-attack.spec.js', 'toss-spread.spec.js', 'set-assist.spec.js', 'user-serve.spec.js', 'dominant-foot.spec.js', 'user-flow.spec.js', 'mobile-flow.spec.js', 'watch.spec.js', 'reset-determinism.spec.js'],
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
