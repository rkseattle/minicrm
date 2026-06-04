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
import {
  applyPseudoLocale,
  findHardcodedStrings,
  findOverflowingElements,
} from '@behaviors/minicrm/i18n.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

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
    await applyPseudoLocale({ page });

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

    const offenders = await findHardcodedStrings({ page });

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
    await applyPseudoLocale({ page });

    const overflowing = await findOverflowingElements({ page });

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
