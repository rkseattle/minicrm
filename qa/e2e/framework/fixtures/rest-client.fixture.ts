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
 * test('creates an item', async ({ restClient }) => {
 *   const response = await restClient.post<Item>('/api/items', { name: 'Widget' });
 *   expect(response.status).toBe(201);
 * });
 * ```
 *
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
   * Base URL is read from `E2E_API_URL` (defaults to `http://localhost:3001`).
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
    // E2E_API_URL is the canonical API origin. RestClient falls back to its own
    // default (http://localhost:3001) when the env var is absent.
    const baseUrl = process.env['E2E_API_URL'];
    const client = new RestClient(request, baseUrl ? { baseUrl } : {});
    await use(client);
    // No explicit teardown needed — Playwright disposes the underlying
    // APIRequestContext at the end of the test.
  },
});
