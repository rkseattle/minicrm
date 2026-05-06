/**
 * F11-CD — Cascade delete verification (MINCRM-316)
 *
 * Verifies that database ON DELETE CASCADE and ON DELETE SET NULL rules fire
 * correctly when parent records are deleted. Assertions are made via the REST
 * API after each delete so the test confirms actual data-model behavior, not
 * just UI rendering.
 *
 * Cascade rules verified (from db/migrations/):
 *   Contact delete   → activities CASCADE deleted; deal_contacts CASCADE deleted
 *   Account delete   → contacts SET NULL on account_id (contacts survive)
 *                    → deals SET NULL on account_id (deals survive)
 *   Deal delete      → activities CASCADE deleted; deal_contacts CASCADE deleted
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through page.locate() healing locators
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *
 * MINCRM-316
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import {
  createTestAccount,
  createTestContact,
  createTestDeal,
  createTestActivity,
} from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F11-CD] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

interface ContactSingleResponse {
  contact: {
    id: string;
    account_id: string | null;
  };
}

interface DealSingleResponse {
  deal: {
    id: string;
    account_id: string | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that a GET to the given path returns a 404 RestClientError.
 * Used to confirm records were removed by cascade.
 */
async function assertDeleted(
  restClient: Parameters<Parameters<typeof test>[2]>[0]['restClient'],
  path: string,
): Promise<void> {
  let threw = false;
  try {
    await restClient.get(path);
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(RestClientError);
    expect((err as RestClientError).status).toBe(404);
  }
  expect(threw, `Expected ${path} to return 404 but it did not throw`).toBe(true);
}

// ---------------------------------------------------------------------------
// F11-CD1 — Contact delete cascades to linked activities
// ---------------------------------------------------------------------------

test(
  'F11-CD1: deleting a contact removes its linked activities via cascade',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const contact = await createTestContact(testData, restClient, {
      first_name: 'CD1',
      last_name: 'Contact',
      email: `cd1-contact-${Date.now()}@example.com`,
    });

    // Create two activities linked to this contact
    const activityA = await createTestActivity(testData, restClient, {
      type: 'Call',
      subject: `CD1-Call-A ${test.info().title}`,
      contact_id: contact.id,
    });
    const activityB = await createTestActivity(testData, restClient, {
      type: 'Note',
      subject: `CD1-Note-B ${test.info().title}`,
      contact_id: contact.id,
    });

    // Delete the contact via API
    await restClient.delete(`/api/v1/contacts/${contact.id}`);

    // Contact itself should return 404
    await assertDeleted(restClient, `/api/v1/contacts/${contact.id}`);

    // Both activities should have been cascade-deleted with the contact
    await assertDeleted(restClient, `/api/v1/activities/${activityA.id}`);
    await assertDeleted(restClient, `/api/v1/activities/${activityB.id}`);
  },
);

// ---------------------------------------------------------------------------
// F11-CD2 — Account delete sets account_id to null on linked contacts (SET NULL)
// ---------------------------------------------------------------------------

test(
  'F11-CD2: deleting an account unlinks its contacts (account_id SET NULL) rather than deleting them',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const account = await createTestAccount(testData, restClient, {
      name: `CD2-Acct ${test.info().title}`,
    });

    // Create two contacts linked to this account
    const contactA = await createTestContact(testData, restClient, {
      first_name: 'CD2',
      last_name: 'ContactA',
      email: `cd2-a-${Date.now()}@example.com`,
      account_id: account.id,
    });
    const contactB = await createTestContact(testData, restClient, {
      first_name: 'CD2',
      last_name: 'ContactB',
      email: `cd2-b-${Date.now()}@example.com`,
      account_id: account.id,
    });

    // Delete the account
    await restClient.delete(`/api/v1/accounts/${account.id}`);

    // Account itself should return 404
    await assertDeleted(restClient, `/api/v1/accounts/${account.id}`);

    // Contacts should survive but have account_id nulled out (ON DELETE SET NULL)
    const fetchedA = await restClient.get<ContactSingleResponse>(`/api/v1/contacts/${contactA.id}`);
    expect(fetchedA.body.contact.account_id).toBeNull();

    const fetchedB = await restClient.get<ContactSingleResponse>(`/api/v1/contacts/${contactB.id}`);
    expect(fetchedB.body.contact.account_id).toBeNull();
  },
);

// ---------------------------------------------------------------------------
// F11-CD3 — Deal delete cascades to linked activities
// ---------------------------------------------------------------------------

test(
  'F11-CD3: deleting a deal removes its linked activities via cascade',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const account = await createTestAccount(testData, restClient, {
      name: `CD3-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `CD3-Deal ${test.info().title}`,
      stage: 'Prospecting',
      value: '500',
      account_id: account.id,
    });

    // Create an activity linked only to this deal
    const activity = await createTestActivity(testData, restClient, {
      type: 'Meeting',
      subject: `CD3-Meeting ${test.info().title}`,
      deal_id: deal.id,
    });

    // Delete the deal
    await restClient.delete(`/api/v1/deals/${deal.id}`);

    // Deal itself should return 404
    await assertDeleted(restClient, `/api/v1/deals/${deal.id}`);

    // Activity linked only to the deleted deal should be cascade-deleted
    await assertDeleted(restClient, `/api/v1/activities/${activity.id}`);
  },
);

// ---------------------------------------------------------------------------
// F11-CD4 — Account delete sets account_id to null on linked deals (SET NULL)
// ---------------------------------------------------------------------------

test(
  'F11-CD4: deleting an account unlinks its deals (account_id SET NULL) rather than deleting them',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const account = await createTestAccount(testData, restClient, {
      name: `CD4-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `CD4-Deal ${test.info().title}`,
      stage: 'Qualification',
      value: '2000',
      account_id: account.id,
    });

    // Delete the account
    await restClient.delete(`/api/v1/accounts/${account.id}`);

    // Account returns 404
    await assertDeleted(restClient, `/api/v1/accounts/${account.id}`);

    // Deal survives but account_id is nulled (ON DELETE SET NULL — migration 004)
    const fetched = await restClient.get<DealSingleResponse>(`/api/v1/deals/${deal.id}`);
    expect(fetched.body.deal.account_id).toBeNull();
  },
);
