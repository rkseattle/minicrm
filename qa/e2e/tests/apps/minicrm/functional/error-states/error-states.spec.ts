/**
 * ES-1 — Network Interception: Error States and Degraded-Network Behavior
 *
 * Exercises how MiniCRM responds when the server returns errors or responds
 * slowly. All network interception uses page.mockRoute() from the framework —
 * no direct page.route() calls. Mocks are scoped to individual tests and
 * cleaned up automatically by the fixture teardown.
 *
 * Test groups:
 *   500 errors   — contact create, deal stage advance, bulk delete
 *   404 errors   — direct navigation to /contacts/:id and /deals/:id
 *   409 conflict — duplicate email on contact create
 *   Slow network — contacts list loading state
 *   Isolation    — confirms no mock bleed between adjacent tests
 *
 * Framework conventions (MINCRM-42, MINCRM-321):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data created via restClient + TestDataManager (auto teardown)
 *   - No direct page.route() calls — only page.mockRoute()
 *
 * MINCRM-326
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import {
  createContactViaUI,
  navigateToContacts,
  openContactCreateForm,
  fillContactCreateForm,
  submitContactCreateForm,
  filterContactsByTerm,
  waitForContactInList,
  waitForBulkCheckbox,
  clickBulkCheckbox,
  bulkDeleteContacts,
  contactRowIsVisible,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { ContactsPage } from '@pages/minicrm/ContactsPage.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';
import { DealDetailPage } from '@pages/minicrm/DealDetailPage.js';
import { PipelineBoardPage } from '@pages/minicrm/PipelineBoardPage.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[ES-1] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared error response bodies
// ---------------------------------------------------------------------------

const SERVER_ERROR_BODY = JSON.stringify({
  error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
});

// ---------------------------------------------------------------------------
// Shared setup — authenticate restClient once per suite
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// ES-1-1: Contact create 500 — form stays visible, error surfaced
// ---------------------------------------------------------------------------

test('@functional ES-1-1: create contact → server 500 → form stays open with error message', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Open the new-contact form and fill in valid data before the mock is active
  // so the form has real content when the 500 fires.
  const firstName = 'ES1';
  const lastName = `Error500-${uniqueSuffix}`;
  const email = `es1-500-${uniqueSuffix}@example.com`;

  await openContactCreateForm({ page });
  await fillContactCreateForm({ first_name: firstName, last_name: lastName, email }, { page });

  // Intercept the POST and force a 500.
  await page.mockRoute('**/api/v1/contacts', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: SERVER_ERROR_BODY,
      });
    } else {
      await route.continue();
    }
  });

  // Submit — the mock intercepts the POST and returns 500.
  await submitContactCreateForm({ page });

  await page.waitForLoadState('networkidle');

  // Form must still be visible — user was not navigated away.
  const contactsPage = new ContactsPage({ page });
  const form = await contactsPage.createFormLocator();
  await expect(form).toBeVisible();

  // First name field retains the entered value — form data is preserved.
  const firstNameInput = await contactsPage.firstNameInputLocator();
  await expect(firstNameInput).toHaveValue(firstName);

  // Confirm the contact was never created via API.
  const search = await restClient.get<{ total: number }>(
    `/api/v1/contacts?search=${encodeURIComponent(lastName)}`,
  );
  expect(search.body.total, 'contact must not have been created').toBe(0);

  // testData has nothing to register — the contact was never saved.
  void testData; // consumed via restClient fixture
});

// ---------------------------------------------------------------------------
// ES-1-2: Deal stage advance 500 — board intact, error banner visible
// ---------------------------------------------------------------------------

test('@functional ES-1-2: advance deal stage → server 500 → stage-update-error visible, board intact', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const account = await createTestAccount(testData, restClient, {
    name: `ES2 Account ${uniqueSuffix}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `ES2 Deal ${uniqueSuffix}`,
    stage: 'Prospecting',
    account_id: account.id,
  });

  await page.goto('/deals', { waitUntil: 'networkidle' });

  const pipelineBoard = new PipelineBoardPage({ page });

  // Wait for the deal card to be present before setting up the mock.
  const card = await pipelineBoard.dealCardLocator(deal.id);
  await card.waitFor({ state: 'visible', timeout: 10_000 });

  // Intercept the PATCH for this specific deal and return 500.
  await page.mockRoute(`**/api/v1/deals/${deal.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: SERVER_ERROR_BODY,
      });
    } else {
      await route.continue();
    }
  });

  // Change stage via the dropdown — triggers the PATCH.
  const stageSelect = await pipelineBoard.dealStageSelectLocator(deal.id);
  await stageSelect.selectOption('Qualification');

  await page.waitForLoadState('networkidle');

  // The stage-update-error banner must be visible.
  const errorBanner = await pipelineBoard.stageUpdateErrorLocator();
  await expect(errorBanner).toBeVisible({ timeout: 8_000 });

  // Verify via API that the deal's stage was NOT changed.
  const dealResp = await restClient.get<{ deal: { stage: string } }>(`/api/v1/deals/${deal.id}`);
  expect(dealResp.body.deal.stage, 'deal stage must remain Prospecting after 500').toBe(
    'Prospecting',
  );
});

