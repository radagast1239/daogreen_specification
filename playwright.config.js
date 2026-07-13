// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for daogreen-spec.
 *
 * Target is chosen via PLAYWRIGHT_BASE_URL (defaults to production).
 * The e2e suite is a READ-ONLY production smoke — it never writes data,
 * so it is safe to point at the live site.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
const BASE_URL = (
  process.env.PLAYWRIGHT_BASE_URL || 'https://spec.nikita-daogreen.ru'
).replace(/\/$/, '');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  /* Whole-test cap; individual steps set their own shorter timeouts. */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  /* HTML report (saved, not auto-opened) + concise console output. */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: BASE_URL,
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
    /* Diagnostics kept only when a test fails. */
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  /* Chromium only: production smoke is deterministic on one engine and
     matches the GitHub Actions run. Add firefox/webkit here if cross-browser
     coverage is needed later. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
