import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e', testMatch: '**/*.e2e.mjs', timeout: 90_000, fullyParallel: false,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  reporter: [['line'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  outputDir: 'test-results/playwright-artifacts',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader'] }, ...devices['Desktop Chrome'] },
  webServer: { command: 'npm run dev -- --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 30_000 },
});