// ---------------------------------------------------------------------------
// ES-1-3: Bulk delete 500 — contacts remain in list, error surfaced
// ---------------------------------------------------------------------------

test('@functional ES-1-3: bulk delete → server 500 → contacts remain, bulk-error-message visible', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'ES3',
    last_name: `BulkErr-${uniqueSuffix}`,
    email: `es3-bulk-${uniqueSuffix}@example.com`,
  });

  // Navigate to contacts, then filter so only this contact is visible on page 1.
  await navigateToContacts({ page });
  await filterContactsByTerm(uniqueSuffix, { page });
  await waitForContactInList(contact.id, { page });

  // Select the contact via its bulk-select checkbox.
  await waitForBulkCheckbox(contact.id, { page });
  await clickBulkCheckbox(contact.id, { page });

  // Wait for the bulk-action-bar to confirm selection registered.
  const bulkBar = await new ContactsPage({ page }).bulkActionBarLocator();
  await bulkBar.waitFor({ state: 'visible', timeout: 8_000 });

  // Intercept the bulk contacts POST and return 500.
  // The bulk contacts endpoint is /api/v1/contacts/bulk — not /api/v1/bulk.
  // Track interceptions so the test fails fast if the mock URL is ever wrong
  // and the real server handles the request instead (MINCRM-326 hardening).
  let bulkIntercepted = 0;
  await page.mockRoute('**/api/v1/contacts/bulk', async (route) => {
    bulkIntercepted++;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: SERVER_ERROR_BODY,
    });
  });

  // Click delete and confirm with force:true — the button sits inside a
  // full-viewport overflow-auto container on desktop and a fixed overlay on
  // mobile; force bypasses Playwright's actionability check in both cases.
  await bulkDeleteContacts({ page }, true);

  // Wait for the error element to attach rather than networkidle — the mock
  // returns instantly so networkidle settles before React re-renders bulkError.
  const errorMsg = await new ContactsPage({ page }).bulkErrorLocator();
  await errorMsg.waitFor({ state: 'attached', timeout: 8_000 });
  await expect(errorMsg).toBeVisible({ timeout: 8_000 });

  // Assert the mock was actually called — a count of 0 means the mock URL was
  // wrong and the real server handled the request instead (MINCRM-326 hardening).
  expect(bulkIntercepted, 'contacts/bulk POST must have been intercepted exactly once').toBe(1);

  // Contact row must still be visible in the UI — the list must not have removed
  // it optimistically after the failed delete.
  const rowCheck = await contactRowIsVisible(contact.id, { page });
  expect(rowCheck.visible, 'contact row must still be visible after failed bulk delete').toBe(true);

  // Contact must still exist on the server — confirmed via API.
  const check = await restClient
    .get<{ total: number }>(`/api/v1/contacts/${contact.id}`)
    .catch(() => null);
  expect(check, 'contact must still exist after failed bulk delete').not.toBeNull();
});

// ---------------------------------------------------------------------------
// ES-1-4: Contact 404 — direct navigation shows not-found state
// ---------------------------------------------------------------------------

test('@functional ES-1-4: navigate to /contacts/:id with invalid id → not-found state visible', async ({
  page,
}) => {
  const nonExistentId = '00000000-0000-0000-0000-000000000000';

  // Use domcontentloaded — the API call is still in-flight at that point.
  // The not-found UI renders only after React gets the 404 response and
  // transitions from isLoading to isError. Poll via waitForFunction until
  // the alert paragraph is in the DOM (it is absent in both the loading
  // branch and the success branch, so its presence is an unambiguous signal).
  await page.goto(`/contacts/${nonExistentId}`, { waitUntil: 'domcontentloaded' });

  // Wait until the not-found paragraph is present in the DOM.
  // Passed as a string so the QA tsconfig (no dom lib) does not flag `document`.
  await page.waitForFunction('document.querySelector(\'p[role="alert"]\') !== null', {
    timeout: 10_000,
  });

  // The page must show a not-found message — not a blank screen or JS error.
  const contactDetailPage = new ContactDetailPage({ page });
  const notFoundMsg = await contactDetailPage.notFoundAlertLocator();
  await expect(notFoundMsg).toBeVisible();

  // The back-to-contacts link must also be present so the user can recover.
  const backLink = await contactDetailPage.notFoundBackLinkLocator();
  await expect(backLink).toBeVisible();
});

