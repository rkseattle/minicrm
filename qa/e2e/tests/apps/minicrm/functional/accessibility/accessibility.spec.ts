/**
 * A11Y — Accessibility Audit: Core Workflows (WCAG 2.1 Level AA)
 *
 * Audits MiniCRM's core user workflows for WCAG 2.1 Level AA violations using
 * axe-core via the framework's `page.auditAccessibility()` helper (MINCRM-320).
 *
 * Standard: WCAG 2.1 Level AA
 * Tool: axe-core (via @axe-core/playwright)
 *
 * Severity policy:
 *   - critical + serious violations → test FAILS (blocked)
 *   - moderate + minor violations   → captured in output only; do not fail the suite
 *
 * Any critical or serious violation discovered during authoring must be filed as
 * a bug under MINCRM-28 rather than silently excluded here.
 *
 * Test groups:
 *   Auth          — login page (empty + validation errors), forgot-password page
 *   Navigation    — main nav landmark structure (top layout)
 *   Contacts      — list page, create form (empty + validation errors), detail page
 *   Deals         — pipeline board, CloseDealModal
 *   Modals        — ConfirmDeleteModal (bulk delete), BulkReassignModal
 *   Admin         — user invite form
 *
 * Framework conventions (MINCRM-42, MINCRM-325):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in spec file — all UI interactions via behaviors or page objects
 *   - All test data managed via testData fixture (auto teardown)
 *   - Tests must pass on both desktop and mobile-web Playwright projects without retry
 *
 * MINCRM-325
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  navigateToContacts,
  navigateToContactDetail,
  clickNewContact,
  submitContactCreateFormAction,
  waitForBulkCheckbox,
  clickBulkCheckbox,
  clickContactsBulkDelete,
  getContactsConfirmDeleteModalLocator,
  cancelContactsBulkDelete,
  clickContactsBulkReassign,
  getContactsBulkReassignModalLocator,
  cancelContactsBulkReassign,
  filterContactsByTerm,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { setNavLayoutViaAPI } from '@behaviors/minicrm/nav.behaviors.js';
import { navigateToContactsPage } from '@behaviors/minicrm/layout.behaviors.js';
import {
  navigateToLoginPage,
  submitLoginForm,
  navigateToForgotPasswordPage,
  loginAsAdmin,
  loginViaBrowser,
} from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToPipelineBoard,
  getDealStageSelectOnBoardLocator,
  getPipelineBoardCloseDealModalLocator,
  cancelCloseDealModal,
} from '@behaviors/minicrm/deals.behaviors.js';
import { navigateToUsers } from '@behaviors/minicrm/users.behaviors.js';
import {
  createTestContact,
  createTestAccount,
  createTestDeal,
  createTestRep,
  createTestAdmin,
} from '@apps/minicrm/helpers.js';
import type { PageFacade } from '@framework/fixtures/index.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[A11Y] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Asserts zero critical or serious WCAG violations on the current page state.
 * Lower-impact violations (moderate, minor) are not blocking but appear in the
 * test output for incremental triage.
 */
async function assertNoBlockingViolations(page: PageFacade) {
  const results = await page.auditAccessibility();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  expect(
    blocking,
    `WCAG violations: ${blocking.map((v) => v.description).join(', ')}`,
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Auth flows — unauthenticated browser context required
// ---------------------------------------------------------------------------

test.describe('Auth forms', () => {
  // MINCRM-192: opt out of pre-auth storageState so login flows work correctly.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@functional A11Y-A1: login page — empty form', async ({ page }) => {
    await navigateToLoginPage({ page });
    await page.waitForLoadState('networkidle');

    await assertNoBlockingViolations(page);
  });

  test('@functional A11Y-A2: login page — validation errors visible', async ({ page }) => {
    await navigateToLoginPage({ page });
    // Submit empty form to surface required-field / credential error state.
    await submitLoginForm({ page });
    await page.waitForLoadState('networkidle');

    await assertNoBlockingViolations(page);
  });

  test('@functional A11Y-A3: forgot-password page — empty form', async ({ page }) => {
    await navigateToForgotPasswordPage({ page });
    await page.waitForLoadState('networkidle');

    await assertNoBlockingViolations(page);
  });
});

// ---------------------------------------------------------------------------
// Authenticated tests — ephemeral rep per test (MINCRM-415)
// ---------------------------------------------------------------------------

// Authenticated tests must have their own browser session — the global
// storageState is cleared by MINCRM-415 so each test creates an ephemeral rep
// (or admin for admin-only tests) and logs in via browser.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page, restClient, testData }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
});

// ---------------------------------------------------------------------------
// Navigation — authenticated
// ---------------------------------------------------------------------------

