/**
 * F10-WL — Win/Loss report accuracy
 *
 * Verifies that the Win/Loss report displays accurate counts, values, and win
 * rate for a controlled set of seeded deals, and that the date filter correctly
 * excludes deals outside the selected window.
 *
 * Parallel tests add deals to the team-wide report, so every exact count is scoped
 * to the test's own admin, who creates every deal it seeds: the API by owner_id,
 * the UI by its My View toggle, which sends the same filter.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through page objects
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestAccount,
  createTestAdmin,
  createTestDeal,
  withFlags,
  type EphemeralUserCredentials,
} from '@apps/minicrm/helpers.js';
import { loginAs, loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  applyWinLossMyViewDateRange,
  getWinLossReport,
  navigateToWinLossReport,
  waitForReportsLoadingHidden,
  expectReportsStatCardsVisible,
  selectReportsDatePreset,
  fillReportsCustomStartInput,
  fillReportsCustomEndInput,
  expectReportsWinLossHeadingVisible,
  getReportsWonCountText,
  getReportsLostCountText,
  expectReportsWinRateVisible,
  getReportsWinRateText,
  expectReportsTabListSelectHasValue,
} from '@behaviors/minicrm/reports.behaviors.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import type { RestClient } from '@framework/clients/rest-client.js';

test.use({ storageState: { cookies: [], origins: [] } });

/** The admin each test creates; deals are owned by their creator, so seeding as them scopes them. */
let testAdmin: EphemeralUserCredentials;

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  testAdmin = admin;
  await withFlags(page, { reporting: true });
  await loginViaBrowser(admin.email, admin.password, { page });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the first and last day of `now`'s calendar month as YYYY-MM-DD strings.
 *
 * A test reads the clock once and passes the same `now` to every helper, so a run that
 * crosses midnight at month-end cannot put "this month" and "last month" in one month.
 */
function currentMonthDateRange(now: Date): { start: string; end: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: fmt(firstDay), end: fmt(lastDay) };
}

/**
 * Returns the first day of the month before `now`'s as a YYYY-MM-DD string.
 */
function previousMonthFirstDay(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

/** Signs the REST client in as this test's admin, so the deals it seeds are theirs. */
async function seedAsTestAdmin(restClient: RestClient): Promise<void> {
  expect(await loginAs(restClient, testAdmin.email, testAdmin.password)).toBe(200);
}

/**
 * Waits for the Win/Loss report loading indicator to disappear and for the
 * stat cards container to become visible.
 */
async function waitForReportLoaded(page: PageFacade): Promise<void> {
  await waitForReportsLoadingHidden({ page }, 15_000);
  await expectReportsStatCardsVisible({ page }, 10_000);
}

/**
 * Applies a custom date range filter on the Win/Loss report page by selecting
 * the "custom" preset and filling in the start/end date inputs.
 */
async function applyCustomDateFilter(page: PageFacade, start: string, end: string): Promise<void> {
  await selectReportsDatePreset('custom', { page });
  await fillReportsCustomStartInput(start, { page });
  await fillReportsCustomEndInput(end, { page });
}

// ---------------------------------------------------------------------------
// F10-WL1 — report counts and win rate match seeded data
// ---------------------------------------------------------------------------

test(
  'F10-WL1: Win/Loss report shows correct won count, lost count, and win rate for seeded deals',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const { start, end } = currentMonthDateRange(new Date());
    await seedAsTestAdmin(restClient);

    const account = await createTestAccount(testData, restClient, {
      name: `WL1-Acct ${test.info().title}`,
    });

    // Seed 3 Closed Won deals and 2 Closed Lost deals within the current month
    for (let i = 0; i < 3; i++) {
      await createTestDeal(testData, restClient, {
        name: `WL1-Won-${i} ${test.info().title}`,
        stage: 'Closed Won',
        value: '10000',
        close_date: start,
        account_id: account.id,
      });
    }
    for (let i = 0; i < 2; i++) {
      await createTestDeal(testData, restClient, {
        name: `WL1-Lost-${i} ${test.info().title}`,
        stage: 'Closed Lost',
        value: '5000',
        close_date: start,
        account_id: account.id,
      });
    }

    await navigateToWinLossReport({ page });

    await expectReportsWinLossHeadingVisible({ page }, 10_000);

    await applyWinLossMyViewDateRange(start, end, testAdmin.userId, { page });
    await waitForReportLoaded(page);

    // The UI renders raw counts and Math.round(rate * 100) + "%": 3 won, 2 lost is 60%.
    expect(await getReportsWonCountText({ page })).toBe('3');
    expect(await getReportsLostCountText({ page })).toBe('2');
    expect(await getReportsWinRateText({ page })).toBe('60%');

    const ownWinLossReport = await getWinLossReport(restClient, start, end, testAdmin.userId);
    expect(ownWinLossReport.wonCount).toBe(3);
    expect(ownWinLossReport.lostCount).toBe(2);
    expect(ownWinLossReport.winRate).toBeCloseTo(0.6);
  },
);

