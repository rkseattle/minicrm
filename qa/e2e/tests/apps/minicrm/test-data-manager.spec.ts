/**
 * Tests for TestDataManager — surgical teardown behaviour.
 *
 * Acceptance criteria verified here:
 *   AC1 — Only registered entities are deleted; unregistered records are untouched.
 *   AC2 — Teardown executes even when the test body throws before completing.
 *   AC3 — A partial teardown failure (simulated REST error) logs the error and
 *          continues deleting the remaining entities.
 *   AC4 — TestDataManager never issues bulk deletes; exactly one delete() call
 *          per registered entity is made.
 *
 * No real server is required. RestClient is replaced with a lightweight stub
 * that records calls and can be configured to throw on specific paths.
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Stub RestClient
// ---------------------------------------------------------------------------

/**
 * Minimal RestClient stub that records delete() calls and can be configured
 * to throw RestClientError for specific paths.
 *
 * @param failPaths - Paths on which delete() should throw RestClientError(500).
 * @returns Stub client and a deletedPaths array for assertions.
 */
function makeStubClient(
  failPaths: Set<string> = new Set(),
  failStatus = 500,
): {
  client: RestClient;
  deletedPaths: string[];
} {
  const deletedPaths: string[] = [];

  const client = {
    delete: async (path: string) => {
      deletedPaths.push(path);
      if (failPaths.has(path)) {
        throw new RestClientError(failStatus, {
          error: { code: 'STUBBED', message: `simulated ${failStatus}` },
        });
      }
      return { status: 204, body: undefined as never, headers: {} };
    },
  } as unknown as RestClient;

  return { client, deletedPaths };
}

// ---------------------------------------------------------------------------
// Basic registration
// ---------------------------------------------------------------------------