// ---------------------------------------------------------------------------
// ES-1-5: Deal 404 — direct navigation shows not-found state
// ---------------------------------------------------------------------------

test('@functional ES-1-5: navigate to /deals/:id with invalid id → not-found state visible', async ({
  page,
}) => {
  const nonExistentId = '00000000-0000-0000-0000-000000000000';

  await page.goto(`/deals/${nonExistentId}`, { waitUntil: 'domcontentloaded' });

  // Wait until the not-found paragraph is present — same pattern as ES-1-4.
  // Passed as a string so the QA tsconfig (no dom lib) does not flag `document`.
  await page.waitForFunction('document.querySelector(\'p[role="alert"]\') !== null', {
    timeout: 10_000,
  });

  // The page must show a not-found message.
  const dealDetailPage = new DealDetailPage({ page });
  const notFoundMsg = await dealDetailPage.notFoundAlertLocator();
  await expect(notFoundMsg).toBeVisible();

  // The back-to-deals link must be present so the user can recover.
  const backLink = await dealDetailPage.notFoundBackLinkLocator();
  await expect(backLink).toBeVisible();
});

// ---------------------------------------------------------------------------
// ES-1-6: Duplicate email 409 — inline warning, not generic toast
// ---------------------------------------------------------------------------

test('@functional ES-1-6: create contact with duplicate email → 409 → duplicate-contact-warning visible', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sharedEmail = `es6-dup-${uniqueSuffix}@example.com`;

  // Create the original contact via API.
  await createTestContact(testData, restClient, {
    first_name: 'ES6Original',
    last_name: `Dup-${uniqueSuffix}`,
    email: sharedEmail,
  });

  // Attempt to create a second contact with the same email via the UI.
  // createContactViaUI returns duplicateWarning=true when the server returns 409.
  const result = await createContactViaUI(
    {
      first_name: 'ES6Duplicate',
      last_name: `Dup-${uniqueSuffix}`,
      email: sharedEmail,
    },
    { page },
  );

  expect(result.duplicateWarning, 'duplicate-contact-warning should be shown').toBe(true);
  expect(result.created, 'contact must not have been created').toBe(false);

  // Confirm the inline warning element is visible (not just any error element).
  const warningIsVisible = await new ContactsPage({ page }).duplicateWarningIsVisible();
  expect(warningIsVisible, 'inline duplicate-contact-warning must be visible').toBe(true);
});

// ---------------------------------------------------------------------------
// ES-1-7: Slow contacts list — loading state visible during delay
// ---------------------------------------------------------------------------

test('@functional ES-1-7: contacts list delayed 3s → loading indicator visible before data arrives', async ({
  page,
}) => {
  const DELAY_MS = 3_000;

  // Intercept GET /api/v1/contacts, hold for 3 s, then continue to the real server.
  await page.mockRoute('**/api/v1/contacts*', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS));
      await route.continue();
    } else {
      await route.continue();
    }
  });

  // Navigate — do NOT wait for networkidle because the intercepted request keeps
  // the network busy for the full delay.
  await page.goto('/contacts', { waitUntil: 'domcontentloaded' });

  // The loading indicator must appear while the request is in-flight.
  const loadingEl = await new ContactsPage({ page }).loadingIndicatorLocator();
  await expect(loadingEl).toBeVisible({ timeout: DELAY_MS - 500 });

  // After the delay the real data arrives — wait for the page to settle.
  await page.waitForLoadState('networkidle');

  // Loading indicator should be gone once data is rendered.
  const loadingGone = await page.isNotVisible(
    [
      { type: 'css', value: '[aria-busy="true"]' },
      { type: 'css', value: 'p[aria-busy]' },
    ],
    DELAY_MS + 5_000,
  );
  expect(loadingGone, 'loading indicator should disappear once contacts are loaded').toBe(true);
});

// ---------------------------------------------------------------------------
// ES-1-8: Isolation — no mock bleed between tests
// ---------------------------------------------------------------------------

test('@functional ES-1-8: isolation check — contacts list loads normally without any active mock', async ({
  page,
  restClient,
  testData,
}) => {
  // This test intentionally has no mockRoute() call. It runs after the delayed-
  // contacts test to confirm that the 3-second GET mock was fully cleaned up by
  // the prior test's fixture teardown and does not bleed into this test.

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const contact = await createTestContact(testData, restClient, {
    first_name: 'ES8',
    last_name: `Isolation-${uniqueSuffix}`,
    email: `es8-isolation-${uniqueSuffix}@example.com`,
  });

  await page.goto('/contacts', { waitUntil: 'networkidle' });

  // The contacts list should load promptly (well under 3 s) and show the seeded contact.
  const contactRow = await new ContactsPage({ page }).contactLinkLocator(contact.id);
  await expect(contactRow).toBeVisible({ timeout: 5_000 });
});