test('@functional A11Y-N1: main navigation — top layout landmark structure', async ({
  page,
  restClient,
}) => {
  // Ensure a known nav layout so the NavBar renders consistently across runs.
  await setNavLayoutViaAPI('top', restClient);
  await navigateToContactsPage({ page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});

// ---------------------------------------------------------------------------
// Contact management — authenticated
// ---------------------------------------------------------------------------

test('@functional A11Y-C1: contacts list — table with data', async ({
  page,
  restClient,
  testData,
}) => {
  await createTestContact(testData, restClient);
  await navigateToContacts({ page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C2: contact creation form — empty state', async ({ page }) => {
  await navigateToContacts({ page });
  await clickNewContact({ page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C3: contact creation form — validation errors visible', async ({ page }) => {
  await navigateToContacts({ page });
  await clickNewContact({ page });

  // Submit without filling any fields to trigger required-field validation errors.
  await submitContactCreateFormAction({ page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C4: contact detail page', async ({ page, restClient, testData }) => {
  const contact = await createTestContact(testData, restClient);
  await navigateToContactDetail(contact.id, { page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});

// ---------------------------------------------------------------------------
// Deal management — authenticated
// ---------------------------------------------------------------------------

test('@functional A11Y-D1: pipeline board — Kanban with a deal card', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);
  await createTestDeal(testData, restClient, { account_id: account.id });
  await navigateToPipelineBoard({ page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-D2: CloseDealModal — open while modal is visible', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, { account_id: account.id });
  await navigateToPipelineBoard({ page });
  await page.waitForLoadState('networkidle');

  // Mobile board starts at stage 0 (Prospecting) where a new deal is seeded.
  // No stage navigation needed before selecting — deal is already in view.
  // Select a terminal stage to open CloseDealModal — audit while modal is open.
  const stageSelect = await getDealStageSelectOnBoardLocator(deal.id, { page });
  await stageSelect.selectOption('Closed Won');

  // Wait for the modal to become visible before auditing.
  const modalLocator = await getPipelineBoardCloseDealModalLocator({ page });
  await modalLocator?.waitFor({ state: 'visible' });

  await assertNoBlockingViolations(page);

  // Dismiss the modal to leave the page in a clean state for teardown.
  await cancelCloseDealModal({ page });
});

// ---------------------------------------------------------------------------
// Modal dialogs — authenticated
// ---------------------------------------------------------------------------

test('@functional A11Y-M1: ConfirmDeleteModal — bulk delete flow', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);
  await navigateToContacts({ page });
  await page.waitForLoadState('networkidle');
  // Filter to the unique contact so it appears on page 1 regardless of DB volume.
  await filterContactsByTerm(contact.email, { page });

  // Select the seeded contact row to enable the bulk action bar.
  await waitForBulkCheckbox(contact.id, { page });
  await clickBulkCheckbox(contact.id, { page });

  // Click the bulk-delete button to open ConfirmDeleteModal.
  await clickContactsBulkDelete({ page });

  // Wait for the modal to be visible before auditing.
  const deleteModal = await getContactsConfirmDeleteModalLocator({ page });
  await deleteModal.waitFor({ state: 'visible' });

  await assertNoBlockingViolations(page);

  // Dismiss without deleting so testData teardown can clean up.
  await cancelContactsBulkDelete({ page });
});

test('@functional A11Y-M2: BulkReassignModal — bulk reassign flow', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);
  await navigateToContacts({ page });
  await page.waitForLoadState('networkidle');
  // Filter to the unique contact so it appears on page 1 regardless of DB volume.
  await filterContactsByTerm(contact.email, { page });

  // Select the seeded contact row to enable the bulk action bar.
  await waitForBulkCheckbox(contact.id, { page });
  await clickBulkCheckbox(contact.id, { page });

  // Click the bulk-reassign button to open BulkReassignModal.
  await clickContactsBulkReassign({ page });

  // Wait for the modal to be visible before auditing.
  const reassignModal = await getContactsBulkReassignModalLocator({ page });
  await reassignModal.waitFor({ state: 'visible' });

  await assertNoBlockingViolations(page);

  // Dismiss the modal so testData teardown can clean up.
  await cancelContactsBulkReassign({ page });
});

// ---------------------------------------------------------------------------
// Admin flows — ephemeral admin session (MINCRM-415)
// ---------------------------------------------------------------------------

test('@functional A11Y-ADM1: user invite form', async ({ page, restClient, testData }) => {
  // /users is admin-only; re-login as an ephemeral admin for this test.
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToUsers({ page });
  await page.waitForLoadState('networkidle');

  await assertNoBlockingViolations(page);
});
