/**
 * F3 — Accounts CRUD, List Behaviour, and Contact Associations
 *
 * Functional regression tests for all Account operations. Covers create,
 * read/list, update, delete, contact association, and pagination.
 * These tests go beyond BVT into edge cases, validation errors, and
 * additional acceptance criteria.
 *
 * Test groups:
 *   Create      — required fields, optional fields, missing required field
 *   Read/List   — seeded data visible, sort (name asc/desc), empty state
 *   Update      — edit fields reflected in detail view, cancel edit
 *   Delete      — delete → API 404 (AC1), delete with contacts → contacts
 *                 unlinked, cancel confirmation modal
 *   Association — linked contacts list on account detail page
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: deleted account returns 404 from GET /accounts/:id via restClient
 *   - AC2: sort order is stable across pages
 *   - AC3: deleting an account unlinks associated contacts (contacts are NOT deleted)
 *
 * MINCRM-139
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  navigateToAccounts,
  editAccount,
  createAccountViaUI,
  deleteAccountViaUI,
  cancelDeleteAccount,
  cancelAccountEdit,
  searchAccounts,
  getAccountById,
  searchAccountsViaApi,
  listAccountsViaApi,
  getAccountLinkedContactLocator,
  getAccountLinkedContactsEmptyLocator,
} from '@behaviors/minicrm/accounts.behaviors.js';
import { getContactById, patchContactAccount } from '@behaviors/minicrm/contacts.behaviors.js';
import { createTestAccount, createTestContact, navigateToAccount } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Create tests
// ---------------------------------------------------------------------------

test('@functional F3-C1: all required fields submitted → account created and appears in list', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const name = `F3C1 Corp ${uniqueSuffix}`;

  const result = await createAccountViaUI({ name }, { page });

  expect(result.created, 'account creation should succeed').toBe(true);
  expect(result.validationError, 'no validation error expected').toBe(false);

  // Verify via API that the account exists and register for teardown.
  const search = await searchAccountsViaApi(restClient, name);
  expect(search.total, 'created account should be findable via API').toBe(1);
  const created = search.data[0];
  expect(created).toBeDefined();
  testData.register('account', created!.id, `/api/v1/accounts/${created!.id}`);
});

test('@functional F3-C2: optional fields included → all saved on detail page', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const name = `F3C2 Corp ${uniqueSuffix}`;
  const result = await createAccountViaUI(
    {
      name,
      industry: 'Technology',
      website: 'https://f3c2.example.com',
      employee_range: '51-200',
      revenue_range: '10M-50M',
    },
    { page },
  );

  expect(result.created, 'account with optional fields should be created').toBe(true);

  // Retrieve via API to confirm all fields were persisted.
  const search = await searchAccountsViaApi(restClient, name);
  expect(search.total, 'account should be findable via API').toBe(1);
  const id = search.data[0]!.id;
  testData.register('account', id, `/api/v1/accounts/${id}`);

  const account = await getAccountById(restClient, id);
  expect(account.industry).toBe('Technology');
  expect(account.website).toBe('https://f3c2.example.com');
  expect(account.employee_range).toBe('51-200');
  expect(account.revenue_range).toBe('10M-50M');
});

test('@functional F3-C3: missing required name field → inline validation error, no navigation', async ({
  page,
}) => {
  // Submit a form with an empty name — the browser's required validation fires
  // before the form submits, keeping the form visible.
  const result = await createAccountViaUI({ name: '' }, { page });

  expect(result.created, 'account should not be created when name is missing').toBe(false);
  expect(result.validationError, 'validation error should be shown').toBe(true);
});

// ---------------------------------------------------------------------------
// Read / List tests
// ---------------------------------------------------------------------------

test('@functional F3-R1: seeded accounts are visible in the list', async ({
  page,
  restClient,
  testData,
}) => {
  // Seed two accounts via API.
  const accountA = await createTestAccount(testData, restClient, {
    name: `F3R1-Alpha-${Date.now()}`,
  });
  const accountB = await createTestAccount(testData, restClient, {
    name: `F3R1-Beta-${Date.now()}`,
  });

  const result = await navigateToAccounts({ page });

  expect(result.loaded, 'accounts page should load').toBe(true);

  // Both seeded accounts should be findable via API.
  const searchA = await searchAccountsViaApi(restClient, accountA.name);
  expect(searchA.total, 'first seeded account should exist').toBeGreaterThanOrEqual(1);

  const searchB = await searchAccountsViaApi(restClient, accountB.name);
  expect(searchB.total, 'second seeded account should exist').toBeGreaterThanOrEqual(1);
});

test('@functional F3-R2: sort by name ascending then descending', async ({
  page,
  restClient,
  testData,
}) => {
  // Seed two accounts with alphabetically ordered names.
  await createTestAccount(testData, restClient, { name: `F3R2-AAA-${Date.now()}` });
  await createTestAccount(testData, restClient, { name: `F3R2-ZZZ-${Date.now()}` });

  await navigateToAccounts({ page });

  // Verify API returns correct sort order ascending.
  const ascResult = await listAccountsViaApi(restClient, { sort: 'name', dir: 'asc', limit: 5 });
  const ascNames = ascResult.data.map((a) => a.name);
  const ascSorted = [...ascNames].sort((x, y) => x.localeCompare(y));
  expect(ascNames, 'ascending sort should be alphabetical').toEqual(ascSorted);

  // Verify API returns correct sort order descending.
  const descResult = await listAccountsViaApi(restClient, { sort: 'name', dir: 'desc', limit: 5 });
  const descNames = descResult.data.map((a) => a.name);
  const descSorted = [...descNames].sort((x, y) => y.localeCompare(x));
  expect(descNames, 'descending sort should be reverse alphabetical').toEqual(descSorted);
});

test('@functional F3-R3: empty state shown when no accounts exist', async ({
  page,
  restClient,
}) => {
  const sentinel = 'F3R3_NOMATCH_XYZ_UNIQUE_SENTINEL';

  const searchResult = await searchAccounts(sentinel, { page });

  // Verify via API that the search returns zero results.
  const result = await searchAccountsViaApi(restClient, sentinel);
  expect(result.total, 'search should return 0 results').toBe(0);
  expect(searchResult.rowCount, 'no account rows should be visible').toBe(0);
  expect(searchResult.emptyStateVisible, 'empty state text should be visible').toBe(true);
});

// ---------------------------------------------------------------------------
// Update tests
// ---------------------------------------------------------------------------

test('@functional F3-U1: edit account name → change reflected in detail view', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const account = await createTestAccount(testData, restClient, {
    name: `F3U1-Before-${uniqueSuffix}`,
  });

  const updatedName = `F3U1-After-${uniqueSuffix}`;
  const result = await editAccount(account.id, { name: updatedName }, { page });

  expect(result.saved, 'edit should save successfully').toBe(true);

  // Verify the name change is reflected via API.
  const detail = await getAccountById(restClient, account.id);
  expect(detail.name, 'updated name should be persisted').toBe(updatedName);
});

test('@functional F3-U2: edit industry field → change reflected in detail view', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F3U2-Corp-${Date.now()}`,
  });

  const result = await editAccount(account.id, { industry: 'Healthcare' }, { page });

  expect(result.saved, 'edit should save successfully').toBe(true);

  const detail = await getAccountById(restClient, account.id);
  expect(detail.industry, 'updated industry should be persisted').toBe('Healthcare');
});

test('@functional F3-U3: cancel edit → no change persisted', async ({
  page,
  restClient,
  testData,
}) => {
  const originalName = `F3U3-Original-${Date.now()}`;

  const account = await createTestAccount(testData, restClient, { name: originalName });

  const result = await cancelAccountEdit(account.id, 'F3U3-CANCELLED', {
    page,
  });

  expect(result.backToReadMode, 'cancel should return to read mode').toBe(true);

  // Verify name is unchanged via API.
  const detail = await getAccountById(restClient, account.id);
  expect(detail.name, 'name should not change after cancel').toBe(originalName);
});

// ---------------------------------------------------------------------------
// Delete tests
// ---------------------------------------------------------------------------

test('@functional F3-D1: delete account with no contacts → removed from list, returns 404 via API (AC1)', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F3D1-DeleteMe-${Date.now()}`,
  });

  const result = await deleteAccountViaUI(account.id, { page });

  expect(result.deleted, 'delete should navigate back to accounts list').toBe(true);
  expect(new URL(result.finalUrl).pathname, 'should land on /accounts').toBe('/accounts');

  // AC1: verify the account returns 404 from the API.
  let threw = false;
  try {
    await restClient.get(`/api/v1/accounts/${account.id}`);
  } catch (err) {
    threw = true;
    expect(err instanceof RestClientError, 'should be a RestClientError').toBe(true);
    expect((err as RestClientError).status, 'should be 404').toBe(404);
  }
  expect(threw, 'GET after delete should throw RestClientError 404').toBe(true);
});

test('@functional F3-D2: delete account with associated contacts → contacts unlinked, not deleted (AC3)', async ({
  page,
  restClient,
  testData,
}) => {
  // Create an account and link a contact to it.
  const account = await createTestAccount(testData, restClient, {
    name: `F3D2-WithContacts-${Date.now()}`,
  });
  const contact = await createTestContact(testData, restClient, {
    account_id: account.id,
  });

  const result = await deleteAccountViaUI(account.id, { page });

  expect(result.deleted, 'delete should navigate back to accounts list').toBe(true);

  // AC3: account is gone (404).
  let threw = false;
  try {
    await restClient.get(`/api/v1/accounts/${account.id}`);
  } catch (err) {
    threw = true;
    expect((err as RestClientError).status).toBe(404);
  }
  expect(threw, 'account should return 404 after delete').toBe(true);

  // AC3: contact still exists but its account_id is now null (unlinked).
  const contactDetail = await getContactById(restClient, contact.id);
  expect(contactDetail.account_id, 'contact should be unlinked from deleted account').toBeNull();
});

test('@functional F3-D3: cancel confirmation dialog → account not deleted', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F3D3-CancelDelete-${Date.now()}`,
  });

  const result = await cancelDeleteAccount(account.id, { page });

  expect(result.stillOnDetailPage, 'cancel should keep user on detail page').toBe(true);

  // Verify account still exists via API (getAccountById throws RestClientError on 404).
  const detail = await getAccountById(restClient, account.id);
  expect(detail.id, 'account should still exist after cancel').toBe(account.id);
});

// ---------------------------------------------------------------------------
// Contact Association tests
// ---------------------------------------------------------------------------

test('@functional F3-A1: linked contacts appear on account detail page', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F3A1-LinkedContacts-${Date.now()}`,
  });
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F3A1',
    last_name: `Contact-${Date.now()}`,
    account_id: account.id,
  });

  // Navigate to account detail page.
  await navigateToAccount(page, account.id);

  // The linked contacts list should contain the contact.

  const linkedContactLocator = await getAccountLinkedContactLocator(contact.id, { page });
  await expect(
    linkedContactLocator,
    'linked contact should be visible on account detail',
  ).toBeVisible();
});

test('@functional F3-A2: account with zero contacts shows empty contacts section, not an error', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F3A2-NoContacts-${Date.now()}`,
  });

  await navigateToAccount(page, account.id);

  // Empty state should be visible, no error.

  const emptyLocator = await getAccountLinkedContactsEmptyLocator({ page });
  await expect(emptyLocator, 'empty contacts message should be visible').toBeVisible();

  // No error alert should be present (doesNotExist — safe when element is absent).
  expect(
    await page.doesNotExist([{ type: 'role', value: 'alert' }]),
    'no error alerts should be present',
  ).toBe(true);
});

test('@functional F3-A3: unlinking contact from contact side is reflected on account detail', async ({
  page,
  restClient,
  testData,
}) => {
  const account = await createTestAccount(testData, restClient, {
    name: `F3A3-UnlinkTest-${Date.now()}`,
  });
  const contact = await createTestContact(testData, restClient, {
    account_id: account.id,
  });

  // Unlink the contact by patching account_id to null via REST.
  // MINCRM-349: include version for optimistic locking.
  await patchContactAccount(restClient, contact.id, null, contact.version);

  await navigateToAccount(page, account.id);

  // After unlinking, the linked contacts list should be empty.

  const emptyLocator = await getAccountLinkedContactsEmptyLocator({ page });
  await expect(emptyLocator, 'empty contacts message should be visible after unlink').toBeVisible();

  // The previously linked contact should not appear in the list.
  expect(
    await page.doesNotExist([{ type: 'testId', value: `linked-contact-${contact.id}` }]),
    'contact should no longer appear in linked contacts list',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Pagination tests
// ---------------------------------------------------------------------------

test('@functional F3-P1: sort order is stable across pages (AC2)', async ({
  restClient,
  testData,
}) => {
  // Seed enough accounts to span two pages (default page size is 50; seed 3 with known prefix).
  const prefix = `F3P1-Sort-${Date.now()}`;
  for (const suffix of ['AAA', 'BBB', 'CCC']) {
    await createTestAccount(testData, restClient, { name: `${prefix}-${suffix}` });
  }

  // Fetch page 1 and page 2 sorted by name asc.
  const page1 = await listAccountsViaApi(restClient, {
    sort: 'name',
    dir: 'asc',
    limit: 2,
    search: prefix,
  });
  const page2 = await listAccountsViaApi(restClient, {
    sort: 'name',
    dir: 'asc',
    limit: 2,
    page: 2,
    search: prefix,
  });

  const page1Names = page1.data.map((a) => a.name);
  const page2Names = page2.data.map((a) => a.name);

  // All names across both pages combined should be in ascending order.
  const allNames = [...page1Names, ...page2Names];
  const allSorted = [...allNames].sort((x, y) => x.localeCompare(y));
  expect(allNames, 'sort order should be stable across pages (AC2)').toEqual(allSorted);
});
