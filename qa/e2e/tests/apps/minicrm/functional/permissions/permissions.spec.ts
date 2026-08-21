/**
 * F7 — Roles & Permissions
 *
 * Functional regression tests for all role-based access control (RBAC) boundaries.
 * Tests authenticate as different roles and assert correct access at every layer:
 * UI routing, navigation visibility, and direct API calls.
 *
 * Test groups:
 *   Admin Access    — admin can reach all product areas and manage records owned by any rep
 *   Rep Permitted   — rep can create and manage their own records; can read other reps' records
 *   Rep Forbidden (UI)  — admin-only routes redirect rep to dashboard, no blank page or error
 *   Rep Forbidden (API) — all admin-only endpoints return 403 when called as rep (AC1)
 *   Error Handling  — forbidden API responses carry structured error body
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via TestDataManager registration
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: every admin-only API endpoint is exercised with a rep-authenticated restClient
 *   - AC2: each test covers exactly one role boundary (no chained role checks)
 *   - AC3: separate named user fixtures for admin and rep prevent session bleed
 *
 *
 *
 * Parallelism:
 *   File-scope parallel mode is enabled below. Safety audit passed:
 *   - Every test creates isolated users (admin + rep) with UUID-scoped names and
 *     emails; records are cleaned up by TestDataManager.
 *   - All API count assertions use status codes (200/403/404), not table totals.
 *   - No system_settings writes in any test.
 *   - storageState is cleared (empty object) so no shared auth cookie is mutated.
 */

// Enable intra-file parallelism: tests run concurrently across workers.
// Safety-audited: all data is UUID-scoped, no shared state.
test.describe.configure({ mode: 'parallel' });

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToUrlAndWait,
  waitForRedirectToDashboard,
  waitForRedirectToPath,
  isNavLinkHidden,
} from '@behaviors/minicrm/nav.behaviors.js';
import {
  createTestContact,
  createTestAccount,
  createTestActivity,
  createTestUser,
  loginAndVerify,
} from '@apps/minicrm/helpers.js';
import { RestClient, RestClientError } from '@framework/clients/rest-client.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';

// Permissions tests log in via the UI as dynamically-created rep users,
// not as admin. Browser contexts in this spec must start unauthenticated so the
// login() behavior can navigate to /login and authenticate as the correct role.
// API-only tests in this spec (F7-AA*, F7-FA*) are unaffected by storageState but
// the file-level override keeps behaviour consistent across the entire spec.
// Use an empty storageState to prevent the project-level admin session
// from loading. `undefined` does not override the project config — an explicit empty
// object is required to start each test with a fresh, unauthenticated browser context.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F7] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'rep';
  status: 'active' | 'invited' | 'inactive';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Password used when creating activated test users in this spec. */
const TEST_USER_PASSWORD = 'F7TestPass1!';

/**
 * Creates an activated test user authenticated as admin.
 *
 * Teardown is registered by `createTestUser` itself and is the only cleanup
 * path: the user is deactivated after the test even on failure, and call sites
 * need no `finally` block of their own.
 *
 * @param testData - TestDataManager instance for the current test.
 * @param restClient - Admin-authenticated RestClient.
 * @param role - Role to assign.
 * @returns Created user row and their password.
 */
async function createActivatedUser(
  testData: TestDataManager,
  restClient: RestClient,
  role: 'admin' | 'rep' = 'rep',
): Promise<{ user: UserRow; password: string }> {
  // crypto.randomUUID() is cryptographically random — collision-safe under high parallelism.
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const user = await createTestUser(testData, restClient, {
    name: `F7 User ${uniqueSuffix}`,
    email: `f7-user-${uniqueSuffix}@example.com`,
    role,
    password: TEST_USER_PASSWORD,
  });
  return { user: user as UserRow, password: TEST_USER_PASSWORD };
}

// ---------------------------------------------------------------------------
// Admin Access tests
// ---------------------------------------------------------------------------

test('@functional F7-AA1: admin can read contacts list', async ({ restClient }) => {
  const res = await restClient.get('/api/v1/contacts');
  expect(res.status, 'admin GET /api/contacts should return 200').toBe(200);
});

test('@functional F7-AA2: admin can read accounts list', async ({ restClient }) => {
  const res = await restClient.get('/api/v1/accounts');
  expect(res.status, 'admin GET /api/accounts should return 200').toBe(200);
});

test('@functional F7-AA3: admin can read deals list', async ({ restClient }) => {
  const res = await restClient.get('/api/v1/deals');
  expect(res.status, 'admin GET /api/deals should return 200').toBe(200);
});

