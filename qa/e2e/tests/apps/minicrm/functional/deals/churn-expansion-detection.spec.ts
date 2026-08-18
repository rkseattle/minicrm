/**
 * F7-CE — AI churn and expansion signal detection
 *
 * Functional regression tests for the churn/expansion banner on the account
 * detail page, the in-app notification bell, and the /insights/churn-expansion page.
 *
 * Test groups:
 *   F7-CE1 — No banner is shown for an account with no active signal
 *   F7-CE2 — The banner is hidden when the flag is off
 *   F7-CE3 — The notification bell shows the empty state by default
 *   F7-CE4 — Insights page shows empty states when there are no active signals
 *   F7-CE5 — Insights page is hidden when the flag is off
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so detectChurnExpansionSignals bypasses
 *   the Anthropic SDK and never writes a signal row — every account stays
 *   signal-free. The banner/notification-rendering paths for an active
 *   signal are covered by the client component test suite (ChurnExpansionBanner.test.tsx,
 *   NotificationBell.test.tsx, ChurnExpansionInsightsPage.test.tsx), which
 *   mock the HTTP response directly — E2E cannot exercise it without real AI
 *   output.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestAccount,
  createTestRep,
  navigateToAccount,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  isChurnRiskBannerVisible,
  isExpansionSignalBannerVisible,
} from '@behaviors/minicrm/accounts.behaviors.js';
import {
  navigateToDashboardForNotifications,
  waitForNotificationBell,
  openNotificationDropdown,
  waitForNotificationEmptyState,
  isNotificationBadgeVisible,
} from '@behaviors/minicrm/notification-bell.behaviors.js';
import {
  navigateToChurnExpansionInsights,
  waitForChurnExpansionInsightsHeading,
  waitForAtRiskEmptyState,
  isChurnExpansionInsightsHeadingVisible,
} from '@behaviors/minicrm/churn-expansion-insights.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-CE1 — No banner for an account with no active signal
// ---------------------------------------------------------------------------

test(
  'F7-CE1: no churn/expansion banner is shown for an account with no active signal',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `CE1-Acct ${Date.now()}`,
    });

    await navigateToAccount(page, account.id);

    expect(await isChurnRiskBannerVisible({ page })).toBe(false);
    expect(await isExpansionSignalBannerVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-CE2 — Banner hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-CE2: the churn/expansion banner stays hidden when ai_churn_expansion_detection is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `CE2-Acct ${Date.now()}`,
    });

    await withFlags(page, { ai_churn_expansion_detection: false });
    await navigateToAccount(page, account.id);

    expect(await isChurnRiskBannerVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-CE3 — Notification bell empty state
// ---------------------------------------------------------------------------

test(
  'F7-CE3: the notification bell shows the empty state by default',
  { tag: ['@functional'] },
  async ({ page }) => {
    await navigateToDashboardForNotifications({ page });
    await waitForNotificationBell({ page });
    expect(await isNotificationBadgeVisible({ page })).toBe(false);

    await openNotificationDropdown({ page });
    await waitForNotificationEmptyState({ page });
  },
);

// ---------------------------------------------------------------------------
// F7-CE4 / F7-CE5 — Churn/expansion insights page
// ---------------------------------------------------------------------------

test(
  'F7-CE4: the churn/expansion insights page shows empty states with no active signals',
  { tag: ['@functional'] },
  async ({ page }) => {
    await navigateToChurnExpansionInsights({ page });
    await waitForChurnExpansionInsightsHeading({ page });
    await waitForAtRiskEmptyState({ page });
  },
);

test(
  'F7-CE5: the insights page is hidden when ai_churn_expansion_detection is off',
  { tag: ['@functional'] },
  async ({ page }) => {
    await withFlags(page, { ai_churn_expansion_detection: false });
    await navigateToChurnExpansionInsights({ page });

    await expect(async () => {
      expect(await isChurnExpansionInsightsHeadingVisible({ page })).toBe(false);
    }).toPass({ timeout: 5_000 });
  },
);
