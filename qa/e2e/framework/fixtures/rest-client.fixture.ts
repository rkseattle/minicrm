/**
 * restClient fixture — provides a RestClient instance per test.
 *
 * Wraps Playwright's built-in `request` fixture (which is already isolated
 * per worker) so each test gets an independent RestClient with no shared state.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '@framework/fixtures';
 *
 * test('creates a contact', async ({ restClient }) => {
 *   const response = await restClient.post<Contact>('/api/contacts', { name: 'Alice' });
 *   expect(response.status).toBe(201);
 * });
 * ```
 *
 * MINCRM-127
 */

import { test as base } from '@playwright/test';
import { RestClient } from '../clients/rest-client.js';

// ---------------------------------------------------------------------------
// Fixture type
// ---------------------------------------------------------------------------

/** Fixtures added by this module. */
export interface RestClientFixtures {
  /**
   * RestClient instance scoped per test.
   * Base URL is read from `E2E_BASE_URL` (defaults to `http://localhost:5173`).
   * No auth strategy is set by default — construct a RestClient directly with
   * an authStrategy when needed.
   */
  restClient: RestClient;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

/**
 * Playwright test extended with the `restClient` fixture.
 *
 * Re-exported and merged at the fixtures/index.ts level — do not import
 * this directly in test specs.
 */
export const test = base.extend<RestClientFixtures>({
  restClient: async ({ request }, use) => {
    const client = new RestClient(request);
    await use(client);
    // No explicit teardown needed — Playwright disposes the underlying
    // APIRequestContext at the end of the test.
  },
});
