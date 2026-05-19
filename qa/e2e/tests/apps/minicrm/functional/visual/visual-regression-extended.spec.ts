/**
 * Extended visual regression tests for MiniCRM — list views, nav layout modes,
 * detail views, and form/modal states. (MINCRM-371)
 *
 * Companion to visual-regression.spec.ts (MINCRM-324). Split into a sibling
 * file to keep each file manageable while sharing the same snapshot directory.
 *
 * Baseline generation (same as visual-regression.spec.ts):
 *   docker compose -f docker-compose.e2e.yml run --rm playwright \
 *     npx playwright test visual-regression-extended --update-snapshots
 *   Commit the resulting files from qa/e2e/snapshots/ into source control.
 *
 * Pages covered:
 *   List views (V9–V12)
 *     V9  — Contacts list, desktop
 *     V10 — Accounts list, desktop
 *     V11 — Leads list, desktop
 *     V12 — Tasks list, desktop
 *   Navigation layout modes (V13–V17)
 *     V13 — Left nav layout, desktop
 *     V14 — Hamburger nav layout, desktop (collapsed)
 *     V15 — Hamburger nav layout, desktop (drawer open)
 *     V16 — Left nav layout, mobile-web viewport
 *     V17 — Top nav layout, mobile-web viewport
 *   Detail views (V18–V20)
 *     V18 — Deal detail page
 *     V19 — Account detail page
 *     V20 — User management table
 *   Form / modal states (V21–V23)
 *     V21 — Contact create form (empty state)
 *     V22 — Contact create form (validation errors)
 *     V23 — Confirm-delete modal
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data via restClient + TestDataManager (auto teardown)
 *   - checkScreenshot() only — no direct expect(page).toHaveScreenshot() calls
 *   - Nav layout mutations reset to 'top' in afterEach (not ensureSystemDefaults —
 *     that resets onboarding_completed and races with the onboarding spec)
 *
 * MINCRM-371
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
import { getDealNameHeadingLocator } from '@behaviors/minicrm/deals.behaviors.js';
import { setNavLayoutViaAPI } from '@behaviors/minicrm/nav.behaviors.js';
import {
  getContactsCreateFormLocator,
  getContactsConfirmDeleteModalLocator,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { createLeadViaApi } from '@behaviors/minicrm/leads.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[visual-regression-extended] E2E_ADMIN_PASSWORD is not set');

// Visual tests are heavier than functional tests; allow 60 s per test.
test.setTimeout(60_000);

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// Tests V13–V17 mutate the nav layout. Reset to 'top' after each test so
// a failed teardown in one test cannot contaminate subsequent tests in the
// same worker. Only the nav layout is reset here — calling ensureSystemDefaults
// would also reset onboarding_completed, which races with the onboarding spec
// (F-OB1) that explicitly sets onboarding_completed=false in parallel workers.
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
// Timestamp / dynamic-content mask helper (mirrors visual-regression.spec.ts)
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
    // Dashboard recent-activity relative timestamps
    tryResolve(page, [{ type: 'css', value: '[data-testid^="recent-activity-time-"]' }], {
      intent: 'dashboard recent activity relative timestamp cells',
    }),
    // Activity timeline metadata
    tryResolve(page, [{ type: 'css', value: '[data-testid^="activity-meta-"]' }], {
      intent: 'activity timeline metadata timestamp cells',
    }),
    // Contact / account / deal detail "Created" field
    tryResolve(page, [{ type: 'testId', value: 'detail-created' }], {
      intent: 'detail page created-at timestamp field',
    }),
    // Leads list "Created" column cells — dynamic per-row timestamps
    tryResolve(page, [{ type: 'css', value: '[data-testid^="lead-created-"]' }], {
      intent: 'leads list created-at timestamp cells',
    }),
    // Tasks list "Due date" cells — absolute dates that change per-seeded record
    tryResolve(page, [{ type: 'css', value: '[data-testid^="task-due-date-"]' }], {
      intent: 'tasks list due date cells',
    }),
    // Users table "Last login" / "Joined" cells
    tryResolve(page, [{ type: 'css', value: '[data-testid^="user-joined-"]' }], {
      intent: 'user management table joined date cells',
    }),
  ]);
  return candidates.filter((c) => c !== null);
}

// ---------------------------------------------------------------------------
// V9 — Contacts list, desktop
// ---------------------------------------------------------------------------

test(
  'V9: contacts list renders with seeded contacts at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

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
    await page.goto('/contacts', { waitUntil: 'networkidle' });

    // Wait for the New Contact button — stable indicator the list has loaded
    const newBtn = await page
      .locate(
        [
          { type: 'testId', value: 'new-contact-button' },
          { type: 'role', value: 'button', options: { name: /new contact/i } },
        ],
        { intent: 'new contact button confirming the contacts list is ready' },
      )
      .resolve();
    await newBtn.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('contacts-list-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V10 — Accounts list, desktop
// ---------------------------------------------------------------------------

test(
  'V10: accounts list renders with seeded accounts at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await createTestAccount(testData, restClient, {
      name: 'VR Acme Corp',
      industry: 'Technology',
    });
    await createTestAccount(testData, restClient, {
      name: 'VR Globex Inc',
      industry: 'Manufacturing',
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/accounts', { waitUntil: 'networkidle' });

    const newBtn = await page
      .locate(
        [
          { type: 'testId', value: 'new-account-button' },
          { type: 'role', value: 'button', options: { name: /new account/i } },
        ],
        { intent: 'new account button confirming the accounts list is ready' },
      )
      .resolve();
    await newBtn.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('accounts-list-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V11 — Leads list, desktop
// ---------------------------------------------------------------------------

test(
  'V11: leads list renders with seeded leads at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    // Leads are not registered with TestDataManager — the lead API does not expose
    // a delete endpoint accessible via TestDataManager; leads are cleaned up by
    // the E2E DB teardown between test runs. Emails are auto-generated to avoid
    // collisions when desktop and mobile-web projects run this test in parallel.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await createLeadViaApi(restClient, {
      first_name: 'Carol',
      last_name: 'VRLeads',
      email: `vr-v11-carol-${suffix}@example.com`,
      company_name: 'VR Corp',
    });
    await createLeadViaApi(restClient, {
      first_name: 'Dave',
      last_name: 'VRLeads',
      email: `vr-v11-dave-${suffix}@example.com`,
      company_name: 'VR Inc',
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/leads', { waitUntil: 'networkidle' });

    const newBtn = await page
      .locate(
        [
          { type: 'testId', value: 'new-lead-button' },
          { type: 'role', value: 'button', options: { name: /new lead/i } },
        ],
        { intent: 'new lead button confirming the leads list is ready' },
      )
      .resolve();
    await newBtn.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('leads-list-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V12 — Tasks list, desktop
// ---------------------------------------------------------------------------

test(
  'V12: tasks list renders with seeded tasks at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, { name: 'VR-V12 Account' });

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
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const heading = await page
      .locate(
        [
          { type: 'testId', value: 'my-tasks-heading' },
          { type: 'role', value: 'heading', options: { level: 1 } },
        ],
        { intent: 'my tasks page heading confirming the tasks list is ready' },
      )
      .resolve();
    await heading.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('tasks-list-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V13 — Left nav layout, desktop
// ---------------------------------------------------------------------------

test(
  'V13: left nav layout renders correctly at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    // Switch to left nav layout via API before navigating to the page under test
    await setNavLayoutViaAPI('left', restClient);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    // Navigate to dashboard to show the left sidebar in context with page content
    await navigateToDashboard(page);

    // Wait for the stat cards grid which indicates the dashboard has fully loaded
    const statCards = await page
      .locate(
        [
          { type: 'testId', value: 'dashboard-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'dashboard KPI stat cards confirming the page loaded with left nav' },
      )
      .resolve();
    await statCards.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('nav-left-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V14 — Hamburger nav layout, desktop (collapsed)
// ---------------------------------------------------------------------------

test(
  'V14: hamburger nav layout renders correctly collapsed at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await setNavLayoutViaAPI('hamburger', restClient);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await navigateToDashboard(page);

    const statCards = await page
      .locate(
        [
          { type: 'testId', value: 'dashboard-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'dashboard KPI stat cards confirming the page loaded with hamburger nav' },
      )
      .resolve();
    await statCards.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('nav-hamburger-collapsed-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V15 — Hamburger nav layout, desktop (drawer open)
// ---------------------------------------------------------------------------

test(
  'V15: hamburger nav drawer renders correctly open at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await setNavLayoutViaAPI('hamburger', restClient);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await navigateToDashboard(page);

    // Wait for the page to be interactive before opening the drawer
    const statCards = await page
      .locate(
        [
          { type: 'testId', value: 'dashboard-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'dashboard KPI stat cards confirming the page is ready before opening drawer' },
      )
      .resolve();
    await statCards.waitFor({ state: 'visible' });

    // Click the hamburger toggle to open the drawer
    const toggle = await page
      .locate(
        [
          { type: 'testId', value: 'nav-menu-toggle' },
          { type: 'role', value: 'button', options: { name: /menu/i } },
        ],
        { intent: 'hamburger menu toggle button' },
      )
      .resolve();
    await toggle.click();

    // Wait for the drawer to become visible before snapshotting
    const drawer = await page
      .locate(
        [
          { type: 'testId', value: 'nav-hamburger-drawer' },
          { type: 'role', value: 'dialog' },
        ],
        { intent: 'hamburger nav drawer overlay' },
      )
      .resolve();
    await drawer.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('nav-hamburger-open-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V16 — Left nav layout, mobile-web viewport
// ---------------------------------------------------------------------------

test(
  'V16: left nav layout renders correctly at mobile-web viewport @functional',
  { tag: ['@functional'] },
  async ({ page, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await setNavLayoutViaAPI('left', restClient);

    // Mobile viewport — left nav collapses to the hamburger icon on small screens
    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateToDashboard(page);

    const statCards = await page
      .locate(
        [
          { type: 'testId', value: 'dashboard-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'dashboard KPI stat cards confirming mobile layout with left-nav setting' },
      )
      .resolve();
    await statCards.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('nav-left-mobile.png', { mask: masks });

    await page.setViewportSize(DESKTOP_VIEWPORT);
  },
);

// ---------------------------------------------------------------------------
// V17 — Top nav layout, mobile-web viewport
// ---------------------------------------------------------------------------

test(
  'V17: top nav layout renders correctly at mobile-web viewport @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    // Top nav is the default layout; no API call needed to set it.
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(MOBILE_VIEWPORT);
    await navigateToDashboard(page);

    const statCards = await page
      .locate(
        [
          { type: 'testId', value: 'dashboard-stat-cards' },
          { type: 'role', value: 'region' },
        ],
        { intent: 'dashboard KPI stat cards confirming mobile layout with top-nav setting' },
      )
      .resolve();
    await statCards.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('nav-top-mobile.png', { mask: masks });

    await page.setViewportSize(DESKTOP_VIEWPORT);
  },
);

// ---------------------------------------------------------------------------
// V18 — Deal detail page
// ---------------------------------------------------------------------------

test(
  'V18: deal detail page renders with realistic seeded data @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, { name: 'VR-V18 Account' });
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
    await page.goto(`/deals/${deal.id}`, { waitUntil: 'networkidle' });

    const dealHeading = await getDealNameHeadingLocator({ page });
    await dealHeading.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('deal-detail-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V19 — Account detail page
// ---------------------------------------------------------------------------

test(
  'V19: account detail page renders with linked contacts and activities @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const account = await createTestAccount(testData, restClient, {
      name: 'VR-V19 Enterprises',
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
    await page.goto(`/accounts/${account.id}`, { waitUntil: 'networkidle' });

    // Wait for the account name heading as the ready anchor
    const accountName = await page
      .locate(
        [
          { type: 'testId', value: 'account-name' },
          { type: 'role', value: 'heading', options: { level: 1 } },
        ],
        { intent: 'account name heading confirming the account detail page has loaded' },
      )
      .resolve();
    await accountName.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('account-detail-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V20 — User management table
// ---------------------------------------------------------------------------

test(
  'V20: user management table renders at desktop viewport @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/users', { waitUntil: 'networkidle' });

    // Wait for the invite form submit button — stable indicator that users page is loaded
    const inviteBtn = await page
      .locate(
        [
          { type: 'testId', value: 'invite-submit' },
          { type: 'role', value: 'button', options: { name: /invite/i } },
        ],
        { intent: 'invite submit button confirming the user management page has loaded' },
      )
      .resolve();
    await inviteBtn.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('user-management-desktop.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V21 — Contact create form, empty state
// ---------------------------------------------------------------------------

test(
  'V21: contact create form renders in empty state @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/contacts', { waitUntil: 'networkidle' });

    // Open the contact creation form by clicking New Contact
    const newBtn = await page
      .locate(
        [
          { type: 'testId', value: 'new-contact-button' },
          { type: 'role', value: 'button', options: { name: /new contact/i } },
        ],
        { intent: 'new contact button to open the creation form' },
      )
      .resolve();
    await newBtn.click();

    // Wait for the form to appear before snapshotting
    const form = await getContactsCreateFormLocator({ page });
    await form.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('contact-create-form-empty.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V22 — Contact create form, validation errors
// ---------------------------------------------------------------------------

test(
  'V22: contact create form renders validation errors when submitted empty @functional',
  { tag: ['@functional'] },
  async ({ page }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/contacts', { waitUntil: 'networkidle' });

    // Open the form
    const newBtn = await page
      .locate(
        [
          { type: 'testId', value: 'new-contact-button' },
          { type: 'role', value: 'button', options: { name: /new contact/i } },
        ],
        { intent: 'new contact button to open the creation form for validation test' },
      )
      .resolve();
    await newBtn.click();

    const form = await getContactsCreateFormLocator({ page });
    await form.waitFor({ state: 'visible' });

    // Submit without filling any required fields to trigger validation
    const submitBtn = await page
      .locate(
        [
          { type: 'testId', value: 'contact-form-submit' },
          { type: 'role', value: 'button', options: { name: /save|create/i } },
        ],
        { intent: 'contact form submit button to trigger validation errors' },
      )
      .resolve();
    await submitBtn.click();

    // Wait for at least one validation error message to appear before snapshotting.
    // The form uses HTML5 constraint validation which shows browser-native tooltips
    // or inline error spans — wait for any [aria-invalid] element to confirm errors are shown.
    await page.waitForFunction(
      `document.querySelector('[aria-invalid="true"], [data-testid="contact-form"] :invalid') !== null`,
    );

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('contact-create-form-validation.png', { mask: masks });
  },
);

// ---------------------------------------------------------------------------
// V23 — Confirm-delete modal
// ---------------------------------------------------------------------------

test(
  'V23: confirm-delete modal renders correctly on the contacts list @functional',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    // Seed a contact so there is a row to select for bulk delete.
    // Email auto-generated to avoid collision when both projects run in parallel.
    const contact = await createTestContact(testData, restClient, {
      first_name: 'Grace',
      last_name: 'VRDelete',
    });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/contacts', { waitUntil: 'networkidle' });

    // Check the contact's bulk-select checkbox
    const checkbox = await page
      .locate(
        [
          { type: 'testId', value: `bulk-select-${contact.id}` },
          { type: 'css', value: `[data-testid="bulk-select-${contact.id}"]` },
        ],
        { intent: 'bulk-select checkbox for the seeded contact row' },
      )
      .resolve();
    await checkbox.waitFor({ state: 'visible' });
    await checkbox.check();

    // Wait for bulk action bar to appear after selecting
    const bulkBar = await page
      .locate(
        [
          { type: 'testId', value: 'bulk-action-bar' },
          { type: 'role', value: 'toolbar' },
        ],
        { intent: 'bulk action toolbar that appears when contacts are selected' },
      )
      .resolve();
    await bulkBar.waitFor({ state: 'visible' });

    // Click the bulk-delete button to open the confirmation modal
    await page
      .locate(
        [
          { type: 'testId', value: 'bulk-delete-button' },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'bulk delete button in the action toolbar' },
      )
      .resolve()
      .then((el) => el.click());

    // Wait for the modal to become visible before snapshotting
    const modal = await getContactsConfirmDeleteModalLocator({ page });
    await modal.waitFor({ state: 'visible' });

    const masks = await resolveTimestampMasks(page);
    await page.checkScreenshot('confirm-delete-modal.png', { mask: masks });
  },
);
