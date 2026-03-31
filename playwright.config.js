// @ts-check
// Playwright config for slope.html E2E tests.
//
// python3 http.server is used instead of `npx serve` because serve crashed
// mid-suite (ERR_CONNECTION_REFUSED after a few tests). Python's stdlib server
// is stable across all 36 tests.
//
// --use-gl=angle + --use-angle=swiftshader are required for WebGL in headless
// Chromium (MapLibre GL JS needs a GPU context).
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // workers=1: all tests share localStorage on the same origin (nanostores
  // persistence). Parallel workers cause race conditions on stored tracks.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8089',
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'python3 -m http.server 8089',
    port: 8089,
    reuseExistingServer: !process.env.CI,
  },
});
