/**
 * BVT-05 — User Management
 *
 * Smoke-tests the user management flow:
 *   1. Invite user via API (captures invite token), set password immediately
 *      so the user can log in without a forced password-change redirect
 *   2. Verify invited user appears in the users list via UI
 *   3. Also exercise the UI invite form end-to-end (inviteUserViaUI behavior)
 *   4. Log in as the API-invited user → successful authentication
 *   5. Teardown: deactivate both test users via PATCH (users cannot be hard-deleted)
 *
 * Why API invite + set-password rather than UI invite for the login step:
 *   admin-set-password sets must_change_password=true, forcing a redirect on
 *   first login. POST /api/users/set-password with the invite token sets
 *   must_change_password=false, allowing a clean login assertion. The UI invite
 *   form is still exercised via inviteUserViaUI — both code paths are covered.
 *
 * Why users are not registered with TestDataManager:
 *   TestDataManager teardown uses DELETE; user cleanup requires PATCH
 *   /api/users/:id/deactivate (hard delete is not supported). User IDs are
 *   tracked locally and deactivated in a finally block.
 *
 * Tagged @bvt @smoke @functional — runs in the merged functional suite.
 * Can still be targeted in isolation: npx playwright test --grep @bvt
 *
 * MINCRM-110, MINCRM-193
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, logout } from '@behaviors/minicrm/auth.behaviors.js';
import { inviteUserViaUI, userIsVisibleInList } from '@behaviors/minicrm/users.behaviors.js';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[BVT-05] E2E_ADMIN_PASSWORD is not set');

const INVITED_PASSWORD = 'BvtPassword1!';

interface UserRow {
  id: string;
  email: string;
  status: string;
}

interface UserListResponse {
  data: UserRow[];
  total: number;
}

interface InviteResponse {
  user: UserRow;
  inviteToken: string;
}

test('@bvt @smoke @functional BVT-05: user management — invite, verify in list, login as invited user, teardown', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;

  // Track user IDs created this run for deactivation in the finally block.
  // Users cannot be hard-deleted; deactivation is the surgical teardown.
  const createdUserIds: string[] = [];

  try {
    // ── Setup: authenticate REST client as admin ────────────────────────────
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const before = await restClient.get<UserListResponse>('/api/users');
    const countBefore = before.body.total;

    // Invite user via API to obtain the invite token, then set password so the
    // user can log in without a forced password-change redirect.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inviteResponse = await restClient.post<InviteResponse>('/api/users/invite', {
      name: `BVT5 User ${uniqueSuffix}`,
      email: `bvt5-${uniqueSuffix}@example.com`,
      role: 'rep',
    });
    const { user: invitedUser, inviteToken } = inviteResponse.body;
    createdUserIds.push(invitedUser.id);

    await restClient.post('/api/users/set-password', {
      token: inviteToken,
      password: INVITED_PASSWORD,
    });

    // ── Login as admin in the browser to drive UI actions ────────────────────
    // restClient.post('/api/auth/login') only authenticates the Playwright
    // APIRequestContext; it does NOT set the browser page session cookie.
    // The UI login behavior navigates the browser to /login and submits the
    // form, which sets the httpOnly cookie for the browser's page context.
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

    // ── 1. Verify API-invited user appears in the users list UI ──────────────
    const visibleResult = await userIsVisibleInList(invitedUser.id, { page, healPage, testName });
    expect(visibleResult.visible, 'invited user should appear in the users list').toBe(true);

    // ── 2. Exercise the UI invite form (inviteUserViaUI behavior) ─────────────
    const uiEmail = `bvt5-ui-${uniqueSuffix}@example.com`;
    const uiInviteResult = await inviteUserViaUI(`BVT5 UI User ${uniqueSuffix}`, uiEmail, 'rep', {
      page,
      healPage,
      testName,
    });
    expect(uiInviteResult.submitted, 'UI invite form should submit without error').toBe(true);

    // Find the UI-invited user in the API list (no search filter — scan by email).
    const listResponse = await restClient.get<UserListResponse>('/api/users?limit=100');
    const uiUser = listResponse.body.data.find((u) => u.email === uiEmail);
    expect(uiUser, `UI-invited user ${uiEmail} should appear in API list`).toBeDefined();
    createdUserIds.push(uiUser!.id);

    // ── 3. Login as the API-invited user ─────────────────────────────────────
    const invitedLoginResult = await login(
      { email: invitedUser.email, password: INVITED_PASSWORD },
      { page, healPage, testName },
    );
    expect(invitedLoginResult.success, 'invited user should log in successfully').toBe(true);
    expect(invitedLoginResult.errorMessage).toBeNull();

    // ── Count assertion (AC6) ─────────────────────────────────────────────────
    // Re-authenticate restClient as admin — the browser cookie was overwritten by
    // the invited-user browser login, and the restClient cookie may have also changed.
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    // Logout the browser session (invited user) before count assertion.
    await logout({ page, healPage, testName });

    // Deactivated users stay in the DB — total grows by the number created this run.
    const after = await restClient.get<UserListResponse>('/api/users');
    expect(after.body.total, 'user count should reflect users added this run').toBe(
      countBefore + 2,
    );
  } finally {
    // Deactivate all test users even if the test failed mid-way.
    // Re-authenticate as admin in case the restClient cookie changed.
    await restClient.post('/api/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    for (const userId of createdUserIds) {
      await restClient.patch(`/api/users/${userId}/deactivate`).catch((err: unknown) => {
        console.error(`[BVT-05] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});
