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
import { applySessionUpkeep, type SessionUpkeep } from '../auth/token-expiry.js';

// ---------------------------------------------------------------------------
// Fixture type
// ---------------------------------------------------------------------------

/**
 * How the app layer tells this fixture to keep a session alive.
 *
 * The shared shape from the auth layer, narrowed to this client — the same
 * upkeep the standalone batch scripts use, so both paths share one
 * implementation and one set of tests.
 */
export type RestClientSessionRefresh = SessionUpkeep<RestClient>;

/** Fixtures added by this module. */
export interface RestClientFixtures {
  /**
   * RestClient instance scoped per test.
   * Base URL is read from `E2E_API_URL` (defaults to `http://localhost:3001`).
   * No auth strategy is set by default — construct a RestClient directly with
   * an authStrategy when needed.
   */
  restClient: RestClient;

  /**
   * Opt-in session upkeep for the `restClient` fixture.
   *
   * Null by default, which leaves the fixture behaving exactly as it always
   * has. When an app layer supplies one, the fixture checks the named cookie
   * before each test and refreshes it if the token is nearing expiry — the
   * same protection the `page` fixture already has, for the REST half.
   *
   * Injected rather than imported because this layer cannot reach app-specific
   * routes or credentials.
   */
  restClientSessionRefresh: RestClientSessionRefresh | null;
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
  // Option, not a fixture: app layers override it via test.use() or their own
  // extend(). Null keeps this layer's behavior unchanged for every consumer
  // that does not opt in.
  restClientSessionRefresh: [null, { option: true }],

  restClient: async ({ request, restClientSessionRefresh }, use) => {
    // E2E_API_URL is the canonical API origin. RestClient falls back to its own
    // default (http://localhost:3001) when the env var is absent.
    const baseUrl = process.env['E2E_API_URL'];
    const client = new RestClient(request, baseUrl ? { baseUrl } : {});

    await applySessionUpkeep(client, restClientSessionRefresh);

    await use(client);
    // No explicit teardown needed — Playwright disposes the underlying
    // APIRequestContext at the end of the test.
  },
});
