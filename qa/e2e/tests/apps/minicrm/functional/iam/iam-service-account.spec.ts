/**
 * F-SA — Service account role and API token management
 *
 * Verifies the full service account lifecycle:
 *   - Admin can invite a service_account user
 *   - Admin can issue an API token (returned plaintext once)
 *   - Bearer token authenticates CRM API calls
 *   - Bearer token is rejected after revocation
 *   - Admin-only endpoints block service account Bearer requests (403)
 *   - Revoked token is rejected immediately (401)
 *   - Service account does NOT appear in the /users/active list used for owner dropdowns
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - API-only; no browser UI navigation
 *   - Each test manages its own fixtures with try/finally teardown
 *   - restClient is always re-authenticated as admin after per-test operations
 *
 * MINCRM-536
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClient } from '@framework/clients/rest-client.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F-SA] E2E_ADMIN_PASSWORD is not set');

const API_BASE_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3002';

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
  role: string;
  status: string;
  has_api_token?: boolean;
}

interface InviteResponse {
  user: UserRow;
  inviteToken: string;
}

interface IssueTokenResponse {
  token: string;
  issued_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an activated service account user.
 * Activation uses POST /users/set-password with the invite token, which sets
 * status='active' and must_change_password=false — the clean activation path.
 * Caller is responsible for deactivating in teardown.
 */
async function createServiceAccount(adminClient: RestClient): Promise<UserRow> {
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await adminClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `SA ${uniqueSuffix}`,
    email: `sa-${uniqueSuffix}@example.com`,
    role: 'service_account',
  });
  // Activate with invite token (must_change_password stays false, status becomes 'active')
  await adminClient.post('/api/v1/users/set-password', {
    token: res.body.inviteToken,
    password: 'SaPassword1!',
  });
  const userRes = await adminClient.get<{ user: UserRow }>(`/api/v1/users/${res.body.user.id}`);
  return userRes.body.user;
}

/**
 * Issues an API token for a service account user.
 */
async function issueToken(adminClient: RestClient, userId: string): Promise<string> {
  const res = await adminClient.post<IssueTokenResponse>(`/api/v1/users/${userId}/api-token`);
  return res.body.token;
}

/**
 * Makes a raw fetch request with a Bearer token.
 * Used to authenticate as service account (no cookie session available).
 */
