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
import { navigateToContacts } from '@behaviors/minicrm/contacts.behaviors.js';
import { setNavLayoutViaAPI } from '@behaviors/minicrm/nav.behaviors.js';
import { createTestContact, createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import { LoginPage } from '@pages/minicrm/LoginPage.js';
import { ForgotPasswordPage } from '@pages/minicrm/ForgotPasswordPage.js';
import { ContactsPage } from '@pages/minicrm/ContactsPage.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';
import { PipelineBoardPage } from '@pages/minicrm/PipelineBoardPage.js';
import { UsersPage } from '@pages/minicrm/UsersPage.js';
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
    const loginPage = new LoginPage({ page });
    await loginPage.navigate();
    await page.waitForLoadState('domcontentloaded');

    await assertNoBlockingViolations(page);
  });

  test('@functional A11Y-A2: login page — validation errors visible', async ({ page }) => {
    const loginPage = new LoginPage({ page });
    await loginPage.navigate();
    // Submit empty form to surface required-field / credential error state.
    await loginPage.submit();
    await page.waitForLoadState('domcontentloaded');

    await assertNoBlockingViolations(page);
  });

  test('@functional A11Y-A3: forgot-password page — empty form', async ({ page }) => {
    const forgotPage = new ForgotPasswordPage({ page });
    await forgotPage.navigate();
    await page.waitForLoadState('domcontentloaded');

    await assertNoBlockingViolations(page);
  });
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
  await page.goto('/contacts');
  // Wait for the contacts table or empty state — stable DOM anchor for axe.
  await page
    .waitFor(
      [
        { type: 'testId', value: 'contacts-table' },
        { type: 'testId', value: 'contacts-empty-state' },
      ],
      'visible',
      { intent: 'contacts list content confirming page is fully loaded' },
      15_000,
    )
    .catch(() => null);

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
  // ContactsPage.navigate() already waits for the page to load — no extra wait needed.

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C2: contact creation form — empty state', async ({ page }) => {
  const contactsPage = new ContactsPage({ page });
  await contactsPage.navigate();
  await contactsPage.clickNewContact();
  // Wait for the create form to be visible before auditing.
  await page.waitFor(
    [
      { type: 'testId', value: 'contact-form' },
      { type: 'role', value: 'form' },
    ],
    'visible',
    { intent: 'contact creation form visible and ready for audit' },
    10_000,
  );

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C3: contact creation form — validation errors visible', async ({ page }) => {
  const contactsPage = new ContactsPage({ page });
  await contactsPage.navigate();
  await contactsPage.clickNewContact();

  // Wait for the form to mount before attempting submission — confirms the
  // submit button is actionable and the form is in the DOM.
  await page.waitFor(
    [
      { type: 'testId', value: 'contact-form' },
      { type: 'role', value: 'form' },
    ],
    'visible',
    { intent: 'contact creation form mounted and ready' },
    5_000,
  );

  // Submit with empty fields — browser native HTML5 constraint validation fires
  // synchronously (required inputs become :invalid; the submit event is suppressed
  // by the browser before handleSubmit runs). No async DOM changes occur, so there
  // is nothing to wait for. Audit immediately after the click.
  await contactsPage.submitCreateForm();

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-C4: contact detail page', async ({ page, restClient, testData }) => {
  const contact = await createTestContact(testData, restClient);
  const detailPage = new ContactDetailPage({ page });
  await detailPage.navigate(contact.id);
  // Wait for the edit button — confirms detail page has rendered.
  await detailPage.editButtonLocator();

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
  const boardPage = new PipelineBoardPage({ page });
  await boardPage.navigate();
  // Wait for the board container to be visible — stable DOM anchor for axe.
  await page.waitFor(
    [
      { type: 'testId', value: 'pipeline-board' },
      { type: 'css', value: '[data-testid="pipeline-board"]' },
    ],
    'visible',
    { intent: 'pipeline kanban board container confirming page is loaded' },
    15_000,
  );

  await assertNoBlockingViolations(page);
});

test('@functional A11Y-D2: CloseDealModal — open while modal is visible', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, { account_id: account.id });
  const boardPage = new PipelineBoardPage({ page });
  await boardPage.navigate();
  // Wait for the board container to be visible before interacting.
  await page.waitFor(
    [
      { type: 'testId', value: 'pipeline-board' },
      { type: 'css', value: '[data-testid="pipeline-board"]' },
    ],
    'visible',
    { intent: 'pipeline kanban board container confirming page is loaded' },
    15_000,
  );

  // Mobile board starts at stage 0 (Prospecting) where a new deal is seeded.
  // No stage navigation needed before selecting — deal is already in view.
  // Select a terminal stage to open CloseDealModal — audit while modal is open.
  const stageSelect = await boardPage.dealStageSelectLocator(deal.id);
  await stageSelect.selectOption('Closed Won');

  // Wait for the modal to become visible before auditing.
  const modalLocator = await boardPage.closeDealModalLocator();
  await modalLocator?.waitFor({ state: 'visible' });

  await assertNoBlockingViolations(page);

  // Dismiss the modal to leave the page in a clean state for teardown.
  await boardPage.cancelCloseDeal();
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
  const contactsPage = new ContactsPage({ page });
  await contactsPage.navigate();
  // ContactsPage.navigate() already waits for the page to load — no extra wait needed.

  // Select the seeded contact row to enable the bulk action bar.
  await contactsPage.waitForBulkCheckbox(contact.id);
  await contactsPage.clickBulkCheckbox(contact.id);

  // Click the bulk-delete button to open ConfirmDeleteModal.
  await contactsPage.clickBulkDelete();

  // Wait for the modal to be visible before auditing.
  const deleteModal = await contactsPage.confirmDeleteModalLocator();
  await deleteModal.waitFor({ state: 'visible' });

  await assertNoBlockingViolations(page);

  // Dismiss without deleting so testData teardown can clean up.
  await contactsPage.cancelBulkDelete();
});

test('@functional A11Y-M2: BulkReassignModal — bulk reassign flow', async ({
  page,
  restClient,
  testData,
}) => {
  const contact = await createTestContact(testData, restClient);
  const contactsPage = new ContactsPage({ page });
  await contactsPage.navigate();
  // ContactsPage.navigate() already waits for the page to load — no extra wait needed.

  // Select the seeded contact row to enable the bulk action bar.
  await contactsPage.waitForBulkCheckbox(contact.id);
  await contactsPage.clickBulkCheckbox(contact.id);

  // Click the bulk-reassign button to open BulkReassignModal.
  await contactsPage.clickBulkReassign();

  // Wait for the modal to be visible before auditing.
  const reassignModal = await contactsPage.bulkReassignModalLocator();
  await reassignModal.waitFor({ state: 'visible' });

  await assertNoBlockingViolations(page);

  // Dismiss the modal so testData teardown can clean up.
  await contactsPage.cancelBulkReassign();
});

// ---------------------------------------------------------------------------
// Admin flows — authenticated admin session
// ---------------------------------------------------------------------------

test('@functional A11Y-ADM1: user invite form', async ({ page }) => {
  const usersPage = new UsersPage({ page });
  await usersPage.navigate();
  // Wait for the invite form to be visible so axe doesn't audit the Suspense loading state.
  await page.waitFor(
    [
      { type: 'testId', value: 'invite-submit' },
      { type: 'role', value: 'button', options: { name: /invite/i } },
    ],
    'visible',
    { intent: 'invite submit button confirming users page is fully loaded' },
    10_000,
  );

  await assertNoBlockingViolations(page);
});
