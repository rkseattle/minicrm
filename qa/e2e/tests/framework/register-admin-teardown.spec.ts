/**
 * registerAdminTeardown — unit specs (MINCRM-686).
 *
 * Covers the helper in qa/e2e/apps/minicrm/helpers.ts that registers a teardown
 * which re-authenticates as an admin before deleting.
 *
 * WHY THIS LIVES UNDER tests/framework/ RATHER THAN NEXT TO test-data-manager.spec.ts
 * ---------------------------------------------------------------------------------
 * tests/framework/ is the only spec directory CI runs unconditionally, via
 * `test:framework:coverage` (qa/package.json). Everything under
 * tests/apps/minicrm/ reaches CI only through a `--grep @functional` filter, and
 * test-data-manager.spec.ts carries no tags — so specs placed beside it do not
 * execute in any CI job. The ordering guarantee asserted here is the entire
 * point of the helper, so it needs a home where a regression actually fails a
 * build.
 *
 * No real server is required. RestClient is replaced with a recording stub.
 */

import { test, expect } from '@playwright/test';
import { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import { registerAdminTeardown } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// loginAsAdmin() throws when E2E_ADMIN_PASSWORD is unset (auth.behaviors.ts:57).
// These specs run with no server and no .env — supply a value so the helper
// reaches its POST, which is the call being asserted. Restored afterwards so a
// suite that mixes these with server-backed specs is unaffected.
const originalAdminPassword = process.env['E2E_ADMIN_PASSWORD'];

test.beforeAll(() => {
  process.env['E2E_ADMIN_PASSWORD'] = 'stub-password-not-used-against-a-server';
});

test.afterAll(() => {
  if (originalAdminPassword === undefined) {
    delete process.env['E2E_ADMIN_PASSWORD'];
  } else {
    process.env['E2E_ADMIN_PASSWORD'] = originalAdminPassword;
  }
});

/**
 * RestClient stub that records every call in order.
 *
 * @returns The stub client and the ordered call log.
 */
function makeRecordingClient(): { client: RestClient; calls: string[] } {
  const calls: string[] = [];

  const client = {
    post: async (path: string) => {
      calls.push(`POST ${path}`);
      return { status: 200, body: {} as never, headers: {} };
    },
    get: async (path: string) => {
      calls.push(`GET ${path}`);
      return { status: 200, body: {} as never, headers: {} };
    },
    delete: async (path: string) => {
      calls.push(`DELETE ${path}`);
      return { status: 204, body: undefined as never, headers: {} };
    },
  } as unknown as RestClient;

  return { client, calls };
}

test.describe('registerAdminTeardown', () => {
  test('authenticates as admin before issuing the DELETE', async () => {
    // The property every caller depends on. Specs that re-authenticate the
    // shared restClient as a rep would otherwise delete AS that rep and take a
    // 403, which TestDataManager logs and swallows — leaking the record while
    // the run still reports success. That silent-failure mode is what
    // MINCRM-686 exists to close.
    const { client, calls } = makeRecordingClient();
    const manager = new TestDataManager();

    registerAdminTeardown(manager, client, 'contact', '42', '/api/v1/contacts/42');
    const results = await manager.teardown(client);

    const loginIndex = calls.findIndex((c) => c.includes('/auth/login'));
    const deleteIndex = calls.indexOf('DELETE /api/v1/contacts/42');

    expect(loginIndex, 'an auth login must be issued during teardown').toBeGreaterThanOrEqual(0);
    expect(deleteIndex, 'the DELETE must be issued').toBeGreaterThanOrEqual(0);
    expect(loginIndex, 'the login must precede the DELETE').toBeLessThan(deleteIndex);
    expect(results[0]?.success).toBe(true);
  });

  test('registers exactly one teardown entry per call', async () => {
    const { client } = makeRecordingClient();
    const manager = new TestDataManager();

    registerAdminTeardown(manager, client, 'contact', '1', '/api/v1/contacts/1');
    registerAdminTeardown(manager, client, 'account', '2', '/api/v1/accounts/2');

    expect(manager.count).toBe(2);
  });

  test('interleaves with plain register() entries in reverse registration order', async () => {
    // Registration order is the contract callers reason about when one record
    // references another (a deal on an account). Mixing the two entry kinds
    // must not reorder them relative to each other.
    const { client, calls } = makeRecordingClient();
    const manager = new TestDataManager();

    manager.register('account', 1, '/api/v1/accounts/1');
    registerAdminTeardown(manager, client, 'deal', '2', '/api/v1/deals/2');

    await manager.teardown(client);

    const deletes = calls.filter((c) => c.startsWith('DELETE '));
    expect(deletes).toEqual(['DELETE /api/v1/deals/2', 'DELETE /api/v1/accounts/1']);
  });
});
