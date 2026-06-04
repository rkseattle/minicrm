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
import {
  navigateToContacts,
  waitForContactInList,
  waitForBulkCheckbox,
  clickBulkCheckbox,
  filterContactsByTerm,
  bulkReassignContacts,
  bulkDeleteContacts,
  getContactById,
  getContactsBulkActionBarLocator,
  isBulkActionBarHidden,
  type ContactRow,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import { deactivateUser } from '@behaviors/minicrm/users.behaviors.js';
import { createTestContact, createTestUser, createTestRep } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Local type extensions
// ---------------------------------------------------------------------------

/** Extends ContactRow with owner_id, which is present in the API response. */
type ContactWithOwner = ContactRow & { owner_id: string };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] } });

// Shared rep credentials, populated by beforeEach, consumed by tests that need
// to re-auth restClient as the rep after an intervening admin operation. (MINCRM-415)
let repEmail = '';
let repPassword = '';

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  repEmail = rep.email;
  repPassword = rep.password;
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

test('@functional F2-BK1: select multiple contacts → bulk reassign → new owner reflected via API', async ({
  page,
  restClient,
  testData,
}) => {
  // restClient is currently authenticated as rep (from beforeEach). We need admin
  // to call createTestUser, then re-auth as rep so the contacts are rep-owned and
  // the browser session (rep) has permission to bulk-reassign them. (MINCRM-415)
  await loginAsAdmin(restClient);

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Create a second rep to reassign to (admin-only operation).
  const newOwner = await createTestUser(restClient, {
    name: `BK1 Owner ${uniqueSuffix}`,
    email: `bk1-owner-${uniqueSuffix}@example.com`,
    role: 'rep',
  });

  // Re-auth as the ephemeral rep so contacts are created with the rep as owner.
  await loginAs(restClient, repEmail, repPassword);

  // Create two contacts owned by the rep.
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

  // Navigate to contacts list, filter to just the test contacts so they are
  // guaranteed on page 1 regardless of total DB size or sort order, then wait
  // for both rows and their checkboxes before clicking.
  await navigateToContacts({ page });
  await filterContactsByTerm(uniqueSuffix, { page });
  await waitForContactInList(c1.id, { page });
  await waitForContactInList(c2.id, { page });

  // Select both contact rows via their checkboxes.
  await waitForBulkCheckbox(c1.id, { page });
  await clickBulkCheckbox(c1.id, { page });
  await waitForBulkCheckbox(c2.id, { page });
  await clickBulkCheckbox(c2.id, { page });

  // Bulk action bar should be visible.

  await expect(await getContactsBulkActionBarLocator({ page })).toBeVisible();

  await bulkReassignContacts(newOwner.id, newOwner.name, { page });

  // Bulk action bar should disappear after success.
  // page.isNotVisible() is used here because resolve() throws
  // StrategyExhaustedError when the element is absent — it cannot be used for
  // not.toBeVisible() assertions. (MINCRM-211)
  expect(await isBulkActionBarHidden({ page })).toBe(true);

  // Verify via API that both contacts now have the new owner.
  const c1Updated = (await getContactById(restClient, c1.id)) as ContactWithOwner;
  expect(c1Updated.owner_id, 'c1 should have new owner').toBe(newOwner.id);

  const c2Updated = (await getContactById(restClient, c2.id)) as ContactWithOwner;
  expect(c2Updated.owner_id, 'c2 should have new owner').toBe(newOwner.id);

  // Deactivate the temp user (users cannot be hard-deleted); re-auth as admin first. (MINCRM-415)
  await loginAsAdmin(restClient);
  await deactivateUser(restClient, newOwner.id);
});

test('@functional F2-BK2: select multiple contacts → bulk delete → contacts return 404 via API', async ({
  page,
  restClient,
  testData,
}) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

  // Navigate to contacts list, filter to just the test contacts so they are
  // guaranteed on page 1 regardless of total DB size or sort order, then wait
  // for both rows and their checkboxes before clicking.
  await navigateToContacts({ page });
  await filterContactsByTerm(uniqueSuffix, { page });
  await waitForContactInList(c1.id, { page });
  await waitForContactInList(c2.id, { page });

  // Select both rows.
  await waitForBulkCheckbox(c1.id, { page });
  await clickBulkCheckbox(c1.id, { page });
  await waitForBulkCheckbox(c2.id, { page });
  await clickBulkCheckbox(c2.id, { page });

  await expect(await getContactsBulkActionBarLocator({ page })).toBeVisible();

  await bulkDeleteContacts({ page }, false, [c1.id, c2.id]);

  // Bulk action bar should disappear.
  expect(await isBulkActionBarHidden({ page })).toBe(true);

  // Verify both contacts return 404 via API.
  const err1 = await restClient.get<never>(`/api/v1/contacts/${c1.id}`).catch((e: unknown) => e);
  expect(err1 instanceof RestClientError && err1.status === 404, 'c1 should be deleted').toBe(true);

  const err2 = await restClient.get<never>(`/api/v1/contacts/${c2.id}`).catch((e: unknown) => e);
  expect(err2 instanceof RestClientError && err2.status === 404, 'c2 should be deleted').toBe(true);
});
