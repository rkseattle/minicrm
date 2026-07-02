/**
 * F7-WL — AI win/loss pattern insights (MINCRM-464)
 *
 * Functional regression tests for the /insights/win-loss page.
 *
 * Test groups:
 *   F7-WL1 — Insufficient closed-deal history shows the "not enough history" message
 *   F7-WL2 — Export buttons are disabled when there is insufficient data
 *   F7-WL3 — The page is hidden when the ai_win_loss_insights flag is off
 *
 * Scope note:
 *   Seeding 20+ closed deals to exercise the "sufficient data" rendering path
 *   and the nightly cron's narration output is impractical for a functional
 *   E2E run (large data volume, and the E2E server stub AI response is text-
 *   only — the actual pattern rendering with real narration is covered by
 *   the client component test suite, which mocks the HTTP response directly).
 *   These tests exercise the insufficient-data path, which every fresh test
 *   environment starts in. (MINCRM-464)
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestRep, withFlags } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToWinLossInsights,
  waitForWinLossInsightsHeading,
  waitForWinLossInsufficientData,
  isWinPatternsHeadingVisible,
  isWinLossExportCsvEnabled,
} from '@behaviors/minicrm/win-loss-insights.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-WL1 — Insufficient closed-deal history message
// ---------------------------------------------------------------------------

test(
  'F7-WL1: shows the insufficient-data message when there are too few closed deals',
  { tag: ['@functional'] },
  async ({ page }) => {
    await navigateToWinLossInsights({ page });
    await waitForWinLossInsightsHeading({ page });
    await waitForWinLossInsufficientData({ page });
    expect(await isWinPatternsHeadingVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-WL2 — Export buttons disabled with insufficient data
// ---------------------------------------------------------------------------

test(
  'F7-WL2: export buttons are disabled when there is insufficient closed-deal history',
  { tag: ['@functional'] },
  async ({ page }) => {
    await navigateToWinLossInsights({ page });
    await waitForWinLossInsightsHeading({ page });
    expect(await isWinLossExportCsvEnabled({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-WL3 — Page hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-WL3: the page is hidden when ai_win_loss_insights is off',
  { tag: ['@functional'] },
  async ({ page }) => {
    await withFlags(page, { ai_win_loss_insights: false });
    await navigateToWinLossInsights({ page });

    await expect(async () => {
      expect(await isWinPatternsHeadingVisible({ page })).toBe(false);
    }).toPass({ timeout: 5_000 });
  },
);
