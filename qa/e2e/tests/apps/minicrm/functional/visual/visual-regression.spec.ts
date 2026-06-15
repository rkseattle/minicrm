/**
 * Visual regression tests for MiniCRM's most visually complex pages. (MINCRM-324, MINCRM-371)
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
 *   Core Layout
 *     V1 — Pipeline board, desktop viewport (sticky header + toolbar — MINCRM-346)
 *     V2 — Pipeline board, mobile viewport (Pixel 5) (sticky stage nav — MINCRM-346)
 *     V3 — Dashboard with seeded deals and activities
 *     V4 — Contact detail with activity timeline
 *     V5 — Win/Loss report with seeded won/lost deals
 *   Admin pages
 *     V6 — Admin Settings — General tab
 *   List views
 *     V7  — Contacts list, desktop
 *     V8  — Accounts list, desktop
 *     V9  — Leads list, desktop
 *     V10 — Tasks list, desktop
 *   Navigation layout modes
 *     V11 — Left nav layout, desktop
 *     V12 — Hamburger nav layout, desktop (drawer open)
 *     V13 — Top nav layout, mobile-web viewport
 *   Detail views
 *     V14 — Deal detail page
 *     V15 — Account detail page
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @visual (not @functional — visual tests require OS-matching baselines)
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data via restClient + TestDataManager (auto teardown)
 *   - checkScreenshot() only — no direct expect(page).toHaveScreenshot() calls
 *   - Nav layout mutations reset to 'top' in afterEach (not ensureSystemDefaults —
 *     that resets onboarding_completed and races with the onboarding spec)
 *
 * Performance: A single ephemeral admin is created once per worker in beforeAll
 * and shared across all tests in that worker. Per-test admin creation (5 API calls
 * each) was the dominant setup cost; sharing reduces that to one call per worker.
 * Each test still does a fresh browser login so session state is fully isolated.
 * (MINCRM-416)
 *
 * MINCRM-324, MINCRM-371, MINCRM-409, MINCRM-415, MINCRM-416
 */

import { test } from '@apps/minicrm/fixtures.js';
import {
  createTestAccount,
  createTestActivity,
  createTestContact,
  createTestDeal,
  navigateToDashboard,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  getPipelineBoardLocator,
  getPipelineMobileStageNameLocator,
  getDealNameHeadingLocator,
} from '@behaviors/minicrm/deals.behaviors.js';
import { getContactEditButtonLocator } from '@behaviors/minicrm/contacts.behaviors.js';
import {
  getReportsWinLossHeadingLocator,
  getReportsStatCardsLocator,
} from '@behaviors/minicrm/reports.behaviors.js';
import {
  getAdminSettingsHeadingLocator,
  getAdminSettingsSaveLocator,
} from '@behaviors/minicrm/settings.behaviors.js';
import { setNavLayoutViaAPI, openHamburgerMenu } from '@behaviors/minicrm/nav.behaviors.js';
import { createLeadViaApi } from '@behaviors/minicrm/leads.behaviors.js';
import {
  navigateToContactDetailPage,
  navigateToDealDetailPage,
  navigateToAccountDetailPage,
  navigateToContactsPage,
  navigateToAccountsPage,
  navigateToLeadsPage,
  navigateToTasksPage,
  navigateToPath,
  getDashboardStatCardsLocator,
  getMyTasksHeadingLocator,
  getNewContactButtonLocator,
  getNewAccountButtonLocator,
  getNewLeadButtonLocator,
  getAccountNameHeadingLocator,
  resolveTimestampMasks,
} from '@behaviors/minicrm/layout.behaviors.js';
import {
  inviteUserViaApi,
  setUserPassword,
  suppressUserOnboarding,
  deactivateUser,
} from '@behaviors/minicrm/users.behaviors.js';
import type { EphemeralUserCredentials } from '@apps/minicrm/helpers.js';

// Each test uses a unique browser login but shares one ephemeral admin per
// worker — no shared storageState. (MINCRM-415, MINCRM-416)
test.use({ storageState: { cookies: [], origins: [] } });