test.describe('TestDataManager — registration', () => {
  test('starts with count 0', async () => {
    const manager = new TestDataManager();
    expect(manager.count).toBe(0);
  });

  test('increments count on each register() call', async () => {
    const manager = new TestDataManager();

    manager.register('contact', 1, '/api/v1/contacts/1');
    expect(manager.count).toBe(1);

    manager.register('contact', 2, '/api/v1/contacts/2');
    expect(manager.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC1 — Only registered entities deleted; unregistered records untouched
// ---------------------------------------------------------------------------

test.describe('AC1 — surgical deletion', () => {
  test('deletes only the registered paths — no extra calls', async () => {
    const { client, deletedPaths } = makeStubClient();
    const manager = new TestDataManager();

    manager.register('contact', 10, '/api/v1/contacts/10');
    manager.register('contact', 20, '/api/v1/contacts/20');

    await manager.teardown(client);

    // Exactly 2 deletes, one per registered entity — no bulk operations.
    expect(deletedPaths).toHaveLength(2);
    expect(deletedPaths).toContain('/api/v1/contacts/10');
    expect(deletedPaths).toContain('/api/v1/contacts/20');
  });

  test('returns success results for each deleted entity', async () => {
    const { client } = makeStubClient();
    const manager = new TestDataManager();

    manager.register('contact', 10, '/api/v1/contacts/10');
    manager.register('account', 5, '/api/v1/accounts/5');

    const results = await manager.teardown(client);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  test('issues zero delete calls when nothing is registered', async () => {
    const { client, deletedPaths } = makeStubClient();
    const manager = new TestDataManager();

    const results = await manager.teardown(client);

    expect(deletedPaths).toHaveLength(0);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC4 — No bulk deletes; one DELETE per entity
// ---------------------------------------------------------------------------

test.describe('AC4 — no bulk deletes', () => {
  test('each registered entity receives exactly one individual delete() call', async () => {
    const { client, deletedPaths } = makeStubClient();
    const manager = new TestDataManager();

    const ids = [1, 2, 3, 4, 5];
    for (const id of ids) {
      manager.register('contact', id, `/api/v1/contacts/${id}`);
    }

    await manager.teardown(client);

    // delete() must be called exactly once per entity — never with a list or
    // a batch path that could affect multiple records.
    expect(deletedPaths).toHaveLength(ids.length);
    for (const id of ids) {
      expect(deletedPaths).toContain(`/api/v1/contacts/${id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Reverse-order teardown
// ---------------------------------------------------------------------------

test.describe('TestDataManager — reverse-order teardown', () => {
  test('deletes entities in reverse registration order', async () => {
    const { client, deletedPaths } = makeStubClient();
    const manager = new TestDataManager();

    manager.register('account', 1, '/api/v1/accounts/1'); // registered first
    manager.register('contact', 2, '/api/v1/contacts/2'); // registered second

    await manager.teardown(client);

    // Contact (last registered) must be deleted first, then account.
    expect(deletedPaths[0]).toBe('/api/v1/contacts/2');
    expect(deletedPaths[1]).toBe('/api/v1/accounts/1');
  });
});

// ---------------------------------------------------------------------------
// AC2 — Teardown runs even when the test body throws
// ---------------------------------------------------------------------------

test.describe('AC2 — teardown on test failure', () => {
  test('teardown() is safe to call from a finally block when a throw precedes it', async () => {
    // Verifies that TestDataManager.teardown() itself does not throw and
    // correctly returns results when called from a finally block after an
    // error. This is the property that makes it safe to wire into the
    // fixture's finally clause — it does NOT verify that the fixture wiring
    // in fixtures.ts calls teardown (that is a structural guarantee of the
    // fixture code, not something unit tests can exercise without a real
    // Playwright worker).
    const { client, deletedPaths } = makeStubClient();
    const manager = new TestDataManager();

    manager.register('deal', 7, '/api/v1/deals/7');

    let teardownResults = null;
    let testBodyThrew = false;
    try {
      throw new Error('simulated test failure');
    } catch {
      testBodyThrew = true;
    } finally {
      teardownResults = await manager.teardown(client);
    }

    expect(testBodyThrew).toBe(true);
    expect(deletedPaths).toContain('/api/v1/deals/7');
    expect(teardownResults).toHaveLength(1);
    expect(teardownResults[0].success).toBe(true);
  });

  test('registry is cleared after teardown — second call is a no-op', async () => {
    const { client, deletedPaths } = makeStubClient();
    const manager = new TestDataManager();

    manager.register('contact', 1, '/api/v1/contacts/1');

    await manager.teardown(client);
    expect(manager.count).toBe(0);

    // Second teardown issues no additional calls.
    await manager.teardown(client);
    expect(deletedPaths).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Partial failure continues cleanup
// ---------------------------------------------------------------------------

test.describe('AC3 — partial teardown failure', () => {
  test('a failing delete does not abort cleanup of remaining entities', async () => {
    // Register 3 entities; the middle one will return a 500.
    const failPaths = new Set(['/api/v1/contacts/2']);
    const { client, deletedPaths } = makeStubClient(failPaths);
    const manager = new TestDataManager();

    manager.register('contact', 1, '/api/v1/contacts/1'); // will succeed
    manager.register('contact', 2, '/api/v1/contacts/2'); // will fail (500)
    manager.register('contact', 3, '/api/v1/contacts/3'); // will succeed

    const results = await manager.teardown(client);

    // All three deletes must have been attempted.
    expect(deletedPaths).toHaveLength(3);

    // Teardown order is reversed: 3, 2, 1.
    expect(deletedPaths[0]).toBe('/api/v1/contacts/3');
    expect(deletedPaths[1]).toBe('/api/v1/contacts/2');
    expect(deletedPaths[2]).toBe('/api/v1/contacts/1');

    // Results: first (id=3) and third (id=1) succeeded; second (id=2) failed.
    expect(results[0]).toMatchObject({ id: 3, success: true });
    expect(results[1]).toMatchObject({ id: 2, success: false });
    expect(results[2]).toMatchObject({ id: 1, success: true });

    // The failure record includes an error message referencing the status code.
    expect(results[1].error).toBeTruthy();
    expect(results[1].error).toMatch(/500/);
  });

  test('partial failure result includes the error message', async () => {
    const failPaths = new Set(['/api/v1/deals/42']);
    const { client } = makeStubClient(failPaths);
    const manager = new TestDataManager();

    manager.register('deal', 42, '/api/v1/deals/42');

    const results = await manager.teardown(client);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeTruthy();
    expect(results[0].error).toMatch(/500/);
  });
});

// ---------------------------------------------------------------------------
// teardown — a 404 means the record is already gone
// ---------------------------------------------------------------------------

test.describe('TestDataManager — 404 handling on teardown', () => {
  test('reports a 404 as SUCCESS, because the record is already gone', async () => {
    // Tests that delete their own record through the UI (contacts F2-D1,
    // accounts F3-D1/D2) reach teardown with nothing left to delete. Reporting
    // that as a failure would annotate every green run of those tests, and a
    // warning that fires when nothing is wrong is one readers learn to skip.
    const manager = new TestDataManager();
    const { client } = makeStubClient(new Set(['/api/v1/contacts/1']), 404);

    manager.register('contact', 1, '/api/v1/contacts/1');
    const results = await manager.teardown(client);

    expect(results[0]?.success, 'an already-deleted record is cleaned up, not leaked').toBe(true);
    expect(results[0]?.error, 'a success carries no error').toBeUndefined();
  });

  for (const status of [403, 500]) {
    test(`reports a ${status} as FAILURE, because the record is still there`, async () => {
      const manager = new TestDataManager();
      const { client } = makeStubClient(new Set(['/api/v1/contacts/2']), status);

      manager.register('contact', 2, '/api/v1/contacts/2');
      const results = await manager.teardown(client);

      expect(results[0]?.success, `a ${status} leaves the row in the database`).toBe(false);
      expect(results[0]?.error, 'the failure must be diagnosable').toBeTruthy();
    });
  }
});
