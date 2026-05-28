/**
 * F10 — Pseudolocalization: hardcoded-string and layout-overflow detection
 *
 * Loads the dashboard in pseudo locale (client-side only via window.i18n) and
 * runs two assertion passes:
 *
 *   F10-PL1 — No plain ASCII text on testid-bearing elements.
 *             Any text that matches /^[A-Za-z][A-Za-z\s]{2,}$/ on an element
 *             with a data-testid is a hardcoded English string that bypassed t().
 *
 *   F10-PL2 — No horizontal overflow on key UI containers.
 *             Nav links, buttons, table headers, badge/card elements must not
 *             have scrollWidth > clientWidth.
 *
 * A full-page screenshot is saved to test-results/pseudoloc-dashboard.png for
 * human review in CI artifacts regardless of pass/fail.
 *
 * The pseudo locale is applied client-side only (page.evaluate) — it is not in
 * SUPPORTED_LOCALES and does not require any API call. MINCRM-241
 */

import * as path from 'path';
import * as fs from 'fs';
import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateToDashboard, createTestAdmin } from '@apps/minicrm/helpers.js';

test.use({ storageState: { cookies: [], origins: [] } });
import type { SafePage } from '@framework/types/safe-page.js';

// ---------------------------------------------------------------------------
// Browser-side evaluate functions
// These run inside page.evaluate() — types must not reference Node.js globals.
// Written as plain function expressions to avoid TypeScript DOM type errors
// in the Node-targeted qa tsconfig (lib: ["ES2022"]).
// ---------------------------------------------------------------------------

/**
 * Switches the running app to 'pseudo' locale via the exposed window.i18n handle.
 * Returns a string error message if the switch fails, null on success.
 */
const SWITCH_TO_PSEUDO = new Function(`
  const w = window;
  if (!w.i18n) return 'window.i18n is not defined — check main.tsx exposure';
  return w.i18n.changeLanguage('pseudo').then(() => null).catch((e) => String(e));
`) as () => Promise<string | null>;

/**
 * Walks all text nodes and returns those that:
 *   - Contain only plain ASCII Latin letters and spaces
 *   - Are longer than 3 characters
 *   - Have a nearest ancestor with a data-testid
 *
 * Excluded from the check (intentional non-translated content):
 *   - <option> elements — native locale names in language selectors are
 *     intentionally shown in their own script, not translated.
 *   - testids containing "-record-", "-subject-", "-time-" — user-entered
 *     data such as contact names and activity subjects are not translated.
 *
 * Returns an array of { testId, text } objects.
 */
const FIND_HARDCODED_STRINGS = new Function(`
  const PLAIN_ASCII_RE = /^[A-Za-z][A-Za-z\\s]{2,}$/;
  // Testid fragments that carry user-entered data rather than UI labels.
  const DATA_TESTID_RE = /-(record|subject|time)-/;
  const results = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) !== null) {
    const text = (node.textContent || '').trim();
    if (text.length <= 3) continue;
    if (!PLAIN_ASCII_RE.test(text)) continue;
    // Skip text inside <option> elements (native locale names).
    if (node.parentElement && node.parentElement.tagName === 'OPTION') continue;
    let el = node.parentElement;
    let testId = null;
    while (el && el !== document.body) {
      const tid = el.getAttribute('data-testid');
      if (tid) { testId = tid; break; }
      el = el.parentElement;
    }
    if (testId && !DATA_TESTID_RE.test(testId)) results.push({ testId, text });
  }
  return results;
`) as () => Array<{ testId: string; text: string }>;

/**
 * Queries key UI containers for horizontal overflow (scrollWidth > clientWidth).
 * Returns an array of { testId, text, scrollWidth, clientWidth } objects.
 */
const FIND_OVERFLOW_ELEMENTS = new Function(`
  const SELECTOR = 'nav a, button, th, [data-testid$="-badge"], [data-testid$="-card"]';
  const elements = Array.from(document.querySelectorAll(SELECTOR));
  return elements
    .filter((el) => el.scrollWidth > el.clientWidth)
    .map((el) => ({
      testId: el.getAttribute('data-testid') || el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 60),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
`) as () => Array<{ testId: string; text: string; scrollWidth: number; clientWidth: number }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function applyPseudoLocale(page: SafePage): Promise<void> {
  const err = await page.evaluate(SWITCH_TO_PSEUDO);
  if (err) throw new Error(`applyPseudoLocale: ${err}`);
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Pseudolocalization (MINCRM-241)', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test('@functional F10-PL1: no hardcoded ASCII strings on testid elements after pseudo locale switch', async ({
    page,
    restClient,
    testData,
  }) => {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToDashboard(page);
    await applyPseudoLocale(page);

    // Ensure test-results/ directory exists for the screenshot.
    const screenshotDir = path.resolve('test-results');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Take a full-page screenshot for human review regardless of pass/fail.
    await page.screenshot({
      path: path.join(screenshotDir, 'pseudoloc-dashboard.png'),
      fullPage: true,
    });

    const offenders = await page.evaluate(FIND_HARDCODED_STRINGS);

    if (offenders.length > 0) {
      const details = offenders.map((o) => `  [${o.testId}] "${o.text}"`).join('\n');
      console.error(`F10-PL1: Hardcoded ASCII strings found on testid elements:\n${details}`);
    }

    expect(
      offenders,
      `Expected no plain-ASCII text on testid elements in pseudo locale.\n` +
        `These strings are not going through t():\n` +
        offenders.map((o) => `  [${o.testId}] "${o.text}"`).join('\n'),
    ).toHaveLength(0);
  });

  test('@functional F10-PL2: no horizontal overflow on key UI containers after pseudo locale switch', async ({
    page,
    restClient,
    testData,
  }) => {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToDashboard(page);
    await applyPseudoLocale(page);

    const overflowing = await page.evaluate(FIND_OVERFLOW_ELEMENTS);

    if (overflowing.length > 0) {
      const details = overflowing
        .map(
          (o) =>
            `  [${o.testId}] "${o.text}" (scrollWidth=${o.scrollWidth}, clientWidth=${o.clientWidth})`,
        )
        .join('\n');
      console.error(`F10-PL2: Elements overflowing horizontally:\n${details}`);
    }

    expect(
      overflowing,
      `Expected no horizontal overflow in pseudo locale.\n` +
        `Overflowing elements:\n` +
        overflowing
          .map(
            (o) =>
              `  [${o.testId}] "${o.text}" (scrollWidth=${o.scrollWidth}, clientWidth=${o.clientWidth})`,
          )
          .join('\n'),
    ).toHaveLength(0);
  });
});
