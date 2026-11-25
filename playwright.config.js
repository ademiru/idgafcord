import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.js', fullyParallel: true,
  workers: 2, reporter: 'list', timeout: 20000,
  use: { channel: 'msedge', headless: true, viewport: { width: 1440, height: 960 }, locale: 'tr-TR', screenshot: 'only-on-failure' },
  outputDir: 'test-results',
});
