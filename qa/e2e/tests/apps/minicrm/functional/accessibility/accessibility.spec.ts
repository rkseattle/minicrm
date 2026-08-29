/**
 * A11Y — Accessibility Audit: Core Workflows (WCAG 2.1 Level AA)
 *
 * Audits MiniCRM's core user workflows for WCAG 2.1 Level AA violations using
 * axe-core via the framework's `page.auditAccessibility()` helper.
 *
 * Standard: WCAG 2.1 Level AA
 * Tool: axe-core (via @axe-core/playwright)
 *
 * Severity policy:
 *   - critical + serious violations → test FAILS (blocked)
 *   - moderate + minor violations   → captured in output only; do not fail the suite
 *
 * Any critical or serious violation discovered during authoring must be filed as
 * a bug rather than silently excluded here.
 *
 * Test groups:
 *   Auth          — login page (empty + validation errors), forgot-password page
 *   Navigation    — main nav landmark structure (top layout)
 *   Contacts      — list page, create form (empty + validation errors), detail page
 *   Deals         — pipeline board, CloseDealModal
 *   Modals        — ConfirmDeleteModal (bulk delete), BulkReassignModal
 *   Admin         — user invite form
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in spec file — all UI interactions via behaviors or page objects
 *   - All test data managed via testData fixture (auto teardown)
 *   - Tests must pass on both desktop and mobile-web Playwright projects without retry
 *
 *
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
  waitForContactsConfirmDeleteModal,
  cancelContactsBulkDelete,
  clickContactsBulkReassign,
  waitForContactsBulkReassignModal,
  cancelContactsBulkReassign,
  filterContactsByTerm,
  waitForContactDetailReadMode,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { setNavLayoutViaAPI, openUserMenu } from '@behaviors/minicrm/nav.behaviors.js';
import { navigateToContactsPage } from '@behaviors/minicrm/layout.behaviors.js';
import {
  navigateToLoginPage,
  submitLoginForm,
  navigateToForgotPasswordPage,
  loginAsAdmin,
  loginViaBrowser,
  waitForLoginAlert,
} from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToPipelineBoard,
  waitForDealCardOnBoard,
  selectDealStageOnBoard,
  waitForPipelineBoardCloseDealModal,
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
  // opt out of pre-auth storageState so login flows work correctly.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('@functional A11Y-A1: login page — empty form', async ({ page }) => {
    await navigateToLoginPage({ page });

    await assertNoBlockingViolations(page);
  });

  test('@functional A11Y-A2: login page — validation errors visible', async ({ page }) => {
    await navigateToLoginPage({ page });
    // Submit empty form to surface required-field / credential error state.
    await submitLoginForm({ page });
    // Wait for the error alert to appear before auditing — React renders it
    // asynchronously after the mutation response, and the audit must see it.
    await waitForLoginAlert({ page });

    await assertNoBlockingViolations(page);
  });

  test('@functional A11Y-A3: forgot-password page — empty form', async ({ page }) => {
    await navigateToForgotPasswordPage({ page });

    await assertNoBlockingViolations(page);
  });
});

// ---------------------------------------------------------------------------
// Authenticated tests — ephemeral rep per test
// ---------------------------------------------------------------------------

// Authenticated tests must have their own browser session — the global
// storageState is cleared later so each test creates an ephemeral rep
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

test('@functional @serial A11Y-N1: main navigation — top layout landmark structure', async ({
  page,
  restClient,
}) => {
  // Ensure a known nav layout so the NavBar renders consistently across runs.
  await setNavLayoutViaAPI('top', restClient);
  await navigateToContactsPage({ page });

  await assertNoBlockingViolations(page);
});

test('@functional @serial A11Y-N2: header user menu — open menu structure', async ({
  page,
  restClient,
}) => {
  await setNavLayoutViaAPI('top', restClient);
  await navigateToContactsPage({ page });

  // A11Y-N1 only ever captures this menu closed, so its role, its labelling, and the
  // language select it wraps are audited nowhere else.
  await openUserMenu({ page });

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

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C2: contact creation form — empty state', async ({ page }) => {
  await navigateToContacts({ page });
  await clickNewContact({ page });

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C3: contact creation form — validation errors visible', async ({ page }) => {
  await navigateToContacts({ page });
  await clickNewContact({ page });

  // Submit without filling any fields to trigger required-field validation errors.
  await submitContactCreateFormAction({ page });

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C4: contact detail page', async ({ page, restClient, testData }) => {
  const contact = await createTestContact(testData, restClient);
  await navigateToContactDetail(contact.id, { page });
  // Wait for the contact detail page to reach stable read-mode before auditing —
  // the edit button's presence means all data-driven components have mounted.
  await waitForContactDetailReadMode({ page });

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

  // Mobile board mounts deal card DOM asynchronously after navigation — wait
  // for the card to be visible before interacting with its stage select.
  await waitForDealCardOnBoard(deal.id, { page });

  // Mobile board starts at stage 0 (Prospecting) where a new deal is seeded.
  // No stage navigation needed before selecting — deal is already in view.
  // Select a terminal stage to open CloseDealModal — audit while modal is open.
  await selectDealStageOnBoard(deal.id, 'Closed Won', { page });

  // Wait for the modal to become visible before auditing.
  await waitForPipelineBoardCloseDealModal({ page });

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
  // Bulk ops require admin — re-login as ephemeral admin to see checkboxes.
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await loginAsAdmin(restClient);

  const contact = await createTestContact(testData, restClient);
  await navigateToContacts({ page });
  // Filter to the unique contact so it appears on page 1 regardless of DB volume.
  await filterContactsByTerm(contact.email, { page });

  // Select the seeded contact row to enable the bulk action bar.
  await waitForBulkCheckbox(contact.id, { page });
  await clickBulkCheckbox(contact.id, { page });

  // Click the bulk-delete button to open ConfirmDeleteModal.
  await clickContactsBulkDelete({ page });

  // Wait for the modal to be visible before auditing.
  await waitForContactsConfirmDeleteModal({ page });

  await assertNoBlockingViolations(page);

  // Dismiss without deleting so testData teardown can clean up.
  await cancelContactsBulkDelete({ page });
});

test('@functional A11Y-M2: BulkReassignModal — bulk reassign flow', async ({
  page,
  restClient,
  testData,
}) => {
  // Bulk ops require admin — re-login as ephemeral admin to see checkboxes.
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });
  await loginAsAdmin(restClient);

  const contact = await createTestContact(testData, restClient);
  await navigateToContacts({ page });
  // Filter to the unique contact so it appears on page 1 regardless of DB volume.
  await filterContactsByTerm(contact.email, { page });

  // Select the seeded contact row to enable the bulk action bar.
  await waitForBulkCheckbox(contact.id, { page });
  await clickBulkCheckbox(contact.id, { page });

  // Click the bulk-reassign button to open BulkReassignModal.
  await clickContactsBulkReassign({ page });

  // Wait for the modal to be visible before auditing.
  await waitForContactsBulkReassignModal({ page });

  await assertNoBlockingViolations(page);

  // Dismiss the modal so testData teardown can clean up.
  await cancelContactsBulkReassign({ page });
});

// ---------------------------------------------------------------------------
// Admin flows — ephemeral admin session
// ---------------------------------------------------------------------------

test('@functional A11Y-ADM1: user invite form', async ({ page, restClient, testData }) => {
  // /users is admin-only; re-login as an ephemeral admin for this test.
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToUsers({ page });

  await assertNoBlockingViolations(page);
});
