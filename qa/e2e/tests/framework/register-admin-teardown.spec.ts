/**
 * registerAdminTeardown — unit specs.
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
import type { RestClient, SchemaError } from '@framework/clients/rest-client.js';
import { RestClientError } from '@framework/clients/rest-client.js';

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
 * The one status `registerAdminTeardown` may swallow. Declared here rather than
 * imported so the spec asserts the contracted value independently — importing
 * the helper's own constant would make a change to it invisible to this test.
 */
const HTTP_NOT_FOUND = 404;

/** Statuses that mean the record is still in the database. */
const RECORD_STILL_EXISTS_STATUSES = [403, 500];

/**
 * RestClient stub that records every call in order.
 *
 * One factory for every stub in this file: three shapes drifted apart before,
 * and because they are `as unknown as RestClient` the compiler could not see
 * that one had silently dropped `get`. A single shape means a future method the
 * helper starts calling is missing from all stubs at once, not just one.
 *
 * @param onDelete - Optional DELETE behavior. Omit for a successful 204; supply
 *   a thrower to drive the swallow-vs-propagate boundary. It still records the
 *   call before throwing, so ordering assertions hold on failing paths too.
 * @returns The stub client and the ordered call log.
 */
function makeRecordingClient(onDelete?: () => never): { client: RestClient; calls: string[] } {
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
      if (onDelete) onDelete();
      return { status: 204, body: undefined as never, headers: {} };
    },
  } as unknown as RestClient;

  return { client, calls };
}

/**
 * A DELETE behavior that rejects with a RestClientError of the given status.
 *
 * @param status - HTTP status to reject with.
 * @param validationError - Set to simulate a schema-parse failure, which shares
 *   the RestClientError class with an error status.
 * @returns A thrower for `makeRecordingClient`.
 */
function rejectsWith(status: number, validationError?: SchemaError): () => never {
  return () => {
    throw new RestClientError(status, { error: { code: 'STUBBED' } }, validationError);
  };
}

test.describe('registerAdminTeardown', () => {
  test('authenticates as admin before issuing the DELETE', async () => {
    // The property every caller depends on. Specs that re-authenticate the
    // shared restClient as a rep would otherwise delete AS that rep and take a
    // 403, leaving the record in the database. Since a later change, that 403 is
    // reported rather than swallowed — the cases below assert it — but the
    // record still leaks, so re-authenticating first is what actually prevents
    // the failure this guard exists to close.
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

  // ── Swallow-vs-propagate boundary ────────────────────────────
  // The helper used to `.catch(() => undefined)` every error, so a 403 or 500 —
  // precisely the cases where the record IS still in the database — was
  // reported as successful cleanup. Only a 404 means "already gone".

  test('reports success when the DELETE 404s, because the record is already gone', async () => {
    // The happy path for a test that deleted the record itself through the UI.
    // leads.spec.ts, pipelines.spec.ts, and ai.spec.ts all depend on this: a
    // "teardown failed" line on every green run trains readers to ignore it.
    const { client } = makeRecordingClient(rejectsWith(HTTP_NOT_FOUND));
    const manager = new TestDataManager();

    registerAdminTeardown(manager, client, 'lead', '7', '/api/v1/leads/7');
    const results = await manager.teardown(client);

    expect(results[0]?.success, 'a 404 must be swallowed as already-deleted').toBe(true);
  });

  for (const status of RECORD_STILL_EXISTS_STATUSES) {
    test(`reports failure when the DELETE returns ${status}, because the record still exists`, async () => {
      const { client } = makeRecordingClient(rejectsWith(status));
      const manager = new TestDataManager();

      registerAdminTeardown(manager, client, 'contact', '42', '/api/v1/contacts/42');
      const results = await manager.teardown(client);

      expect(
        results[0]?.success,
        `a ${status} leaves the record in the database and must not report success`,
      ).toBe(false);
      expect(results[0]?.error, 'the failure must carry a diagnosable message').toBeTruthy();
    });
  }

  test('reports failure on a network error, which is not an HTTP status at all', async () => {
    const { client } = makeRecordingClient(() => {
      throw new Error('ECONNREFUSED');
    });
    const manager = new TestDataManager();

    registerAdminTeardown(manager, client, 'contact', '9', '/api/v1/contacts/9');
    const results = await manager.teardown(client);

    expect(results[0]?.success, 'a network error must not report successful cleanup').toBe(false);
  });

  test('reports failure on a 404 that is really a schema-parse error', async () => {
    // A constructed invariant, not a reachable production state: parseResponse
    // throws on `status >= 400` before schema validation (rest-client.ts:352),
    // so a real parse failure always carries a 2xx. This pins the guard's
    // intent — RestClientError is one class for two unrelated failures, and
    // only an error status means "the record is gone".
    const schemaError = Object.assign(new Error('parse failed'), {
      issues: [],
    }) as unknown as SchemaError;
    const { client } = makeRecordingClient(rejectsWith(HTTP_NOT_FOUND, schemaError));
    const manager = new TestDataManager();

    registerAdminTeardown(manager, client, 'contact', '5', '/api/v1/contacts/5');
    const results = await manager.teardown(client);

    expect(results[0]?.success, 'a schema failure must not be swallowed as a 404').toBe(false);
  });
});
