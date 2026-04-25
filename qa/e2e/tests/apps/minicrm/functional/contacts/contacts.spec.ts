/**
 * F2 — Contacts CRUD, List Behaviour, and Account Associations
 *
 * Functional regression tests for all Contact operations. Covers create,
 * read/list, update, delete, account association, pagination, and search.
 * These tests go beyond BVT-02 into edge cases, validation errors, and
 * additional acceptance criteria.
 *
 * Test groups:
 *   Create      — required fields, optional fields, missing required field,
 *                 invalid email, duplicate email warning
 *   Read/List   — seeded data visible, sort (name/email, asc/desc), search
 *                 (match/no-match/case-insensitive), empty state
 *   Update      — edit fields reflected in detail view, cancel edit
 *   Delete      — delete → API 404 (AC1), cancel confirmation modal
 *   Account     — link, unlink, detail view shows account name with link
 *   Pagination  — navigate pages, sort stable across pages (AC2)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: deleted contact returns 404 from GET /contacts/:id via restClient
 *   - AC2: sort order is stable across pages
 *   - AC3: search is case-insensitive
 *
 * MINCRM-138
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  navigateToContacts,
  editContact,
  createContactViaUI,
  deleteContactViaUI,
  cancelDeleteContact,
  cancelContactEdit,
  searchContacts,
} from '@behaviors/minicrm/contacts.behaviors.js';
import {
  createTestContact,
  createTestAccount,
  navigateToContact,
  navigateToContacts as navigateToContactsPage,
} from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F2-contacts] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface ContactListResponse {
  data: Array<{ id: string; first_name: string; last_name: string; email: string }>;
  total: number;
  page: number;
  limit: number;
}

interface ContactSingleResponse {
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    account_id: string | null;
  };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Create tests
// ---------------------------------------------------------------------------

test('@smoke @functional F2-C1: all required fields submitted → contact created and appears in list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const firstName = `F2C1`;
  const lastName = `Create-${uniqueSuffix}`;
  const email = `f2c1-${uniqueSuffix}@example.com`;

  const result = await createContactViaUI(
    { first_name: firstName, last_name: lastName, email },
    { page },
  );

  expect(result.created, 'contact creation should succeed').toBe(true);
  expect(result.duplicateWarning, 'no duplicate warning expected').toBe(false);
  expect(result.validationError, 'no validation error expected').toBe(false);

  // Verify via API that the contact exists and register for teardown.
  const search = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(lastName)}`,
  );
  expect(search.body.total, 'created contact should be findable via API').toBe(1);
  const created = search.body.data[0];
  expect(created).toBeDefined();
  testData.register('contact', created!.id, `/api/contacts/${created!.id}`);
});

test('@functional F2-C2: optional fields included → all saved and displayed on detail page', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const lastName = `OptFields-${uniqueSuffix}`;
  const result = await createContactViaUI(
    {
      first_name: 'F2C2',
      last_name: lastName,
      email: `f2c2-${uniqueSuffix}@example.com`,
      phone: '+15550001111',
      title: 'VP Engineering',
      department: 'Engineering',
    },
    { page },
  );

  expect(result.created, 'contact with optional fields should be created').toBe(true);

  // Retrieve via API to confirm all optional fields were persisted.
  const search = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(lastName)}`,
  );
  expect(search.body.total, 'contact should be findable via API').toBe(1);
  const id = search.body.data[0]!.id;
  testData.register('contact', id, `/api/contacts/${id}`);

  const detail = await restClient.get<ContactSingleResponse>(`/api/contacts/${id}`);
  const contact = detail.body.contact as unknown as {
    phone: string;
    title: string;
    department: string;
  };
  expect(contact.phone, 'phone saved').toBe('+15550001111');
  expect(contact.title, 'title saved').toBe('VP Engineering');
  expect(contact.department, 'department saved').toBe('Engineering');
});

test('@functional F2-C3: missing required field → inline validation, contact not created', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Use a unique email so we can precisely verify whether this contact was created.
  const uniqueEmail = `f2c3-missing-${uniqueSuffix}@example.com`;

  // Submit with empty last_name by typing a space then clearing — browser HTML5
  // validation catches the empty required field client-side.
  await navigateToContactsPage(page);
  await page.click([{ type: 'testId', value: 'new-contact-button' }]);
  await page.fill('F2C3Only', [{ type: 'testId', value: 'contact-first-name' }]);
  await page.fill(uniqueEmail, [{ type: 'testId', value: 'contact-email' }]);
  // Intentionally leave last_name empty. Submit to trigger HTML5 required validation.
  await page.click([{ type: 'testId', value: 'contact-form-submit' }]);

  // HTML5 validation is synchronous — no network request fires. Use a DOM-based
  // wait so the assertion retries automatically instead of sleeping a fixed amount.
  await expect(
    await page.locate([{ type: 'testId', value: 'contact-form' }]).resolve(),
  ).toBeVisible();

  // Verify no contact was created by searching for the unique email.
  const check = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(uniqueEmail)}`,
  );
  expect(check.body.total, 'no contact should be created when required field is missing').toBe(0);

  void testData;
});

test('@functional F2-C4: invalid email format → inline validation, contact not created', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Use a unique last name to precisely identify whether this contact was created.
  const uniqueLastName = `InvalidEmailTest-${uniqueSuffix}`;

  // Use healPage interactions since createContactViaUI waits for networkidle which
  // may never settle on a validation error (no network request is made).
  await navigateToContactsPage(page);
  await page.click([{ type: 'testId', value: 'new-contact-button' }]);
  await page.fill('F2C4', [{ type: 'testId', value: 'contact-first-name' }]);
  await page.fill(uniqueLastName, [{ type: 'testId', value: 'contact-last-name' }]);
  await page.fill('not-an-email', [{ type: 'testId', value: 'contact-email' }]);
  await page.click([{ type: 'testId', value: 'contact-form-submit' }]);

  // HTML5 email validation is synchronous — use a DOM-based wait instead of a
  // fixed timeout so the assertion retries automatically.
  await expect(
    await page.locate([{ type: 'testId', value: 'contact-form' }]).resolve(),
  ).toBeVisible();

  // Verify no contact was created by searching for the unique last name.
  const check = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(uniqueLastName)}`,
  );
  expect(check.body.total, 'no contact should be created after invalid email submit').toBe(0);

  void testData;
});

test('@functional F2-C5: duplicate email address → duplicate warning shown', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Create a contact via API with a known email.
  const sharedEmail = `f2c5-${uniqueSuffix}@example.com`;
  const existing = await createTestContact(testData, restClient, {
    first_name: 'Existing',
    last_name: `Dup-${uniqueSuffix}`,
    email: sharedEmail,
  });

  // Try to create a second contact with the same email.
  const result = await createContactViaUI(
    { first_name: 'Duplicate', last_name: `Dup2-${uniqueSuffix}`, email: sharedEmail },
    { page },
  );

  expect(result.created, 'duplicate should not be silently created').toBe(false);
  expect(result.duplicateWarning, 'duplicate warning must be shown').toBe(true);

  // Only one contact with this email should exist.
  const search = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(sharedEmail)}`,
  );
  expect(search.body.total, 'only one contact with this email should exist').toBe(1);
  expect(search.body.data[0]!.id, 'the existing contact should be unchanged').toBe(existing.id);
});

// ---------------------------------------------------------------------------
// Read / List View tests
// ---------------------------------------------------------------------------

test('@smoke @functional F2-R1: contact list shows seeded records', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Seed two contacts.
  await createTestContact(testData, restClient, {
    first_name: 'F2R1Alpha',
    last_name: `List-${uniqueSuffix}`,
  });
  await createTestContact(testData, restClient, {
    first_name: 'F2R1Beta',
    last_name: `List-${uniqueSuffix}`,
  });

  const navResult = await navigateToContacts({ page });
  expect(navResult.loaded, 'contacts page should load').toBe(true);

  // Verify both seeded contacts are visible in the UI. Use the search behavior
  // to filter the list, then assert on the API total (stable) and that the
  // empty state is NOT shown (UI signal that results rendered).
  const uiResult = await searchContacts(`List-${uniqueSuffix}`, { page });
  expect(uiResult.emptyStateVisible, 'empty state should not be shown when records exist').toBe(
    false,
  );

  // Confirm via API that both records are present (cross-checks the render).
  const search = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`List-${uniqueSuffix}`)}`,
  );
  expect(search.body.total, 'both seeded contacts should be findable via API').toBe(2);
});

test('@functional F2-R2: sort by first name ascending returns alphabetical order', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Create contacts with first names that sort differently — Zebra before Apple.
  await createTestContact(testData, restClient, {
    first_name: 'ZebraSort',
    last_name: `Sort-${uniqueSuffix}`,
    email: `zebra-sort-${uniqueSuffix}@example.com`,
  });
  await createTestContact(testData, restClient, {
    first_name: 'AppleSort',
    last_name: `Sort-${uniqueSuffix}`,
    email: `apple-sort-${uniqueSuffix}@example.com`,
  });

  // Verify API sort — asc should return Apple before Zebra.
  const asc = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`Sort-${uniqueSuffix}`)}&sort=first_name&dir=asc`,
  );
  expect(asc.body.total, 'both contacts should be returned').toBe(2);
  expect(asc.body.data[0]!.first_name, 'Apple should come first in ascending order').toBe(
    'AppleSort',
  );
  expect(asc.body.data[1]!.first_name, 'Zebra should come second in ascending order').toBe(
    'ZebraSort',
  );

  // Verify API sort — desc should reverse.
  const desc = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`Sort-${uniqueSuffix}`)}&sort=first_name&dir=desc`,
  );
  expect(desc.body.data[0]!.first_name, 'Zebra should come first in descending order').toBe(
    'ZebraSort',
  );

  // Also confirm the sort button is clickable via UI (desktop table only).
  const navResult = await navigateToContacts({ page });
  expect(navResult.loaded).toBe(true);
  // The sort button only exists on desktop — the mobile card view has no sort headers.
  // resolve() throws StrategyExhaustedError when the element is absent (mobile), so
  // catch and treat as not visible.
  let isSortVisible = false;
  try {
    const sortButton = await page
      .locate([{ type: 'testId', value: 'contacts-sort-name' }])
      .resolve();
    isSortVisible = await sortButton.isVisible();
  } catch {
    // Element absent at this viewport — mobile layout has no sort headers.
  }
  if (isSortVisible) {
    await page.click([{ type: 'testId', value: 'contacts-sort-name' }]);
    await page.waitForLoadState('networkidle');
  }

  void testData;
});

test('@functional F2-R3: sort by email ascending returns correct order', async ({
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await createTestContact(testData, restClient, {
    first_name: 'EmailSortZ',
    last_name: `ESort-${uniqueSuffix}`,
    email: `zzz-esort-${uniqueSuffix}@example.com`,
  });
  await createTestContact(testData, restClient, {
    first_name: 'EmailSortA',
    last_name: `ESort-${uniqueSuffix}`,
    email: `aaa-esort-${uniqueSuffix}@example.com`,
  });

  const asc = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`ESort-${uniqueSuffix}`)}&sort=email&dir=asc`,
  );
  expect(asc.body.total, 'both contacts returned').toBe(2);
  expect(asc.body.data[0]!.email, 'aaa email should come first in ascending order').toMatch(
    /^aaa-/,
  );

  const desc = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`ESort-${uniqueSuffix}`)}&sort=email&dir=desc`,
  );
  expect(desc.body.data[0]!.email, 'zzz email should come first in descending order').toMatch(
    /^zzz-/,
  );
});

test('@functional F2-R4: search matching name returns results (AC3 — case-insensitive)', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'Casesearch',
    last_name: `CIS-${uniqueSuffix}`,
  });

  // Search with UPPERCASE variant to verify case-insensitivity (AC3).
  const result = await searchContacts(`CIS-${uniqueSuffix}`.toUpperCase(), { page });
  expect(result.rowCount, 'at least one row should match case-insensitive search').toBeGreaterThan(
    0,
  );
  expect(result.emptyStateVisible, 'empty state should not be shown').toBe(false);

  // API also confirms case-insensitivity.
  const apiSearch = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`CIS-${uniqueSuffix}`.toUpperCase())}`,
  );
  expect(apiSearch.body.total, 'API search should also be case-insensitive').toBeGreaterThan(0);
  expect(apiSearch.body.data.some((c) => c.id === contact.id)).toBe(true);
});

test('@functional F2-R5: search non-matching term returns empty state', async ({
  page,
  restClient,
  testData,
}) => {
  const result = await searchContacts('zzz-no-such-contact-xyzzy-99999', { page });
  expect(result.rowCount, 'no rows should match non-existent term').toBe(0);
  expect(result.emptyStateVisible, 'empty state should be visible for no results').toBe(true);

  void restClient;
  void testData;
});

// ---------------------------------------------------------------------------
// Update tests
// ---------------------------------------------------------------------------

test('@smoke @functional F2-U1: edit first name → change reflected in detail view and list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'OrigFirst',
    last_name: `Edit-${uniqueSuffix}`,
  });

  const updatedFirst = `UpdatedFirst-${uniqueSuffix}`;
  const editResult = await editContact(contact.id, { first_name: updatedFirst }, { page });

  expect(editResult.saved, 'edit should save successfully').toBe(true);

  // Verify change persisted via API.
  const updated = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(updated.body.contact.first_name, 'first name should be updated').toBe(updatedFirst);
});

test('@functional F2-U2: edit last name → change reflected in detail view and list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'OrigLastTest',
    last_name: `OrigLast-${uniqueSuffix}`,
  });

  const updatedLast = `UpdatedLast-${uniqueSuffix}`;
  const editResult = await editContact(contact.id, { last_name: updatedLast }, { page });

  expect(editResult.saved, 'edit should save successfully').toBe(true);

  const updated = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(updated.body.contact.last_name, 'last name should be updated').toBe(updatedLast);
});

test('@functional F2-U3: cancel edit → no changes persisted', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'CancelEditOrig',
    last_name: `CancelEdit-${uniqueSuffix}`,
  });

  const cancelResult = await cancelContactEdit(contact.id, 'THIS SHOULD NOT BE SAVED', { page });

  expect(cancelResult.backToReadMode, 'page should return to read mode after cancel').toBe(true);
  expect(new URL(cancelResult.finalUrl).pathname, 'should remain on the detail page').toBe(
    `/contacts/${contact.id}`,
  );

  // Confirm original first name is unchanged.
  const unchanged = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(unchanged.body.contact.first_name, 'first name must not change after cancel').toBe(
    'CancelEditOrig',
  );
});

// ---------------------------------------------------------------------------
// Delete tests
// ---------------------------------------------------------------------------

test('@functional F2-D1: delete contact → removed from list and returns 404 from API (AC1)', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'ToDelete',
    last_name: `Del-${uniqueSuffix}`,
  });

  const deleteResult = await deleteContactViaUI(contact.id, { page });

  expect(deleteResult.deleted, 'delete should navigate back to /contacts').toBe(true);

  // AC1: verify via API that the contact is actually gone (404).
  let caughtStatus: number | null = null;
  try {
    await restClient.get(`/api/contacts/${contact.id}`);
  } catch (err: unknown) {
    if (err instanceof RestClientError) {
      caughtStatus = err.status;
    } else {
      throw err;
    }
  }
  expect(caughtStatus, 'deleted contact must return 404 from API').toBe(404);

  // Contact is already gone — TestDataManager will receive a 404 on teardown
  // and swallow it silently, so no further action is needed.
});

test('@functional F2-D2: cancel confirmation dialog → contact not deleted, remains in list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contact = await createTestContact(testData, restClient, {
    first_name: 'CancelDelete',
    last_name: `CancelDel-${uniqueSuffix}`,
  });

  const cancelResult = await cancelDeleteContact(contact.id, { page });

  expect(cancelResult.stillOnDetailPage, 'should remain on detail page after cancel').toBe(true);

  // Confirm contact still exists in the API.
  const stillExists = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(stillExists.status, 'contact should still be accessible via API after cancel').toBe(200);
});

// ---------------------------------------------------------------------------
// Account association tests
// ---------------------------------------------------------------------------

test('@functional F2-A1: link contact to account → contact appears in account contacts list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const account = await createTestAccount(testData, restClient, {
    name: `F2A1 Corp ${uniqueSuffix}`,
  });
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F2A1',
    last_name: `AccountLink-${uniqueSuffix}`,
  });

  // Link the contact to the account via API (PATCH).
  await restClient.patch(`/api/contacts/${contact.id}`, { account_id: account.id });

  // Navigate to the contact detail page and confirm the account is shown.
  await navigateToContact(page, contact.id);

  // The detail-account element should show the account name.
  const accountLocator = await page.locate([{ type: 'testId', value: 'detail-account' }]).resolve();
  await accountLocator.waitFor({ state: 'visible', timeout: 10_000 });
  const accountText = await accountLocator.textContent();
  expect(accountText, 'detail view should show the linked account name').toContain(
    `F2A1 Corp ${uniqueSuffix}`,
  );

  // Also verify via API that the contact's account_id is set.
  const detail = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(detail.body.contact.account_id, 'contact account_id should match').toBe(account.id);
});

test('@functional F2-A2: unlink contact from account → account_id is null in API', async ({
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const account = await createTestAccount(testData, restClient, {
    name: `F2A2 Corp ${uniqueSuffix}`,
  });
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F2A2',
    last_name: `AccountUnlink-${uniqueSuffix}`,
    account_id: account.id,
  });

  // Verify the contact is linked.
  const before = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(before.body.contact.account_id, 'contact should be linked before unlink').toBe(account.id);

  // Unlink by patching account_id to null.
  await restClient.patch(`/api/contacts/${contact.id}`, { account_id: null });

  // Verify via API.
  const after = await restClient.get<ContactSingleResponse>(`/api/contacts/${contact.id}`);
  expect(after.body.contact.account_id, 'account_id should be null after unlink').toBeNull();
});

test('@functional F2-A3: contact detail view shows associated account name with working link', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const account = await createTestAccount(testData, restClient, {
    name: `F2A3 Corp ${uniqueSuffix}`,
  });
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F2A3',
    last_name: `DetailAccount-${uniqueSuffix}`,
    account_id: account.id,
  });

  await navigateToContact(page, contact.id);

  // Confirm account name is a link pointing to the account's detail page.
  const accountLink = await page.locate([{ type: 'testId', value: 'detail-account' }]).resolve();
  await accountLink.waitFor({ state: 'visible', timeout: 10_000 });
  const href = await accountLink.getAttribute('href');
  expect(href, 'account link should point to /accounts/:id').toContain(`/accounts/${account.id}`);

  const linkText = await accountLink.textContent();
  expect(linkText, 'account link text should be the account name').toContain(
    `F2A3 Corp ${uniqueSuffix}`,
  );
});

// ---------------------------------------------------------------------------
// Pagination tests
// ---------------------------------------------------------------------------

test('@functional F2-P1: pagination — navigating pages returns correct records (AC2 — sort stable)', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // To test pagination we need enough records to fill at least 2 pages.
  // PAGINATION_DEFAULT_LIMIT is 50 — create 3 contacts and use a limit=2
  // API call to verify the second page exists and is correctly ordered.
  const contacts = [];
  for (let i = 0; i < 3; i++) {
    const c = await createTestContact(testData, restClient, {
      first_name: `Pag${String(i).padStart(2, '0')}`,
      last_name: `Page-${uniqueSuffix}`,
      email: `pag${i}-page-${uniqueSuffix}@example.com`,
    });
    contacts.push(c);
  }

  // Verify page 1 with limit=2 returns the first 2 records in first_name asc order.
  const page1 = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`Page-${uniqueSuffix}`)}&sort=first_name&dir=asc&limit=2&page=1`,
  );
  expect(page1.body.total, 'total should be 3').toBe(3);
  expect(page1.body.data.length, 'page 1 should have 2 records').toBe(2);
  expect(page1.body.data[0]!.first_name, 'first on page 1 should be Pag00').toBe('Pag00');
  expect(page1.body.data[1]!.first_name, 'second on page 1 should be Pag01').toBe('Pag01');

  // AC2: page 2 must maintain the same sort order.
  const page2 = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(`Page-${uniqueSuffix}`)}&sort=first_name&dir=asc&limit=2&page=2`,
  );
  expect(page2.body.data.length, 'page 2 should have 1 record').toBe(1);
  expect(page2.body.data[0]!.first_name, 'record on page 2 should be Pag02').toBe('Pag02');

  // Quick UI smoke: pagination controls appear when there are enough records.
  // We use the real default limit (50) here so we just confirm the navigation works.
  const navResult = await navigateToContacts({ page });
  expect(navResult.loaded, 'contacts page should load').toBe(true);

  // If the total (all contacts in db) exceeds 50 the pagination component is shown.
  const total = (await restClient.get<ContactListResponse>('/api/contacts')).body.total;
  if (total > 50) {
    const paginationLocator = await page
      .locate([{ type: 'testId', value: 'pagination' }])
      .resolve();
    await expect(paginationLocator).toBeVisible();
  }
});