// Visual tests involve browser login, page load, canvas rendering, and pixel-
// diff computation — give each test 60 s to absorb CI resource contention.
test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Shared admin — created once per worker, reused across all tests. (MINCRM-416)
//
// Each test still calls loginViaBrowser() to get a fresh isolated browser
// session; we only avoid the 5-API-call invite+password+onboarding setup on
// every test. Teardown deactivates the shared user after all tests in this
// worker complete.
// ---------------------------------------------------------------------------

let sharedAdmin: EphemeralUserCredentials;

test.beforeAll(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  // Create the shared admin directly — no testData needed since we own teardown
  // in afterAll. testData is test-scoped and unavailable in beforeAll. (MINCRM-416)
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `vr-admin-${uniqueSuffix}@example.com`;
  const name = `VR Admin ${uniqueSuffix}`;
  const password = 'BvtPassword1!';
  const { user, inviteToken } = await inviteUserViaApi(restClient, { name, email, role: 'admin' });
  await setUserPassword(restClient, inviteToken, password);
  await suppressUserOnboarding(restClient, email, password);
  sharedAdmin = { userId: user.id, email, password };
});

// afterAll receives its own restClient fixture — the one captured in beforeAll
// cannot be reused across hook boundaries in Playwright. (MINCRM-416)
test.afterAll(async ({ restClient }) => {
  if (sharedAdmin) {
    await loginAsAdmin(restClient);
    await deactivateUser(restClient, sharedAdmin.userId);
  }
});

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// Tests V11–V13 mutate the nav layout. Reset to 'top' after each test so
// a failed teardown in one test cannot contaminate subsequent tests in the
// same worker.
test.afterEach(async ({ restClient }) => {
  await setNavLayoutViaAPI('top', restClient);
});

// ---------------------------------------------------------------------------
// Viewport sizes (match playwright.config.ts project definitions)
// ---------------------------------------------------------------------------

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
// Pixel 5 dimensions used in Playwright's built-in device descriptor
const MOBILE_VIEWPORT = { width: 393, height: 851 };

// ---------------------------------------------------------------------------
// Timestamp / dynamic-content mask helper
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

// ===========================================================================
// Core Layout
// ===========================================================================

test.describe('Core Layout', () => {
  // ── V1 — Pipeline board, desktop viewport ──────────────────────────────────

  test(
    'V1: pipeline board renders correctly at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

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
      await navigateToPath('/deals', { page });

      const board = await getPipelineBoardLocator({ page });
      await board.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('pipeline-board-desktop.png', { mask: masks });
    },
  );

  // ── V2 — Pipeline board, mobile viewport ───────────────────────────────────

  test(
    'V2: pipeline board renders correctly at mobile viewport @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

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
      await navigateToPath('/deals', { page });

      // Mobile board shows single column with prev/next navigation — wait for it
      const mobileStage = await getPipelineMobileStageNameLocator({ page });
      await mobileStage.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('pipeline-board-mobile.png', { mask: masks });

      // Restore desktop viewport so subsequent tests in this worker are unaffected
      await page.setViewportSize(DESKTOP_VIEWPORT);
    },
  );

  // ── V3 — Dashboard ─────────────────────────────────────────────────────────

  test(
    'V3: dashboard renders stats grid and activity feed with seeded data @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

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

      const statCards = await getDashboardStatCardsLocator({ page });
      await statCards.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('dashboard.png', { mask: masks });
    },
  );

  // ── V4 — Contact detail page ────────────────────────────────────────────────

  test(
    'V4: contact detail page renders with populated activity timeline @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

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
      await navigateToContactDetailPage(contact.id, { page });

      const editButton = await getContactEditButtonLocator({ page });
      await editButton.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('contact-detail.png', { mask: masks });
    },
  );

  // ── V5 — Win/Loss report ────────────────────────────────────────────────────

  test(
    'V5: win/loss report renders stat cards and tables with seeded deal data @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

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
      await navigateToPath('/reports', { page });

      const reportHeading = await getReportsWinLossHeadingLocator({ page });
      await reportHeading.waitFor({ state: 'visible' });

      // Confirm stat cards are rendered before snapshotting.
      const statCards = await getReportsStatCardsLocator({ page });
      await statCards.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('win-loss-report.png', { mask: masks });
    },
  );
}); // end Core Layout