async function bearerGet(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function bearerPost(
  path: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/**
 * Deactivates a user; suppresses errors so teardown never masks test failures.
 */
async function deactivateUser(adminClient: RestClient, userId: string, tag: string): Promise<void> {
  await adminClient.patch(`/api/v1/users/${userId}/deactivate`).catch((err: unknown) => {
    console.error(`[${tag}] teardown: failed to deactivate ${userId}: ${String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Service Account Creation tests
// ---------------------------------------------------------------------------

test('@functional F-SA-C1: admin can invite a service_account user', async ({ restClient }) => {
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await restClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `SA ${uniqueSuffix}`,
    email: `sa-c1-${uniqueSuffix}@example.com`,
    role: 'service_account',
  });
  expect(res.status, 'invite should return 201').toBe(201);
  expect(res.body.user.role, 'user role should be service_account').toBe('service_account');
  expect(res.body.inviteToken, 'invite token should be present').toBeTruthy();

  await deactivateUser(restClient, res.body.user.id, 'F-SA-C1');
});

test('@functional F-SA-C2: service accounts do not appear in the active users list', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const res = await restClient.get<{ users: { id: string; name: string }[] }>(
      '/api/v1/users/active',
    );
    expect(res.status, 'GET /users/active should return 200').toBe(200);
    const ids = res.body.users.map((u) => u.id);
    expect(ids, 'service account should not appear in active users list').not.toContain(saUser.id);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-C2');
  }
});

// ---------------------------------------------------------------------------
// Token Issuance tests
// ---------------------------------------------------------------------------

test('@functional F-SA-T1: admin can issue an API token for a service account', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const res = await restClient.post<IssueTokenResponse>(`/api/v1/users/${saUser.id}/api-token`);
    expect(res.status, 'POST /api-token should return 201').toBe(201);
    expect(res.body.token, 'plaintext token should be present').toBeTruthy();
    expect(typeof res.body.token, 'token should be a string').toBe('string');
    expect(res.body.issued_at, 'issued_at should be present').toBeTruthy();
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-T1');
  }
});

test('@functional F-SA-T2: issuing a second token replaces the first', async ({ restClient }) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const first = await restClient.post<IssueTokenResponse>(`/api/v1/users/${saUser.id}/api-token`);
    const second = await restClient.post<IssueTokenResponse>(
      `/api/v1/users/${saUser.id}/api-token`,
    );

    expect(second.status, 'second issue should return 201').toBe(201);
    expect(second.body.token, 'second token should differ from first').not.toBe(first.body.token);

    // First token must now be rejected
    const authCheck = await bearerGet('/api/v1/contacts', first.body.token);
    expect(authCheck.status, 'first token should be rejected after rotation').toBe(401);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-T2');
  }
});

test('@functional F-SA-T3: user detail reflects has_api_token after issuance', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    await restClient.post(`/api/v1/users/${saUser.id}/api-token`);
    const userRes = await restClient.get<{ user: UserRow }>(`/api/v1/users/${saUser.id}`);
    expect(userRes.body.user.has_api_token, 'has_api_token should be true after issuance').toBe(
      true,
    );
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-T3');
  }
});

// ---------------------------------------------------------------------------
// Bearer Authentication tests
// ---------------------------------------------------------------------------

test('@functional F-SA-B1: service account can read contacts with Bearer token', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const token = await issueToken(restClient, saUser.id);
    const res = await bearerGet('/api/v1/contacts', token);
    expect(res.status, 'Bearer GET /contacts should return 200').toBe(200);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-B1');
  }
});

test('@functional F-SA-B2: service account can read accounts with Bearer token', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const token = await issueToken(restClient, saUser.id);
    const res = await bearerGet('/api/v1/accounts', token);
    expect(res.status, 'Bearer GET /accounts should return 200').toBe(200);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-B2');
  }
});

test('@functional F-SA-B3: service account can create a contact with Bearer token', async ({
  restClient,
  testData,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const token = await issueToken(restClient, saUser.id);
    const res = await bearerPost('/api/v1/contacts', token, {
      first_name: 'SACreated',
      last_name: `F-SA-B3-${Date.now()}`,
      email: `sa-b3-contact-${Date.now()}@example.com`,
    });
    expect(res.status, 'Bearer POST /contacts should return 201').toBe(201);

    // Register for teardown — contact is owned by the SA, which we deactivate below.
    // Deactivation doesn't cascade-delete contacts so we must clean up explicitly.
    const contactId = (res.body as { contact: { id: string } }).contact?.id;
    if (contactId) {
      testData.registerCustomTeardown(`delete-sa-b3-contact-${contactId}`, async () => {
        await restClient.delete(`/api/v1/contacts/${contactId}`).catch(() => null);
      });
    }
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-B3');
  }
});

test('@functional F-SA-B4: invalid Bearer token returns 401', async ({ restClient }) => {
  // No need for a real service account — just try an invalid token directly
  const res = await bearerGet('/api/v1/contacts', 'not-a-real-token');
  expect(res.status, 'invalid Bearer token should return 401').toBe(401);
  // Restore admin session explicitly (no per-test setup needed since we didn't use restClient)
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

test('@functional F-SA-B5: service account Bearer token is rejected after deactivation', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  const token = await issueToken(restClient, saUser.id);

  // Confirm token works before deactivation
  const before = await bearerGet('/api/v1/contacts', token);
  expect(before.status, 'token should be valid before deactivation').toBe(200);

  // Deactivate
  await restClient.patch(`/api/v1/users/${saUser.id}/deactivate`);

  // Token must now be rejected
  const after = await bearerGet('/api/v1/contacts', token);
  expect(after.status, 'token should be rejected after user deactivation').toBe(401);
});

test('@functional F-SA-B6: service account cannot call admin-only endpoints', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const token = await issueToken(restClient, saUser.id);
    // POST /api/v1/users/invite is admin-only (requireRole('admin'))
    const res = await bearerPost('/api/v1/users/invite', token, {
      name: 'SA Invite Attempt',
      email: `sa-invite-blocked-${Date.now()}@example.com`,
      role: 'rep',
    });
    expect(res.status, 'service account cannot access admin-only endpoints').toBe(403);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-B6');
  }
});

// ---------------------------------------------------------------------------
// Token Revocation tests
// ---------------------------------------------------------------------------

test('@functional F-SA-R1: admin can revoke a service account API token', async ({
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);
  try {
    await issueToken(restClient, saUser.id);

    const revokeRes = await restClient.delete<{ success: boolean }>(
      `/api/v1/users/${saUser.id}/api-token`,
    );
    expect(revokeRes.status, 'DELETE /api-token should return 200').toBe(200);
    expect(revokeRes.body.success, 'success should be true').toBe(true);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-R1');
  }
});

test('@functional F-SA-R2: revoked token is rejected immediately', async ({ restClient }) => {
  const saUser = await createServiceAccount(restClient);
  try {
    const token = await issueToken(restClient, saUser.id);

    // Confirm it works first
    const before = await bearerGet('/api/v1/contacts', token);
    expect(before.status, 'token should work before revocation').toBe(200);

    // Revoke
    await restClient.delete(`/api/v1/users/${saUser.id}/api-token`);

    // Must be rejected immediately (no caching)
    const after = await bearerGet('/api/v1/contacts', token);
    expect(after.status, 'token should be rejected after revocation').toBe(401);
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-R2');
  }
});

test('@functional F-SA-R3: has_api_token is false after revocation', async ({ restClient }) => {
  const saUser = await createServiceAccount(restClient);
  try {
    await issueToken(restClient, saUser.id);
    await restClient.delete(`/api/v1/users/${saUser.id}/api-token`);

    const userRes = await restClient.get<{ user: UserRow }>(`/api/v1/users/${saUser.id}`);
    expect(userRes.body.user.has_api_token, 'has_api_token should be false after revocation').toBe(
      false,
    );
  } finally {
    await deactivateUser(restClient, saUser.id, 'F-SA-R3');
  }
});

test('@functional F-SA-R4: only admin can issue a token — rep is forbidden', async ({
  playwright,
  restClient,
}) => {
  const saUser = await createServiceAccount(restClient);

  // Create an activated rep user
  const uniqueSuffix = `${Date.now()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const repInvite = await restClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `Rep ${uniqueSuffix}`,
    email: `rep-sa-r4-${uniqueSuffix}@example.com`,
    role: 'rep',
  });
  await restClient.post('/api/v1/users/set-password', {
    token: repInvite.body.inviteToken,
    password: 'RepPass1!',
  });

  const repContext = await playwright.request.newContext();
  const repClient = new RestClient(repContext);

  try {
    await repClient.post('/api/v1/auth/login', {
      email: repInvite.body.user.email,
      password: 'RepPass1!',
    });

    const res = await repClient.post(`/api/v1/users/${saUser.id}/api-token`, {});
    expect(res.status, 'rep should not be able to issue API tokens').toBe(403);
  } finally {
    await repContext.dispose().catch(() => null);
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await deactivateUser(restClient, saUser.id, 'F-SA-R4');
    await deactivateUser(restClient, repInvite.body.user.id, 'F-SA-R4-rep');
  }
});
