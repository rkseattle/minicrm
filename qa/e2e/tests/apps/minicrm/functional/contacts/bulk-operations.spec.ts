/**
 * F2-Bulk — Bulk Operations on the Contacts list
 *
 * Covers the bulk-action flows introduced in MINCRM-188:
 *   - Select multiple contacts → bulk reassign → verify new owner via API
 *   - Select multiple contacts → bulk delete → verify 404 via API
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls — all through behaviors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *
 * MINCRM-188
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { navigateToContacts, waitForContactInList } from '@behaviors/minicrm/contacts.behaviors.js';
import { createTestContact, createTestUser } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F2-Bulk] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface ContactSingleResponse {
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    owner_id: string;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@functional F2-BK1: select multiple contacts → bulk reassign → new owner reflected via API', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a second rep to reassign to.
  const newOwner = await createTestUser(restClient, {
    name: `BK1 Owner ${uniqueSuffix}`,
    email: `bk1-owner-${uniqueSuffix}@example.com`,
    role: 'rep',
  });

  // Create two contacts owned by the logged-in admin.
  const c1 = await createTestContact(testData, restClient, {
    first_name: 'BK1A',
    last_name: `Bulk-${uniqueSuffix}`,
    email: `bk1a-${uniqueSuffix}@example.com`,
  });
  const c2 = await createTestContact(testData, restClient, {
    first_name: 'BK1B',
    last_name: `Bulk-${uniqueSuffix}`,
    email: `bk1b-${uniqueSuffix}@example.com`,
  });

  // Navigate to contacts list and wait for the newly created rows to appear.
  await navigateToContacts({ page, healPage, testName });
  await waitForContactInList(c1.id, { page, healPage, testName });
  await waitForContactInList(c2.id, { page, healPage, testName });

  // Select both contact rows via their checkboxes.
  await healPage.click([{ type: 'testId', value: `bulk-select-${c1.id}` }]);
  await healPage.click([{ type: 'testId', value: `bulk-select-${c2.id}` }]);

  // Bulk action bar should be visible.
  await expect(
    await healPage.locate([{ type: 'testId', value: 'bulk-action-bar' }]).resolve(testName),
  ).toBeVisible();

  // Click "Reassign".
  await healPage.click([{ type: 'testId', value: 'bulk-reassign-button' }]);

  // Reassign modal should appear.
  await expect(
    await healPage.locate([{ type: 'testId', value: 'bulk-reassign-modal' }]).resolve(testName),
  ).toBeVisible();

  // Select the new owner in the dropdown.
  await (
    await healPage
      .locate([{ type: 'testId', value: 'bulk-reassign-owner-select' }])
      .resolve(testName)
  ).selectOption({ label: newOwner.name });

  // Confirm.
  await healPage.click([{ type: 'testId', value: 'bulk-reassign-confirm' }]);

  // Bulk action bar should disappear after success.
  await expect(
    await healPage.locate([{ type: 'testId', value: 'bulk-action-bar' }]).resolve(testName),
  ).not.toBeVisible();

  // Verify via API that both contacts now have the new owner.
  const r1 = await restClient.get<ContactSingleResponse>(`/api/contacts/${c1.id}`);
  expect(r1.body.contact.owner_id, 'c1 should have new owner').toBe(newOwner.id);

  const r2 = await restClient.get<ContactSingleResponse>(`/api/contacts/${c2.id}`);
  expect(r2.body.contact.owner_id, 'c2 should have new owner').toBe(newOwner.id);

  // Deactivate the temp user (users cannot be hard-deleted).
  await restClient.patch(`/api/users/${newOwner.id}/deactivate`, {});
});

test('@functional F2-BK2: select multiple contacts → bulk delete → contacts return 404 via API', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create two contacts to be deleted.
  const c1 = await createTestContact(testData, restClient, {
    first_name: 'BK2A',
    last_name: `Bulk-${uniqueSuffix}`,
    email: `bk2a-${uniqueSuffix}@example.com`,
  });
  const c2 = await createTestContact(testData, restClient, {
    first_name: 'BK2B',
    last_name: `Bulk-${uniqueSuffix}`,
    email: `bk2b-${uniqueSuffix}@example.com`,
  });

  // Navigate to contacts list and wait for the newly created rows to appear.
  await navigateToContacts({ page, healPage, testName });
  await waitForContactInList(c1.id, { page, healPage, testName });
  await waitForContactInList(c2.id, { page, healPage, testName });

  // Select both rows.
  await healPage.click([{ type: 'testId', value: `bulk-select-${c1.id}` }]);
  await healPage.click([{ type: 'testId', value: `bulk-select-${c2.id}` }]);

  await expect(
    await healPage.locate([{ type: 'testId', value: 'bulk-action-bar' }]).resolve(testName),
  ).toBeVisible();

  // Click "Delete".
  await healPage.click([{ type: 'testId', value: 'bulk-delete-button' }]);

  // Confirm delete modal should appear.
  await expect(
    await healPage.locate([{ type: 'testId', value: 'confirm-delete-modal' }]).resolve(testName),
  ).toBeVisible();

  // Confirm deletion.
  await healPage.click([{ type: 'testId', value: 'confirm-delete-confirm' }]);

  // Bulk action bar should disappear.
  await expect(
    await healPage.locate([{ type: 'testId', value: 'bulk-action-bar' }]).resolve(testName),
  ).not.toBeVisible();

  // Verify both contacts return 404 via API.
  const err1 = await restClient
    .get<ContactSingleResponse>(`/api/contacts/${c1.id}`)
    .catch((e: unknown) => e);
  expect(err1 instanceof RestClientError && err1.status === 404, 'c1 should be deleted').toBe(true);

  const err2 = await restClient
    .get<ContactSingleResponse>(`/api/contacts/${c2.id}`)
    .catch((e: unknown) => e);
  expect(err2 instanceof RestClientError && err2.status === 404, 'c2 should be deleted').toBe(true);
});
