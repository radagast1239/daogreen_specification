// @ts-check
import { test, expect } from '@playwright/test';

/**
 * READ-ONLY production smoke.
 *
 * Only performs GET navigations against the public site — never logs in,
 * submits forms, or mutates data. Safe to run against live production.
 *
 * Target host comes from PLAYWRIGHT_BASE_URL (see playwright.config.js).
 */
const BASE_URL = (
  process.env.PLAYWRIGHT_BASE_URL || 'https://spec.nikita-daogreen.ru'
).replace(/\/$/, '');

const SETTLE_MS = 1_500; // allow async requests to surface late console errors

/**
 * Expected auth noise: protected APIs answer 401 for an unauthenticated smoke.
 * ONLY 401 Unauthorized is tolerated. Any other console/page error
 * (403/404/500, JS exceptions, CORS, mixed content, …) still fails the test.
 */
function isExpected401(text) {
  const t = String(text);
  return (
    (/\b401\b/.test(t) || /unauthorized/i.test(t)) &&
    (/failed to load resource/i.test(t) ||
      /status of 401/i.test(t) ||
      /unauthorized/i.test(t))
  );
}

/**
 * Attach console + pageerror collectors that drop ONLY expected 401 noise.
 * @param {import('@playwright/test').Page} page
 * @returns {() => string[]} accessor for accumulated unexpected errors
 */
function collectUnexpectedErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isExpected401(text)) return;
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (err) => {
    if (isExpected401(err.message)) return;
    errors.push(`pageerror: ${err.message}`);
  });
  return () => errors;
}

test.describe('production smoke (read-only)', () => {
  test('/spec/ — main app shell loads', async ({ page }) => {
    const getErrors = collectUnexpectedErrors(page);

    const res = await page.goto(`${BASE_URL}/spec/`, {
      waitUntil: 'domcontentloaded',
    });
    expect(res, 'no HTTP response for /spec/ (network/VPN?)').toBeTruthy();
    expect(
      res.status(),
      `/spec/ should load with a 2xx/3xx status, got ${res && res.status()}`,
    ).toBeLessThan(400);

    await expect(page, '/spec/ document title should contain "Daogreen"').toHaveTitle(
      /Daogreen/i,
    );
    await expect(
      page.locator('#root'),
      '/spec/ should mount the SPA root (#root)',
    ).toBeAttached();

    await page.waitForTimeout(SETTLE_MS);
    const errors = getErrors();
    expect(
      errors,
      `Unexpected console/page errors on /spec/ (401 ignored):\n${errors.join('\n')}`,
    ).toEqual([]);
  });

  /** Externally-migrated calculators — each is its own test surface. */
  const CALCULATORS = [
    { name: '/salad/', url: '/salad/calculator-110x55_12.html?from=spec' },
    { name: '/finmodel/', url: '/finmodel/calculator-110x55_12.html?from=spec' },
    { name: '/berry/', url: '/berry/' },
  ];

  for (const calc of CALCULATORS) {
    test(`${calc.name} — calculator loads`, async ({ page }) => {
      const getErrors = collectUnexpectedErrors(page);

      const res = await page.goto(`${BASE_URL}${calc.url}`, {
        waitUntil: 'domcontentloaded',
      });
      expect(
        res,
        `no HTTP response for ${calc.name} (network/VPN?)`,
      ).toBeTruthy();
      expect(
        res.status(),
        `${calc.name} should load with a 2xx/3xx status, got ${res && res.status()}`,
      ).toBeLessThan(400);

      // Real page, not an empty/error shell.
      await expect(
        page.locator('body'),
        `${calc.name} should render a visible <body>`,
      ).toBeVisible();
      const html = await page.content();
      expect(
        html.length,
        `${calc.name} returned a suspiciously small document (${html.length} bytes)`,
      ).toBeGreaterThan(500);

      await page.waitForTimeout(SETTLE_MS);
      const errors = getErrors();
      expect(
        errors,
        `Unexpected console/page errors on ${calc.name} (401 ignored):\n${errors.join('\n')}`,
      ).toEqual([]);
    });
  }
});
