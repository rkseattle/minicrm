/**
 * Visual regression tests for MiniCRM's most visually complex pages. (MINCRM-324)
 *
 * Each test navigates to a page with representative seeded data, waits for
 * networkidle, masks dynamic timestamps, then calls page.checkScreenshot() so
 * the framework's pixel-diff assertion runs.
 *
 * IMPORTANT — Baseline generation:
 *   Snapshots must be generated inside the Linux Docker E2E environment to be
 *   CI-compatible (font rendering differs across OSes). Run:
 *     docker compose -f docker-compose.e2e.yml run --rm playwright \
 *       npx playwright test visual-regression --update-snapshots
 *   Commit the resulting files from qa/e2e/snapshots/ into source control.
 *   See MINCRM-319 for full OS requirement documentation.
 *
 * Pages covered:
 *   V1 — Pipeline board, desktop viewport (sticky header + toolbar — MINCRM-346)
 *   V2 — Pipeline board, mobile viewport (Pixel 5) (sticky stage nav — MINCRM-346)
 *   V3 — Dashboard with seeded deals and activities
 *   V4 — Contact detail with activity timeline
 *   V5 — Win/Loss report with seeded won/lost deals
 *   V6 — Admin Settings — General tab
 *   V7 — Admin Settings — Currency tab
 *   V8 — Admin Settings — Notifications tab
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data via restClient + TestDataManager (auto teardown)
 *   - checkScreenshot() only — no direct expect(page).toHaveScreenshot() calls
 *
 * MINCRM-324
 */

import { test } from '@apps/minicrm/fixtures.js';
import type { PageFacadeShape } from '@framework/fixtures/heal-methods.js';
import { StrategyExhaustedError } from '@framework/healing/index.js';
import {
  createTestAccount,
  createTestActivity,
  createTestContact,
  createTestDeal,
  navigateToDashboard,
} from '@apps/minicrm/helpers.js';
import { login, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  getPipelineBoardLocator,
  getPipelineMobileStageNameLocator,
} from '@behaviors/minicrm/deals.behaviors.js';
import { getContactEditButtonLocator } from '@behaviors/minicrm/contacts.behaviors.js';
import {
  getReportsWinLossHeadingLocator,
  getReportsStatCardsLocator,
} from '@behaviors/minicrm/reports.behaviors.js';
import {
  getAdminSettingsHeadingLocator,
  getAdminSettingsSaveLocator,
  getAdminSettingsCurrencySectionLocator,
  getAdminSettingsEmailNotificationsSectionLocator,
} from '@behaviors/minicrm/settings.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[visual-regression] E2E_ADMIN_PASSWORD is not set');

// Visual tests involve browser login, page load, canvas rendering, and pixel-
// diff computation — give each test 60 s to absorb CI resource contention.
test.setTimeout(60_000);

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Viewport sizes (match playwright.config.ts project definitions)
// ---------------------------------------------------------------------------

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
// Pixel 5 dimensions used in Playwright's built-in device descriptor
const MOBILE_VIEWPORT = { width: 393, height: 851 };

// ---------------------------------------------------------------------------
// Timestamp mask helper
//
// Dynamic timestamps — relative ("X minutes ago") and absolute (toLocaleString)
// — are resolved as SafeLocators (which extend Locator) and passed to the
// checkScreenshot mask option, so font/time differences don't produce false
// positive pixel diffs.
//
// Each candidate is resolved individually and silently dropped when the
// selector matches nothing on the current page (StrategyExhaustedError).
// This keeps the helper safe to call from any page in the suite regardless
// of which timestamp elements are actually present.
// ---------------------------------------------------------------------------

async function tryResolve(page: PageFacadeShape, ...args: Parameters<PageFacadeShape['locate']>) {
  try {
    return await page.locate(...args).resolve();
  } catch (err) {
    if (err instanceof StrategyExhaustedError) return null;
    throw err;
  }
}

async function resolveTimestampMasks(page: PageFacadeShape) {
  const candidates = await Promise.all([
    // Dashboard recent-activity relative timestamps ("X minutes ago")
    tryResolve(page, [{ type: 'css', value: '[data-testid^="recent-activity-time-"]' }], {
      intent: 'dashboard recent activity relative timestamp cells',
    }),
    // Contact/activity timeline absolute timestamps (toLocaleString)
    tryResolve(page, [{ type: 'css', value: '[data-testid^="activity-meta-"]' }], {
      intent: 'activity timeline metadata timestamp cells',
    }),
    // Contact detail page "Created" field
    tryResolve(page, [{ type: 'testId', value: 'detail-created' }], {
      intent: 'contact detail created-at timestamp field',
    }),
    // SetupChecklistWidget — position:fixed overlay whose task-completion state
    // changes as test data accumulates; mask to prevent non-deterministic diffs
    // across runs. (MINCRM-391)
    tryResolve(page, [{ type: 'testId', value: 'setup-checklist-widget' }], {
      intent: 'floating setup checklist widget overlay',
    }),
    tryResolve(page, [{ type: 'testId', value: 'setup-checklist-pill' }], {
      intent: 'collapsed setup checklist pill',
    }),
  ]);
  return candidates.filter((c) => c !== null);
}

// ---------------------------------------------------------------------------
// V1 — Pipeline board, desktop viewport
// ---------------------------------------------------------------------------