// ===========================================================================
// Admin pages
// ===========================================================================

test.describe('Admin', () => {
  // ── V6 — Admin Settings — General tab ──────────────────────────────────────

  test(
    'V6: admin settings General tab renders correctly @visual',
    { tag: ['@visual'] },
    async ({ page }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToPath('/admin/settings?tab=general', { page });

      const settingsHeading = await getAdminSettingsHeadingLocator({ page });
      await settingsHeading.waitFor({ state: 'visible' });

      // Wait for the general tab panel content to finish loading.
      const saveButton = await getAdminSettingsSaveLocator({ page });
      await saveButton.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('admin-settings-general.png', { mask: masks });
    },
  );
}); // end Admin

// ===========================================================================
// List views (V7–V10)
// ===========================================================================

test.describe('Key Pages', () => {
  // ── V7 — Contacts list, desktop ────────────────────────────────────────────

  test(
    'V7: contacts list renders with seeded contacts at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      // Seed two contacts so the list has meaningful rows to capture.
      // Emails are auto-generated to avoid collisions when desktop and mobile-web
      // projects run this test in parallel.
      await createTestContact(testData, restClient, {
        first_name: 'Alice',
        last_name: 'VRContacts',
        title: 'Director',
      });
      await createTestContact(testData, restClient, {
        first_name: 'Bob',
        last_name: 'VRContacts',
        title: 'Engineer',
      });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToContactsPage({ page });

      const newBtn = await getNewContactButtonLocator({ page });
      await newBtn.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('contacts-list-desktop.png', { mask: masks });
    },
  );

  // ── V8 — Accounts list, desktop ───────────────────────────────────────────

  test(
    'V8: accounts list renders with seeded accounts at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      await createTestAccount(testData, restClient, {
        name: 'VR Acme Corp',
        industry: 'Technology',
      });
      await createTestAccount(testData, restClient, {
        name: 'VR Globex Inc',
        industry: 'Manufacturing',
      });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToAccountsPage({ page });

      const newBtn = await getNewAccountButtonLocator({ page });
      await newBtn.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('accounts-list-desktop.png', { mask: masks });
    },
  );

  // ── V9 — Leads list, desktop ───────────────────────────────────────────────

  test(
    'V9: leads list renders with seeded leads at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      // Leads are not registered with TestDataManager — the lead API does not expose
      // a delete endpoint accessible via TestDataManager; leads are cleaned up by
      // the E2E DB teardown between test runs. Emails are auto-generated to avoid
      // collisions when desktop and mobile-web projects run this test in parallel.
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await createLeadViaApi(restClient, {
        first_name: 'Carol',
        last_name: 'VRLeads',
        email: `vr-v9-carol-${suffix}@example.com`,
        company_name: 'VR Corp',
      });
      await createLeadViaApi(restClient, {
        first_name: 'Dave',
        last_name: 'VRLeads',
        email: `vr-v9-dave-${suffix}@example.com`,
        company_name: 'VR Inc',
      });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToLeadsPage({ page });

      const newBtn = await getNewLeadButtonLocator({ page });
      await newBtn.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('leads-list-desktop.png', { mask: masks });
    },
  );

  // ── V10 — Tasks list, desktop ───────────────────────────────────────────────

  test(
    'V10: tasks list renders with seeded tasks at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      const account = await createTestAccount(testData, restClient, { name: 'VR-V10 Account' });

      await createTestActivity(testData, restClient, {
        type: 'Task',
        subject: 'VR Follow-up call',
        account_id: account.id,
        due_date: '2030-06-01',
      });
      await createTestActivity(testData, restClient, {
        type: 'Task',
        subject: 'VR Send proposal',
        account_id: account.id,
        due_date: '2030-06-15',
      });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToTasksPage({ page });

      const heading = await getMyTasksHeadingLocator({ page });
      await heading.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('tasks-list-desktop.png', { mask: masks });
    },
  );

  // ── V11 — Left nav layout, desktop ─────────────────────────────────────────

  test(
    'V11: left nav layout renders correctly at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      // Switch to left nav layout via API before navigating to the page under test
      await setNavLayoutViaAPI('left', restClient);

      await page.setViewportSize(DESKTOP_VIEWPORT);
      // Navigate to dashboard to show the left sidebar in context with page content
      await navigateToDashboard(page);

      const statCards = await getDashboardStatCardsLocator({ page });
      await statCards.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('nav-left-desktop.png', { mask: masks });
    },
  );

  // ── V12 — Hamburger nav layout, desktop (drawer open) ──────────────────────

  test(
    'V12: hamburger nav drawer renders correctly open at desktop viewport @visual',
    { tag: ['@visual'] },
    async ({ page, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      await setNavLayoutViaAPI('hamburger', restClient);

      await page.setViewportSize(DESKTOP_VIEWPORT);
      // Navigate to the dashboard AFTER setting the layout so React Query fetches
      // the new 'hamburger' value and renders the toggle. Using 'networkidle' ensures
      // the nav-layout query completes before we look for nav-menu-toggle. (MINCRM-415)
      await navigateToPath('/', { page });

      // Wait for the page to be interactive before opening the drawer
      const statCards = await getDashboardStatCardsLocator({ page });
      await statCards.waitFor({ state: 'visible' });

      // Click the hamburger toggle to open the drawer
      const { drawerVisible } = await openHamburgerMenu({ page });
      void drawerVisible;

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('nav-hamburger-open-desktop.png', { mask: masks });
    },
  );

  // ── V13 — Top nav layout, mobile-web viewport ──────────────────────────────

  test(
    'V13: top nav layout renders correctly at mobile-web viewport @visual',
    { tag: ['@visual'] },
    async ({ page }) => {
      // Top nav is the default layout; no API call needed to set it.
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      await page.setViewportSize(MOBILE_VIEWPORT);
      await navigateToDashboard(page);

      const statCards = await getDashboardStatCardsLocator({ page });
      await statCards.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('nav-top-mobile.png', { mask: masks });

      await page.setViewportSize(DESKTOP_VIEWPORT);
    },
  );

  // ── V14 — Deal detail page ──────────────────────────────────────────────────

  test(
    'V14: deal detail page renders with realistic seeded data @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      const account = await createTestAccount(testData, restClient, { name: 'VR-V14 Account' });
      const contact = await createTestContact(testData, restClient, {
        first_name: 'Eve',
        last_name: 'VRDeal',
        account_id: account.id,
      });
      const deal = await createTestDeal(testData, restClient, {
        name: 'VR Enterprise Deal',
        stage: 'Proposal',
        value: '75000',
        currency: 'USD',
        close_date: '2030-09-30',
        account_id: account.id,
      });

      // Add an activity on the deal to populate the timeline section
      await createTestActivity(testData, restClient, {
        type: 'Note',
        subject: 'VR deal seed note',
        deal_id: deal.id,
        contact_id: contact.id,
      });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToDealDetailPage(deal.id, { page });

      const dealHeading = await getDealNameHeadingLocator({ page });
      await dealHeading.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('deal-detail-desktop.png', { mask: masks });
    },
  );

  // ── V15 — Account detail page ───────────────────────────────────────────────

  test(
    'V15: account detail page renders with linked contacts and activities @visual',
    { tag: ['@visual'] },
    async ({ page, testData, restClient }) => {
      await loginViaBrowser(sharedAdmin.email, sharedAdmin.password, { page });

      const account = await createTestAccount(testData, restClient, {
        name: 'VR-V15 Enterprises',
        industry: 'Finance',
      });
      await createTestContact(testData, restClient, {
        first_name: 'Frank',
        last_name: 'VRAccount',
        account_id: account.id,
      });
      await createTestActivity(testData, restClient, {
        type: 'Note',
        subject: 'VR account seed note',
        account_id: account.id,
      });

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToAccountDetailPage(account.id, { page });

      const accountName = await getAccountNameHeadingLocator({ page });
      await accountName.waitFor({ state: 'visible' });

      const masks = await resolveTimestampMasks({ page });
      await page.checkScreenshot('account-detail-desktop.png', { mask: masks });
    },
  );
}); // end Key Pages
