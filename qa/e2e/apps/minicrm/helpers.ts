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
 * Extend as more fields are needed by tests.
 */
export interface TestContact {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  accountId: number | null;
  ownerId: number;
}

/**
 * Fields accepted when creating a contact. All fields optional — defaults are
 * applied by the helper so the minimum viable entity can be created with a
 * single call.
 */
export interface CreateContactOverrides {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  title?: string;
  department?: string;
  accountId?: number;
}

/**
 * Minimal representation of a MiniCRM account as returned by POST /api/accounts.
 */
export interface TestAccount {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  employeeRange: string | null;
  revenueRange: string | null;
  ownerId: number;
}

/**
 * Fields accepted when creating an account. All fields optional.
 */
export interface CreateAccountOverrides {
  name?: string;
  industry?: string;
  website?: string;
  employeeRange?: string;
  revenueRange?: string;
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
  const payload = {
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'Contact',
    email: overrides.email ?? `test-contact-${Date.now()}@example.com`,
    phone: overrides.phone ?? null,
    title: overrides.title ?? null,
    department: overrides.department ?? null,
    accountId: overrides.accountId ?? null,
  };

  // Step 1: create via REST.
  const response = await restClient.post<TestContact>('/api/contacts', payload);
  const contact = response.body;

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
    employeeRange: overrides.employeeRange ?? null,
    revenueRange: overrides.revenueRange ?? null,
  };

  // Step 1: create via REST.
  const response = await restClient.post<TestAccount>('/api/accounts', payload);
  const account = response.body;

  // Step 2: register for teardown.
  testData.register('account', account.id, `/api/accounts/${account.id}`);

  // Step 3: return entity.
  return account;
}