test(
  'V1: pipeline board renders correctly at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, {
      name: 'VR-V1 Account',
    });

    // Seed 3 deals in 3 different stages to produce a representative board
    await createTestDeal(testData, restClient, {
      name: 'VR Discovery Deal',
      stage: 'Prospecting',
      value: '12500',
      currency: 'USD',
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Proposal Deal',
      stage: 'Proposal',
      value: '47800',
      currency: 'EUR',
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Negotiation Deal',
      stage: 'Negotiation',
      value: '99000',
      currency: 'GBP',
      account_id: account.id,
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/deals', { waitUntil: 'networkidle' });

    const board = await getPipelineBoardLocator({ page });
    await board.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('pipeline-board-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V2 — Pipeline board, mobile viewport
// ---------------------------------------------------------------------------

test(
  'V2: pipeline board renders correctly at mobile viewport @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, {
      name: 'VR-V2 Account',
    });

    await createTestDeal(testData, restClient, {
      name: 'VR Mobile Deal A',
      stage: 'Prospecting',
      value: '8000',
      currency: 'USD',
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Mobile Deal B',
      stage: 'Qualification',
      value: '23500',
      currency: 'USD',
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Mobile Deal C',
      stage: 'Proposal',
      value: '61000',
      currency: 'USD',
      account_id: account.id,
    });

    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/deals', { waitUntil: 'networkidle' });

    // Mobile board shows single column with prev/next navigation — wait for it
    const mobileStage = await getPipelineMobileStageNameLocator({ page });
    await mobileStage.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('pipeline-board-mobile.png', { mask: masks });

    // Restore desktop viewport so subsequent tests in this worker are unaffected
    await page.setViewportSize(DESKTOP_VIEWPORT);
  },
);

// ---------------------------------------------------------------------------
// V3 — Dashboard
// ---------------------------------------------------------------------------

test(
  'V3: dashboard renders stats grid and activity feed with seeded data @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    // Seed an account, contact, deal, and activity so the dashboard is not empty
    const account = await createTestAccount(testData, restClient, {
      name: 'VR-V3 Account',
    });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'Visual',
      last_name: 'DashboardUser',
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Dashboard Deal',
      stage: 'Qualification',
      value: '55000',
      currency: 'USD',
      account_id: account.id,
    });
    await createTestActivity(testData, restClient, {
      type: 'Note',
      subject: 'VR dashboard seed note',
      contact_id: contact.id,
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await navigateToDashboard(page);

    // Wait for the stat cards container before snapshotting.
    // dashboard-stat-cards is not in a domain page object — locate inline since
    // this is a screenshot ready-check, not a domain interaction.
    const statCards = await page
      .locate(
        [
          { type: 'testId', value: 'dashboard-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'dashboard KPI stat cards grid' },
      )
      .resolve();
    await statCards.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('dashboard.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V4 — Contact detail page
// ---------------------------------------------------------------------------

test(
  'V4: contact detail page renders with populated activity timeline @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, {
      name: 'VR-V4 Account',
    });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'Visual',
      last_name: 'ContactDetail',
      phone: '+1-555-0100',
      title: 'Senior Engineer',
      department: 'Engineering',
      account_id: account.id,
    });

    // Add a note and a task to populate the activity timeline section
    await createTestActivity(testData, restClient, {
      type: 'Note',
      subject: 'VR seed note for contact detail',
      contact_id: contact.id,
    });
    await createTestActivity(testData, restClient, {
      type: 'Task',
      subject: 'VR follow-up task',
      contact_id: contact.id,
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/contacts/${contact.id}`, { waitUntil: 'networkidle' });

    const editButton = await getContactEditButtonLocator({ page });
    await editButton.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('contact-detail.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V5 — Win/Loss report
// ---------------------------------------------------------------------------

test(
  'V5: win/loss report renders stat cards and tables with seeded deal data @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, {
      name: 'VR-V5 Account',
    });

    // Fixed close date keeps the report table stable across CI runs on different days.
    const closeDate = '2025-01-15';

    // Seed 2 won deals and 1 lost deal so the report has data in both columns
    await createTestDeal(testData, restClient, {
      name: 'VR Won Deal A',
      stage: 'Closed Won',
      value: '30000',
      currency: 'USD',
      close_date: closeDate,
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Won Deal B',
      stage: 'Closed Won',
      value: '18500',
      currency: 'USD',
      close_date: closeDate,
      account_id: account.id,
    });
    await createTestDeal(testData, restClient, {
      name: 'VR Lost Deal A',
      stage: 'Closed Lost',
      value: '9000',
      currency: 'USD',
      close_date: closeDate,
      account_id: account.id,
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/reports', { waitUntil: 'networkidle' });

    const reportHeading = await getReportsWinLossHeadingLocator({ page });
    await reportHeading.waitFor({ state: 'visible' });

    // Confirm stat cards are rendered before snapshotting.
    const statCards = await getReportsStatCardsLocator({ page });
    await statCards.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('win-loss-report.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V6 — Admin Settings — General tab
// ---------------------------------------------------------------------------

test(
  'V6: admin settings General tab renders correctly @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/admin/settings?tab=general', { waitUntil: 'networkidle' });

    const settingsHeading = await getAdminSettingsHeadingLocator({ page });
    await settingsHeading.waitFor({ state: 'visible' });

    // Wait for the general tab panel content to finish loading.
    const saveButton = await getAdminSettingsSaveLocator({ page });
    await saveButton.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('admin-settings-general.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V7 — Admin Settings — Currency tab
// ---------------------------------------------------------------------------

test(
  'V7: admin settings Currency tab renders correctly @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });

    const currencySection = await getAdminSettingsCurrencySectionLocator({ page });
    await currencySection.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('admin-settings-currency.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V8 — Admin Settings — Notifications tab
// ---------------------------------------------------------------------------

test(
  'V8: admin settings Notifications tab renders correctly @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/admin/settings?tab=notifications', { waitUntil: 'networkidle' });

    const notifSection = await getAdminSettingsEmailNotificationsSectionLocator({ page });
    await notifSection.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('admin-settings-notifications.png', { mask: masks });
  },
);
