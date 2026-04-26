const { defineConfig } = require('@playwright/test');

/**
 * Mobile viewport / UA approximating iPhone 17 class devices (Playwright has no "iPhone 17" preset yet).
 * @see https://playwright.dev/docs/emulation
 */
module.exports = defineConfig({
  testDir: 'tests/playwright',
  timeout: 120000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-iphone17-ish',
      use: {
        browserName: 'chromium',
        viewport: { width: 402, height: 874 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  ],
  webServer: {
    // Vite alone is enough for the client to boot; `npm run dev` can miss the URL probe if the API port is slow/blocked.
    command: 'npx vite --config client/vite.config.js --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
