/**
 * MiniCRM setup helpers — canonical pattern for creating test entities.
 *
 * Each helper:
 *   1. Creates the entity via RestClient.
 *   2. Registers the returned ID and delete path with TestDataManager.
 *   3. Returns the created entity so the caller can use it in assertions.
 *
 * Helpers accept an `overrides` object so tests can supply specific field
 * values (e.g. a known email address) without having to re-implement the full
 * default payload.
 *
 * New helpers for other entity types (deals, activities, accounts) follow the
 * exact same shape — see inline comments for the required steps.
 *
 * MINCRM-129
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { TestDataManager } from './test-data-manager.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/**
 * Minimal representation of a MiniCRM contact as returned by POST /api/contacts.
 * Field names match the server's snake_case ContactRow shape.
 * Extend as more fields are needed by tests.
 */
export interface TestContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  account_id: string | null;
  owner_id: string;
}

/**
 * Fields accepted when creating a contact. All fields optional — defaults are
 * applied by the helper so the minimum viable entity can be created with a
 * single call.
 *
 * Uses snake_case to match the server's createContactSchema validation.
 */
export interface CreateContactOverrides {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
  account_id?: string;
}

/**
 * Minimal representation of a MiniCRM account as returned by POST /api/accounts.
 */
export interface TestAccount {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  employee_range: string | null;
  revenue_range: string | null;
  owner_id: string;
}

/**
 * Fields accepted when creating an account. All fields optional.
 *
 * Uses snake_case to match the server's validation schema.
 */
export interface CreateAccountOverrides {
  name?: string;
  industry?: string;
  website?: string;
  employee_range?: string;
  revenue_range?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a contact via the REST API, registers it with TestDataManager, and
 * returns the created contact.
 *
 * Merge `overrides` to supply specific field values; defaults produce a valid
 * minimal contact that satisfies server-side Zod validation.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Optional field overrides for the contact payload.
 * @returns The created contact as returned by the server.
 */
export async function createTestContact(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateContactOverrides = {},
): Promise<TestContact> {
  // phone, title, department are optional (not nullable) in the server schema —
  // omit them entirely rather than sending null, which Zod rejects with 400.
  const payload: Record<string, string | null> = {
    first_name: overrides.first_name ?? 'Test',
    last_name: overrides.last_name ?? 'Contact',
    email:
      overrides.email ??
      `test-contact-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    account_id: overrides.account_id ?? null,
  };
  if (overrides.phone !== undefined) payload['phone'] = overrides.phone;
  if (overrides.title !== undefined) payload['title'] = overrides.title;
  if (overrides.department !== undefined) payload['department'] = overrides.department;

  // Step 1: create via REST.
  // Server returns { contact: ContactRow } — unwrap the nested object.
  const response = await restClient.post<{ contact: TestContact }>('/api/contacts', payload);
  const contact = response.body.contact;

  // Step 2: register for teardown immediately so cleanup runs even if the
  // test throws before completing setup.
  testData.register('contact', contact.id, `/api/contacts/${contact.id}`);

  // Step 3: return entity for test assertions.
  return contact;
}

/**
 * Creates an account via the REST API, registers it with TestDataManager, and
 * returns the created account.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Authenticated RestClient instance.
 * @param overrides - Optional field overrides for the account payload.
 * @returns The created account as returned by the server.
 */
export async function createTestAccount(
  testData: TestDataManager,
  restClient: RestClient,
  overrides: CreateAccountOverrides = {},
): Promise<TestAccount> {
  const payload = {
    name: overrides.name ?? `Test Account ${Date.now()}`,
    industry: overrides.industry ?? null,
    website: overrides.website ?? null,
    employee_range: overrides.employee_range ?? null,
    revenue_range: overrides.revenue_range ?? null,
  };

  // Step 1: create via REST.
  // Server returns { account: AccountRow } — unwrap the nested object.
  const response = await restClient.post<{ account: TestAccount }>('/api/accounts', payload);
  const account = response.body.account;

  // Step 2: register for teardown.
  testData.register('account', account.id, `/api/accounts/${account.id}`);

  // Step 3: return entity.
  return account;
}
