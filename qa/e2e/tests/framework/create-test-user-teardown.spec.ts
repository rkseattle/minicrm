/**
 * createTestUser teardown registration — unit specs (MINCRM-668).
 *
 * Covers the guarantee that makes the helper safe: the deactivation entry is
 * registered as soon as the server reports a user id, BEFORE the response
 * envelope is validated and before set-password and onboarding run. Every one
 * of those steps can throw, and before MINCRM-668 a throw left the user row
 * behind with nothing to clean it up.
 *
 * WHY THIS LIVES UNDER tests/framework/
 * -------------------------------------
 * Same reason as register-admin-teardown.spec.ts: tests/framework/ is the only
 * spec directory CI runs unconditionally, via `test:framework:coverage`
 * (qa/package.json). Specs under tests/apps/minicrm/ reach CI only through a
 * `--grep @functional` filter. Without a home here, a regression that deleted
 * the registerCustomTeardown call would pass every job — the 16 surviving
 * `finally` blocks at the call sites would keep the functional suite green
 * while the four unprotected paths silently leaked again.
 *
 * No real server is required. RestClient is replaced with a scripted stub.
 */

import { test, expect } from '@playwright/test';
import { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import { createTestUser } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// loginAsAdmin() and resolveAdminCredentials() both throw when
// E2E_ADMIN_PASSWORD is unset. These specs run with no server and no .env —
// supply a value so the helper reaches the calls being asserted.
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
 * Id the stubbed invite endpoint reports for the created user. A real UUID:
 * `userResponseSchema` requires `id` to be one, and these specs assert on the
 * envelope check, so the happy-path body must actually satisfy it.
 */
const STUB_USER_ID = '3f8c1d2e-5a4b-4c6d-8e9f-0a1b2c3d4e5f';

/**
 * RestClient stub whose POST handling is scripted per path.
 *
 * @param options - `failOn` names a path substring whose POST should reject,
 *   simulating a step that throws after the user row already exists.
 *   `inviteBody` overrides the invite response body.
 * @returns The stub client and the ordered call log.
 */
function makeScriptedClient(options: { failOn?: string; inviteBody?: unknown } = {}): {
  client: RestClient;
  calls: string[];
} {
  const calls: string[] = [];

  const client = {
    post: async (path: string) => {
      calls.push(`POST ${path}`);
      if (options.failOn !== undefined && path.includes(options.failOn)) {
        throw new Error(`stubbed failure for ${path}`);
      }
      if (path.includes('/users/invite')) {
        return {
          status: 201,
          body: (options.inviteBody ?? {
            user: {
              id: STUB_USER_ID,
              email: 'stub@example.com',
              name: 'Stub User',
              role: 'rep',
              status: 'invited',
              must_change_password: false,
              created_at: '2026-08-15T00:00:00.000Z',
            },
            inviteToken: 'stub-invite-token',
          }) as never,
          headers: {},
        };
      }
      return { status: 200, body: {} as never, headers: {} };
    },
    put: async (path: string) => {
      calls.push(`PUT ${path}`);
      return { status: 200, body: {} as never, headers: {} };
    },
    patch: async (path: string) => {
      calls.push(`PATCH ${path}`);
      return { status: 200, body: {} as never, headers: {} };
    },
  } as unknown as RestClient;

  return { client, calls };
}

test.describe('createTestUser teardown registration', () => {
  test('registers exactly one deactivation entry on the happy path', async () => {
    const manager = new TestDataManager();
    const { client } = makeScriptedClient();

    await createTestUser(manager, client);

    expect(manager.count, 'one teardown entry should be registered').toBe(1);
  });

  test('registers the deactivation before set-password, so a throw there still cleans up', async () => {
    const manager = new TestDataManager();
    const { client } = makeScriptedClient({ failOn: '/users/set-password' });

    await expect(
      createTestUser(manager, client),
      'a set-password failure should propagate to the caller',
    ).rejects.toThrow(/stubbed failure/);

    expect(
      manager.count,
      'the user was created before the failure, so its teardown must still be registered',
    ).toBe(1);
  });

  test('registers the deactivation before the envelope is validated', async () => {
    const manager = new TestDataManager();
    // A body carrying a usable id but violating the response schema: the server
    // committed the row, so teardown must be registered even though the shape
    // assertion below fails.
    const { client } = makeScriptedClient({
      inviteBody: { user: { id: STUB_USER_ID }, inviteToken: 42 },
    });

    await expect(
      createTestUser(manager, client),
      'envelope drift should surface as an error',
    ).rejects.toThrow(/schema validation/);

    expect(
      manager.count,
      'a schema failure must not leak the user the server already created',
    ).toBe(1);
  });

  test('registers the deactivation even when the envelope renames the user key', async () => {
    const manager = new TestDataManager();
    // The likeliest drift: `user` renamed to `data`. Reading the id as
    // `response.body.user.id` would throw a TypeError here and register
    // nothing, leaking the row the server already committed.
    const { client } = makeScriptedClient({
      inviteBody: { data: { id: STUB_USER_ID }, inviteToken: 'stub-invite-token' },
    });

    await expect(
      createTestUser(manager, client),
      'a renamed envelope key should still surface as an error',
    ).rejects.toThrow();

    expect(
      manager.count,
      'the id was still readable from the raw body, so teardown must be registered',
    ).toBe(1);
  });

  test('the registered entry deactivates the created user as admin', async () => {
    const manager = new TestDataManager();
    const { client, calls } = makeScriptedClient();

    await createTestUser(manager, client);
    calls.length = 0;

    await manager.teardown(client);

    const loginIndex = calls.findIndex((c) => c.includes('POST /api/v1/auth/login'));
    const deactivateIndex = calls.findIndex((c) =>
      c.includes(`PATCH /api/v1/users/${STUB_USER_ID}/deactivate`),
    );

    expect(loginIndex, 'teardown should authenticate as admin').toBeGreaterThanOrEqual(0);
    expect(deactivateIndex, 'teardown should deactivate the created user').toBeGreaterThanOrEqual(
      0,
    );
    expect(loginIndex, 'admin login must precede the deactivate').toBeLessThan(deactivateIndex);
  });
});