test('@functional F7-AA4: admin can read user management list', async ({ restClient }) => {
  const res = await restClient.get('/api/v1/users');
  expect(res.status, 'admin GET /api/users should return 200').toBe(200);
});

test('@functional F7-AA5: admin can read a contact owned by a rep', async ({
  playwright,
  restClient,
  testData,
}) => {
  // Create a rep user and a contact owned by that rep.
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repRequestContext = await playwright.request.newContext();
  const repClient = new RestClient(repRequestContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);
    const contact = await createTestContact(testData, repClient, {
      first_name: 'F7AA5',
      last_name: `Rep-Owned-${Date.now()}`,
    });

    // Admin must be able to read the rep's contact.
    const res = await restClient.get<{ contact: { id: string } }>(`/api/v1/contacts/${contact.id}`);
    expect(res.status, 'admin should be able to read a contact owned by a rep').toBe(200);
    expect(res.body.contact.id, 'returned contact id should match').toBe(contact.id);
  } finally {
    await repRequestContext.dispose().catch(() => null);
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

test('@functional F7-AA6: admin can delete a contact owned by a rep', async ({
  playwright,
  restClient,
  testData,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repRequestContext = await playwright.request.newContext();
  const repClient = new RestClient(repRequestContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    // Contact is registered with testData for automatic teardown; if the admin delete
    // succeeds first, testData's DELETE will harmlessly return 404.
    const contact = await createTestContact(testData, repClient, {
      first_name: 'F7AA6',
      last_name: `Rep-Owned-${Date.now()}`,
    });

    // Admin should be able to delete the rep's contact.
    // Server returns 204 No Content on successful DELETE.
    const res = await restClient.delete(`/api/v1/contacts/${contact.id}`);
    expect(res.status, 'admin should be able to delete a contact owned by a rep').toBe(204);
  } finally {
    await repRequestContext.dispose().catch(() => null);
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Rep Permitted tests
// ---------------------------------------------------------------------------

test('@functional F7-RP1: rep can create and read their own contact', async ({
  playwright,
  restClient,
  testData,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    const contact = await createTestContact(testData, repClient, {
      first_name: 'F7RP1',
      last_name: `Own-${Date.now()}`,
    });

    const res = await repClient.get<{ contact: { id: string } }>(`/api/v1/contacts/${contact.id}`);
    expect(res.status, 'rep should be able to read their own contact').toBe(200);
    expect(res.body.contact.id).toBe(contact.id);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-RP2: rep can read a contact owned by another rep', async ({
  playwright,
  restClient,
  testData,
}) => {
  const { user: rep1 } = await createActivatedUser(testData, restClient);
  const { user: rep2 } = await createActivatedUser(testData, restClient);

  const rep1Context = await playwright.request.newContext();
  const rep1Client = new RestClient(rep1Context);
  const rep2Context = await playwright.request.newContext();
  const rep2Client = new RestClient(rep2Context);

  try {
    // rep1 creates a contact.
    await loginAndVerify(rep1Client, rep1.email, TEST_USER_PASSWORD);
    const contact = await createTestContact(testData, rep1Client, {
      first_name: 'F7RP2',
      last_name: `Rep1-Owned-${Date.now()}`,
    });

    // rep2 should be able to read rep1's contact (product spec permits read).
    await loginAndVerify(rep2Client, rep2.email, TEST_USER_PASSWORD);
    const res = await rep2Client.get<{ contact: { id: string } }>(`/api/v1/contacts/${contact.id}`);
    expect(res.status, 'rep2 should be able to read a contact owned by rep1').toBe(200);
    expect(res.body.contact.id).toBe(contact.id);
  } finally {
    await rep1Context.dispose().catch(() => null);
    await rep2Context.dispose().catch(() => null);
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

test('@functional F7-RP3: rep can create and complete their own task', async ({
  playwright,
  restClient,
  testData,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    // Need an account to link the activity to.
    const account = await createTestAccount(testData, repClient, {
      name: `F7RP3 Account ${Date.now()}`,
    });
    const activity = await createTestActivity(testData, repClient, {
      type: 'Task',
      subject: `F7RP3 Task ${Date.now()}`,
      account_id: account.id,
    });

    // Rep completes their own task.
    const res = await repClient.patch<{ activity: { id: string; status: string } }>(
      `/api/v1/activities/${activity.id}`,
      { status: 'complete', version: activity.version },
    );
    expect(res.status, 'rep should be able to complete their own task').toBe(200);
    expect(res.body.activity.status, 'task status should be complete').toBe('complete');
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Rep Forbidden — UI tests
// ---------------------------------------------------------------------------

test('@functional F7-FU1: rep navigating directly to /users is redirected to dashboard', async ({
  testData,
  page,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);

  try {
    // Log in as rep via UI.
    await login({ email: rep.email, password: TEST_USER_PASSWORD }, { page });

    await navigateToUrlAndWait('/users', { page });

    const { pathname: finalPath } = await waitForRedirectToDashboard({ page }, 10_000);
    expect(finalPath, 'rep navigating to /users should be redirected to /').toBe('/');
  } finally {
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

test('@functional F7-FU2: rep navigating directly to /admin/settings is redirected to dashboard', async ({
  testData,
  page,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);

  try {
    await login({ email: rep.email, password: TEST_USER_PASSWORD }, { page });

    await navigateToUrlAndWait('/admin/settings', { page });

    const { pathname: finalPath } = await waitForRedirectToDashboard({ page }, 10_000);
    expect(finalPath, 'rep navigating to /admin/settings should be redirected to /').toBe('/');
  } finally {
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

test('@functional F7-FU3: rep navigating directly to /admin/automation is redirected to dashboard', async ({
  testData,
  page,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);

  try {
    await login({ email: rep.email, password: TEST_USER_PASSWORD }, { page });

    await navigateToUrlAndWait('/admin/automation', { page });

    const { pathname: finalPath } = await waitForRedirectToDashboard({ page }, 10_000);
    expect(finalPath, 'rep navigating to /admin/automation should be redirected to /').toBe('/');
  } finally {
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

test('@functional F7-FU4: rep navigating directly to /reports can access the reports page', async ({
  testData,
  page,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);

  try {
    await login({ email: rep.email, password: TEST_USER_PASSWORD }, { page });

    // /reports/win-loss now redirects to /reports?view=win-loss. The redirect
    // is client-side (<Navigate>) behind a lazy-loaded chunk + feature-flag fetch, so
    // networkidle can settle before it commits — wait for the URL itself, not just network idle.
    await navigateToUrlAndWait('/reports/win-loss', { page });

    const { pathname: finalPath } = await waitForRedirectToPath('/reports', { page }, 10_000);
    expect(finalPath, 'rep navigating to /reports/win-loss should redirect to /reports').toBe(
      '/reports',
    );
  } finally {
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

test('@functional F7-FU5: rep does not see admin-only nav links', async ({
  testData,
  page,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);

  try {
    await login({ email: rep.email, password: TEST_USER_PASSWORD }, { page });

    // Admin-only destinations should not appear in any nav layout.
    // The three nav layouts use different testId prefixes:
    //   NavLeft:      nav-left-{dest}
    //   NavTop:       nav-top-{dest}
    //   NavHamburger: nav-hamburger-{dest}
    // DESTINATION_NAME maps route paths to dest slugs (e.g. '/users' → 'users').
    const adminDestinations = ['users', 'automation', 'settings'];
    const navPrefixes = ['nav-left', 'nav-top', 'nav-hamburger'];

    for (const dest of adminDestinations) {
      for (const prefix of navPrefixes) {
        const notVisible = await isNavLinkHidden(`${prefix}-${dest}`, { page }, 300);
        expect(notVisible, `nav link "${prefix}-${dest}" should not be visible to a rep`).toBe(
          true,
        );
      }
    }
  } finally {
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Rep Forbidden — API tests (AC1)
// ---------------------------------------------------------------------------

test('@functional F7-FA1: rep calling GET /api/v1/users receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.get('/api/v1/users');
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep GET /api/users should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA2: rep calling POST /api/v1/users/invite receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      // MINCRM-686-ok: expected to fail with 403 — no user row is created.
      await repClient.post('/api/v1/users/invite', {
        name: 'Forbidden Invite',
        email: `f7-forbidden-${Date.now()}@example.com`,
        role: 'rep',
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep POST /api/users/invite should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA3: rep calling PATCH /api/v1/users/:id/role receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const { user: target } = await createActivatedUser(testData, restClient);

  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.patch(`/api/v1/users/${target.id}/role`, { role: 'admin' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep PATCH /api/users/:id/role should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA4: rep calling PATCH /api/v1/users/:id/deactivate receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const { user: target } = await createActivatedUser(testData, restClient);

  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.patch(`/api/v1/users/${target.id}/deactivate`);
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep PATCH /api/users/:id/deactivate should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA5: rep calling PATCH /api/v1/users/:id/reactivate receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  // Create a second rep and deactivate them so there is a valid reactivation target.
  const { user: target } = await createActivatedUser(testData, restClient);
  await restClient.patch(`/api/v1/users/${target.id}/deactivate`);

  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.patch(`/api/v1/users/${target.id}/reactivate`);
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep PATCH /api/users/:id/reactivate should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA6: rep calling POST /api/v1/users/:id/admin-set-password receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const { user: target } = await createActivatedUser(testData, restClient);

  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.post(`/api/v1/users/${target.id}/admin-set-password`, {
        password: 'SomeNewPass1!',
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep POST /api/users/:id/admin-set-password should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA7: rep calling GET /api/v1/automation/rules receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.get('/api/v1/automation/rules');
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep GET /api/v1/automation/rules should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA8: rep calling POST /api/v1/automation/rules receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.post('/api/v1/automation/rules', {
        name: 'Forbidden Rule',
        trigger: 'deal_created',
        action: 'log',
        enabled: true,
      });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep POST /api/v1/automation/rules should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA9: rep calling PATCH /api/v1/settings/default-language receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.patch('/api/v1/settings/default-language', { language: 'fr' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep PATCH /api/settings/default-language should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

test('@functional F7-FA10: rep calling PATCH /api/v1/settings/nav-layout receives 403 (AC1)', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await repClient.patch('/api/v1/settings/nav-layout', { layout: 'left' });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(errorStatus, 'rep PATCH /api/settings/nav-layout should return 403').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Rep Forbidden — owner-based PATCH/DELETE
// ---------------------------------------------------------------------------

test('@functional F7-FA11: rep cannot delete a contact owned by another rep', async ({
  playwright,
  restClient,
  testData,
}) => {
  const { user: rep1 } = await createActivatedUser(testData, restClient);
  const { user: rep2 } = await createActivatedUser(testData, restClient);

  const rep1Context = await playwright.request.newContext();
  const rep1Client = new RestClient(rep1Context);
  const rep2Context = await playwright.request.newContext();
  const rep2Client = new RestClient(rep2Context);

  try {
    // rep1 creates a contact.
    await loginAndVerify(rep1Client, rep1.email, TEST_USER_PASSWORD);
    const contact = await createTestContact(testData, rep1Client, {
      first_name: 'F7FA11',
      last_name: `Rep1-Owned-${Date.now()}`,
    });

    // rep2 attempts to delete rep1's contact.
    await loginAndVerify(rep2Client, rep2.email, TEST_USER_PASSWORD);

    let errorStatus: number | null = null;
    try {
      await rep2Client.delete(`/api/v1/contacts/${contact.id}`);
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
      } else {
        throw err;
      }
    }
    expect(
      errorStatus,
      'rep2 deleting rep1 contact should have been rejected with a non-null status',
    ).not.toBeNull();
    expect([403, 404], 'rep2 deleting rep1 contact should be forbidden (403 or 404)').toContain(
      errorStatus,
    );
  } finally {
    await rep1Context.dispose().catch(() => null);
    await rep2Context.dispose().catch(() => null);
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
  }
});

// ---------------------------------------------------------------------------
// Error Handling tests
// ---------------------------------------------------------------------------

test('@functional F7-EH1: forbidden API response includes structured error body', async ({
  testData,
  playwright,
  restClient,
}) => {
  const { user: rep } = await createActivatedUser(testData, restClient);
  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await loginAndVerify(repClient, rep.email, TEST_USER_PASSWORD);

    let errorBody: unknown = null;
    let errorStatus: number | null = null;
    try {
      await repClient.get('/api/v1/users');
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        errorStatus = err.status;
        errorBody = err.body;
      } else {
        throw err;
      }
    }

    expect(errorStatus, 'forbidden request should return 403').toBe(403);
    expect(errorBody, 'error body should be defined').toBeDefined();

    const body = errorBody as { error?: { code?: string; message?: string } };
    expect(body.error, 'error body should have an "error" key').toBeDefined();
    expect(typeof body.error?.code, 'error.code should be a string').toBe('string');
    expect(body.error?.code?.length, 'error.code should be non-empty').toBeGreaterThan(0);
    expect(typeof body.error?.message, 'error.message should be a string').toBe('string');
    expect(body.error?.message?.length, 'error.message should be non-empty').toBeGreaterThan(0);
  } finally {
    await repContext.dispose().catch(() => null);
  }
});