// ---------------------------------------------------------------------------
// F10-WL2 — date filter excludes deals outside the selected window
// ---------------------------------------------------------------------------

test(
  'F10-WL2: date filter excludes a deal closed in the previous month',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const now = new Date();
    const { start: monthStart, end: monthEnd } = currentMonthDateRange(now);
    const prevMonthDate = previousMonthFirstDay(now);
    await seedAsTestAdmin(restClient);

    const account = await createTestAccount(testData, restClient, {
      name: `WL2-Acct ${test.info().title}`,
    });

    // One deal inside the current month
    await createTestDeal(testData, restClient, {
      name: `WL2-Current-Won ${test.info().title}`,
      stage: 'Closed Won',
      value: '1000',
      close_date: monthStart,
      account_id: account.id,
    });

    // One deal in the previous month — must not appear when filtering current month
    await createTestDeal(testData, restClient, {
      name: `WL2-Prev-Won ${test.info().title}`,
      stage: 'Closed Won',
      value: '9999',
      close_date: prevMonthDate,
      account_id: account.id,
    });

    await navigateToWinLossReport({ page });

    await applyWinLossMyViewDateRange(monthStart, monthEnd, testAdmin.userId, { page });
    await waitForReportLoaded(page);

    // Exactly one of this admin's two won deals falls in each window: the filter both
    // includes the in-month deal and excludes the previous month's.
    const report = await getWinLossReport(restClient, monthStart, monthEnd, testAdmin.userId);
    expect(report.wonCount).toBe(1);

    const prevReport = await getWinLossReport(
      restClient,
      prevMonthDate,
      prevMonthDate,
      testAdmin.userId,
    );
    expect(prevReport.wonCount).toBe(1);

    // The UI's current-month window shows the in-month deal and not the previous month's.
    expect(await getReportsWonCountText({ page })).toBe('1');
  },
);

// ---------------------------------------------------------------------------
// F10-WL3 — API endpoint returns same counts as the UI displays
// ---------------------------------------------------------------------------

test(
  'F10-WL3: API endpoint returns wonCount and lostCount matching the UI for seeded deals',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const { start, end } = currentMonthDateRange(new Date());
    await seedAsTestAdmin(restClient);

    const account = await createTestAccount(testData, restClient, {
      name: `WL3-Acct ${test.info().title}`,
    });

    const wonValue = '20000';
    const lostValue = '8000';
    const wonDeals: string[] = [];
    const lostDeals: string[] = [];

    for (let i = 0; i < 3; i++) {
      const deal = await createTestDeal(testData, restClient, {
        name: `WL3-Won-${i} ${test.info().title}`,
        stage: 'Closed Won',
        value: wonValue,
        close_date: start,
        account_id: account.id,
      });
      wonDeals.push(deal.id);
    }
    for (let i = 0; i < 2; i++) {
      const deal = await createTestDeal(testData, restClient, {
        name: `WL3-Lost-${i} ${test.info().title}`,
        stage: 'Closed Lost',
        value: lostValue,
        close_date: start,
        account_id: account.id,
      });
      lostDeals.push(deal.id);
    }

    await navigateToWinLossReport({ page });
    await applyWinLossMyViewDateRange(start, end, testAdmin.userId, { page });
    await waitForReportLoaded(page);

    const report = await getWinLossReport(restClient, start, end, testAdmin.userId);
    expect(report.wonCount).toBe(3);
    expect(report.lostCount).toBe(2);
    expect(await getReportsWonCountText({ page })).toBe(String(report.wonCount));
    expect(await getReportsLostCountText({ page })).toBe(String(report.lostCount));
  },
);

// ---------------------------------------------------------------------------
// F10-WL4 — mobile viewport: stat cards visible and win rate shown
// ---------------------------------------------------------------------------

test(
  'F10-WL4: Win/Loss report stat cards are visible on mobile viewport',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const { start, end } = currentMonthDateRange(new Date());

    const account = await createTestAccount(testData, restClient, {
      name: `WL4-Acct ${test.info().title}`,
    });

    await createTestDeal(testData, restClient, {
      name: `WL4-Won ${test.info().title}`,
      stage: 'Closed Won',
      value: '5000',
      close_date: start,
      account_id: account.id,
    });

    await navigateToWinLossReport({ page });

    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;

    if (isMobile) {
      // On mobile the SubPageNav renders a <select> — the report content is
      // already shown (win-loss is the default view) so just check the select value.
      await expectReportsTabListSelectHasValue('win-loss', { page });
    }

    await applyCustomDateFilter(page, start, end);
    await waitForReportLoaded(page);

    await expectReportsStatCardsVisible({ page });

    await expectReportsWinRateVisible({ page });
    const winRateText = await getReportsWinRateText({ page });
    expect(winRateText).toMatch(/\d+%/);
  },
);
