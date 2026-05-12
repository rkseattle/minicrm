/**
 * F-OL — Optimistic locking on core CRM entities (MINCRM-349)
 *
 * Verifies that concurrent PATCH requests with a stale version are rejected
 * with 409 OPTIMISTIC_LOCK_CONFLICT, while requests with the current version
 * succeed and increment the version counter.
 *
 * All assertions are made via the REST API — no browser interaction required.
 * Entities tested: contact, account, deal, activity.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *
 * MINCRM-349
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import {
  createTestContact,
  createTestAccount,
  createTestDeal,
  createTestActivity,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { patchContact } from '@behaviors/minicrm/contacts.behaviors.js';
import { patchAccount } from '@behaviors/minicrm/accounts.behaviors.js';
import { patchDeal } from '@behaviors/minicrm/deals.behaviors.js';
import { patchActivity } from '@behaviors/minicrm/activities.behaviors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that a PATCH returns 409 OPTIMISTIC_LOCK_CONFLICT.
 */
async function assertConflict(
  restClient: Parameters<Parameters<typeof test>[2]>[0]['restClient'],
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  let threw = false;
  try {
    await restClient.patch(path, body);
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(RestClientError);
    expect((err as RestClientError).status).toBe(409);
  }
  expect(threw, `Expected ${path} PATCH to return 409 but it did not throw`).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test(
  'F-OL1: contact — version increments on update; stale version returns 409',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const contact = await createTestContact(testData, restClient, {
      first_name: 'OL',
      last_name: 'ContactTest',
    });
    expect(contact.version).toBe(1);

    const updated = await patchContact(restClient, contact.id, {
      first_name: 'Edited',
      version: contact.version,
    });
    expect(updated.version).toBe(2);

    // Stale PATCH with original version must be rejected
    await assertConflict(restClient, `/api/v1/contacts/${contact.id}`, {
      first_name: 'Stale',
      version: contact.version,
    });
  },
);

test(
  'F-OL2: account — version increments on update; stale version returns 409',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const account = await createTestAccount(testData, restClient, { name: 'OL Account Test' });
    expect(account.version).toBe(1);

    const updated = await patchAccount(restClient, account.id, {
      name: 'Edited Name',
      version: account.version,
    });
    expect(updated.version).toBe(2);

    await assertConflict(restClient, `/api/v1/accounts/${account.id}`, {
      name: 'Stale Edit',
      version: account.version,
    });
  },
);

test(
  'F-OL3: deal — version increments on update; stale version returns 409',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const account = await createTestAccount(testData, restClient, { name: 'OL Deal Account' });
    const deal = await createTestDeal(testData, restClient, {
      name: 'OL Deal Test',
      stage: 'Prospecting',
      account_id: account.id,
    });
    expect(deal.version).toBe(1);

    const updated = await patchDeal(restClient, deal.id, {
      name: 'Edited Deal',
      version: deal.version,
    });
    expect(updated.version).toBe(2);

    await assertConflict(restClient, `/api/v1/deals/${deal.id}`, {
      name: 'Stale Edit',
      version: deal.version,
    });
  },
);

test(
  'F-OL4: activity — version increments on update; stale version returns 409',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await loginAsAdmin(restClient);

    const account = await createTestAccount(testData, restClient, {
      name: 'OL Activity Account',
    });
    const activity = await createTestActivity(testData, restClient, {
      type: 'Note',
      subject: 'OL Activity Test',
      account_id: account.id,
    });
    expect(activity.version).toBe(1);

    const updated = await patchActivity(restClient, activity.id, {
      subject: 'Edited Subject',
      version: activity.version,
    });
    expect(updated.version).toBe(2);

    await assertConflict(restClient, `/api/v1/activities/${activity.id}`, {
      subject: 'Stale Edit',
      version: activity.version,
    });
  },
);
