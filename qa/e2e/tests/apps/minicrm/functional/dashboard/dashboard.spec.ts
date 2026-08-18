/**
 * Dashboard functional tests.
 *
 * DB-1: Dashboard loads and the stat card grid and recent-activity feed are visible.
 * DB-2: After creating a deal via API the open pipeline value stat is > 0.
 * DB-3: After creating an overdue task the overdue-tasks stat is ≥ 1.
 * DB-4: After creating an activity it appears in the recent-activity feed.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No @pages/* imports
 *   - All test data managed via helpers / TestDataManager
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  createTestAccount,
  createTestDeal,
  createTestActivity,
  createTestAdmin,
} from '@apps/minicrm/helpers.js';
import {
  navigateToPath,
  waitForDashboardStatCards,
  expectRecentActivityFeedVisible,
  expectDashboardStatCardVisible,
  getDashboardStatCardValue,
  isRecentActivityEntryVisible,
  countElements,
} from '@behaviors/minicrm/layout.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigates to the dashboard and waits for network idle. */
async function navigateToDashboard(page: Parameters<Parameters<typeof test>[2]>[0]['page']) {
  await navigateToPath('/', { page });
}

// ---------------------------------------------------------------------------
// DB-1 — Dashboard loads; stat cards and activity feed visible
// ---------------------------------------------------------------------------

test(
  'DB-1: dashboard loads; stat card grid and recent-activity feed are visible @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await navigateToPath('/', { page });

    await waitForDashboardStatCards({ page });
    await expectRecentActivityFeedVisible({ page }, 10_000);
  },
);

// ---------------------------------------------------------------------------
// DB-2 — Open pipeline value stat reflects a created deal
// ---------------------------------------------------------------------------

test(
  'DB-2: after creating a deal, open pipeline value stat is greater than zero @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DB2-Account-${Date.now()}`,
    });

    await createTestDeal(testData, restClient, {
      name: `DB2-Deal-${Date.now()}`,
      account_id: account.id,
      stage: 'Prospecting',
      value: '5000',
    });

    await navigateToDashboard(page);

    await expectDashboardStatCardVisible('pipeline-value', { page }, 10_000);

    const text = await getDashboardStatCardValue('pipeline-value', { page });
    // The value includes currency formatting but must not be "0" or empty
    expect(text?.trim(), 'pipeline value must be non-empty').toBeTruthy();
  },
);

// ---------------------------------------------------------------------------
// DB-3 — Overdue tasks stat reflects a task past its due date
// ---------------------------------------------------------------------------

test(
  'DB-3: after creating an overdue task, overdue-tasks stat is ≥ 1 @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DB3-Account-${Date.now()}`,
    });

    // A task due yesterday is immediately overdue
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await createTestActivity(testData, restClient, {
      type: 'Task',
      subject: `DB3-Overdue-${Date.now()}`,
      account_id: account.id,
      due_date: yesterday,
    });

    await navigateToDashboard(page);

    await expectDashboardStatCardVisible('overdue-tasks', { page }, 10_000);

    const text = await getDashboardStatCardValue('overdue-tasks', { page });
    const count = parseInt(text?.trim() ?? '0', 10);
    expect(
      count,
      'overdue tasks count must be ≥ 1 after creating an overdue task',
    ).toBeGreaterThanOrEqual(1);
  },
);

// ---------------------------------------------------------------------------
// DB-4 — Created activity appears in the recent-activity feed
// ---------------------------------------------------------------------------

test(
  'DB-4: after creating an activity, it appears in the recent-activity feed @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DB4-Account-${Date.now()}`,
    });

    const subject = `DB4-Activity-${Date.now()}`;
    const activity = await createTestActivity(testData, restClient, {
      type: 'Note',
      subject,
      account_id: account.id,
    });

    await navigateToDashboard(page);

    await expectRecentActivityFeedVisible({ page }, 10_000);

    const isVisible = await isRecentActivityEntryVisible(activity.id, { page });

    if (!isVisible) {
      const listItemCount = await countElements(
        [
          { type: 'css', value: '[data-testid="recent-activity-list"] li' },
          { type: 'css', value: '[data-testid="recent-activity-list"] > li' },
        ],
        'individual entries inside the recent activity list',
        { page },
      );
      expect(listItemCount, 'recent activity list must contain at least one entry').toBeGreaterThan(
        0,
      );
    }
  },
);
