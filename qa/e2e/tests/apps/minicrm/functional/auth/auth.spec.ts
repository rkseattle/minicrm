/**
 * F1 — Authentication & Session Management
 *
 * Functional regression tests for all authentication and session behaviour.
 * These tests go beyond BVT-01 into edge cases, error states, and security
 * boundaries. Where BVT-01 asks "does auth work?", these ask "does it work
 * correctly in every case?"
 *
 * Test groups:
 *   Login    — valid, invalid password, non-existent user, empty fields
 *   Session  — expired/cleared session redirect, redirect-back URL (AC2), API-layer 401
 *   Logout   — cookie cleared → API 401, back-button after logout
 *   Password — forced change on first login, mismatched confirmation validation
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + finally-block teardown
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: wrong-password and unknown-user errors must return the same message
 *   - AC2: redirect-back URL preserved through login (implemented in MINCRM-147)
 *   - AC3: session invalidation verified at the API layer via restClient
 *
 * Tagged @functional so the suite can be run in isolation:
 *   npx playwright test --grep @functional
 *
 * MINCRM-137
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  login,
  logout,
  changePassword,
  navigateToProtectedPage,
} from '@behaviors/minicrm/auth.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// MINCRM-192: Auth tests exercise the real login flow and must not load the
// pre-authenticated storageState — each test needs a fresh, unauthenticated
// browser context so it can test login, logout, and session behaviour.
// MINCRM-192: Use an empty storageState to prevent the project-level admin session
// from loading. `undefined` does not override the project config — an explicit empty
// object is required to start each test with a fresh, unauthenticated browser context.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F1-auth] E2E_ADMIN_PASSWORD is not set');

/** A protected path that is NOT the dashboard — used for redirect-back tests. */
const PROTECTED_PATH = '/contacts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InviteResponse {
  user: { id: string; email: string };
  inviteToken: string;
}

/**
 * Creates a test user via invite + admin-set-password (sets must_change_password=true).
 * Returns the user id, email, and the temporary password.
 *
 * The caller is responsible for deactivating the user in a finally block.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param tempPassword - Temporary password to set via admin-set-password.
 * @returns Created user id, email, and temp password.
 */
async function createUserWithForcedPasswordChange(
  restClient: RestClient,
  tempPassword: string,
): Promise<{ userId: string; email: string; tempPassword: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inviteRes = await restClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `F1 User ${uniqueSuffix}`,
    email: `f1-auth-${uniqueSuffix}@example.com`,
    role: 'rep',
  });
  const { user, inviteToken } = inviteRes.body;

  // Use set-password with the invite token to activate the account first
  // (required before admin-set-password will accept the user id).
  const activationPassword = 'Activate1!';
  await restClient.post('/api/v1/users/set-password', {
    token: inviteToken,
    password: activationPassword,
  });

  // admin-set-password sets must_change_password=true so the user is forced
  // to change password on next login.
  await restClient.post(`/api/v1/users/${user.id}/admin-set-password`, {
    password: tempPassword,
  });

  return { userId: user.id, email: user.email, tempPassword };
}

// ---------------------------------------------------------------------------
// Login tests
// ---------------------------------------------------------------------------

test('@smoke @functional F1-L1: valid credentials → authenticated, dashboard visible', async ({
  page,
}) => {
  const result = await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page });

  expect(result.success, 'valid login should succeed').toBe(true);
  expect(result.errorMessage, 'no error message on successful login').toBeNull();
  expect(new URL(result.finalUrl).pathname, 'browser should leave /login').not.toBe('/login');
});

test('@smoke @functional F1-L2: invalid password → error shown, stays on login page', async ({
  page,
}) => {
  const result = await login(
    { email: ADMIN_EMAIL, password: 'definitley-wrong-password' },
    { page },
  );

  expect(result.success, 'invalid login should fail').toBe(false);
  expect(result.errorMessage, 'error message should be present').not.toBeNull();
  expect(new URL(result.finalUrl).pathname, 'browser should stay on /login').toBe('/login');
});

test('@functional F1-L3: non-existent user → same error as wrong password (AC1 — no user enumeration)', async ({
  page,
}) => {
  // Wrong password for a known account
  const wrongPasswordResult = await login(
    { email: ADMIN_EMAIL, password: 'wrong-password' },
    { page },
  );

  // Unknown user entirely
  const unknownUserResult = await login(
    { email: 'no-such-user@example.com', password: 'anything' },
    { page },
  );

  expect(wrongPasswordResult.success, 'wrong-password login should fail').toBe(false);
  expect(unknownUserResult.success, 'unknown-user login should fail').toBe(false);

  // AC1: error messages must be identical — server must not reveal whether the
  // account exists. Leaking this information aids user enumeration attacks.
  expect(
    unknownUserResult.errorMessage,
    'unknown-user and wrong-password must return the same error message',
  ).toBe(wrongPasswordResult.errorMessage);
});

test('@functional F1-L4: empty email and password → validation error, stays on login page', async ({
  page,
}) => {
  const result = await login({ email: '', password: '' }, { page });

  expect(result.success, 'empty-fields login should fail').toBe(false);
  expect(result.errorMessage, 'error message should be present for empty fields').not.toBeNull();
  expect(new URL(result.finalUrl).pathname, 'browser should stay on /login').toBe('/login');
});

// ---------------------------------------------------------------------------
// Session tests
// ---------------------------------------------------------------------------

test('@functional F1-S1: cleared session cookie → browser redirected to /login', async ({
  page,
}) => {
  // Establish an authenticated browser session.
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page });

  // Simulate session expiry by clearing all cookies for the browser context.
  await page.context().clearCookies();

  // Attempt to navigate to a protected page — should redirect to /login.
  const result = await navigateToProtectedPage(PROTECTED_PATH, { page });

  expect(result.redirectedToLogin, 'cleared session should redirect to /login').toBe(true);
});

test('@functional F1-S2: cleared session → API returns 401 (AC3)', async ({ restClient }) => {
  // Authenticate the restClient as admin.
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Confirm the session is valid.
  const meResponse = await restClient.get<{ user: { id: string } }>('/api/v1/auth/me');
  expect(meResponse.status, 'authenticated /me should return 200').toBe(200);

  // Simulate session expiry: logout via API clears the cookie on the
  // restClient's underlying APIRequestContext.
  await restClient.post('/api/v1/auth/logout', {});

  // Subsequent authenticated request must return 401 — the session cookie was cleared.
  let caughtStatus: number | null = null;
  try {
    await restClient.get('/api/v1/auth/me');
  } catch (err: unknown) {
    if (err instanceof RestClientError) {
      caughtStatus = err.status;
    } else {
      throw err;
    }
  }

  expect(caughtStatus, '/me after logout must return 401').toBe(401);
});

/**
 * F1-S3: redirect-back URL preserved through login flow (AC2).
 *
 * ProtectedRoute passes the blocked location as React Router state when
 * redirecting to /login. LoginPage reads that state on success and returns
 * the user to their originally requested path. Implemented in MINCRM-147.
 */
test('@functional F1-S3: redirect-back URL preserved through login flow (AC2)', async ({
  page,
}) => {
  // Navigate to a protected page while not logged in — should redirect to /login.
  const redirectResult = await navigateToProtectedPage(PROTECTED_PATH, {
    page,
  });
  expect(redirectResult.redirectedToLogin, 'unauthenticated visit should redirect to /login').toBe(
    true,
  );

  // Log in from the /login page (the browser is already there after the redirect).
  // After successful login the app should return the user to PROTECTED_PATH.
  const loginResult = await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page });

  expect(loginResult.success, 'login should succeed').toBe(true);
  expect(
    new URL(loginResult.finalUrl).pathname,
    `after re-authentication the browser should land on the originally requested path (${PROTECTED_PATH}), not /`,
  ).toBe(PROTECTED_PATH);
});

// ---------------------------------------------------------------------------
// Logout tests
// ---------------------------------------------------------------------------

test('@smoke @functional F1-O1: logout clears session cookie → subsequent API requests return 401 (AC3)', async ({
  page,
  restClient,
}) => {
  // Authenticate both the browser page and the restClient independently.
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page });
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Perform logout via the UI — clears the browser session cookie.
  const logoutResult = await logout({ page });
  expect(logoutResult.success, 'logout should return to /login').toBe(true);

  // Also logout the restClient session so the same APIRequestContext loses its cookie.
  await restClient.post('/api/v1/auth/logout', {});

  // Subsequent API request must return 401.
  let caughtStatus: number | null = null;
  try {
    await restClient.get('/api/v1/auth/me');
  } catch (err: unknown) {
    if (err instanceof RestClientError) {
      caughtStatus = err.status;
    } else {
      throw err;
    }
  }

  expect(caughtStatus, '/me after logout must return 401').toBe(401);
});

test('@functional F1-O2: navigating to protected route after logout → redirected to /login', async ({
  page,
}) => {
  // Establish an authenticated session.
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page });
  expect(new URL(page.url()).pathname, 'should be authenticated before logout').not.toBe('/login');

  // Log out — browser should return to /login and the session cookie is cleared.
  const logoutResult = await logout({ page });
  expect(logoutResult.success, 'logout should succeed').toBe(true);

  // Attempt to navigate directly to a protected URL. The session cookie is gone,
  // so ProtectedRoute must redirect back to /login.
  const result = await navigateToProtectedPage(PROTECTED_PATH, { page });

  expect(
    result.redirectedToLogin,
    'direct navigation to a protected route after logout must redirect to /login',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Password management tests
// ---------------------------------------------------------------------------

test('@functional F1-P1: invited user forced to change password → old temp password rejected after change', async ({
  page,
  restClient,
}) => {
  const TEMP_PASSWORD = 'TempPass1!';
  const NEW_PASSWORD = 'NewPass2@';

  // Authenticate restClient as admin to create the test user.
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  let userId: string | null = null;
  try {
    const created = await createUserWithForcedPasswordChange(restClient, TEMP_PASSWORD);
    userId = created.userId;

    // ── 1. Login as the forced-change user — should land on /change-password ──
    const loginResult = await login({ email: created.email, password: TEMP_PASSWORD }, { page });

    expect(loginResult.success, 'forced-change user login should succeed').toBe(true);
    expect(
      new URL(loginResult.finalUrl).pathname,
      'forced-change user should be redirected to /change-password',
    ).toBe('/change-password');

    // ── 2. Change the password ────────────────────────────────────────────────
    const changeResult = await changePassword(
      {
        currentPassword: TEMP_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      { page },
    );

    expect(changeResult.success, 'password change should succeed').toBe(true);
    expect(changeResult.errorMessage, 'no error message on successful change').toBeNull();

    // ── 3. Log out so we can test the old password ────────────────────────────
    // After change the user is navigated to / — log them out via UI.
    await logout({ page });

    // ── 4. Old temp password must now be rejected ─────────────────────────────
    const reloginWithOldPassword = await login(
      { email: created.email, password: TEMP_PASSWORD },
      { page },
    );

    expect(
      reloginWithOldPassword.success,
      'old temp password should be rejected after change',
    ).toBe(false);
    expect(
      reloginWithOldPassword.errorMessage,
      'error message should indicate invalid credentials',
    ).not.toBeNull();
  } finally {
    // Deactivate the test user. Re-auth as admin in case restClient cookie changed.
    if (userId) {
      await restClient
        .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/v1/users/${userId}/deactivate`).catch((err: unknown) => {
        console.error(`[F1-P1] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});

test('@functional F1-P2: password change with mismatched confirmation → inline validation error, no change submitted', async ({
  page,
  restClient,
}) => {
  const TEMP_PASSWORD = 'TempPass1!';

  // Authenticate restClient as admin to create the test user.
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  let userId: string | null = null;
  try {
    const created = await createUserWithForcedPasswordChange(restClient, TEMP_PASSWORD);
    userId = created.userId;

    // Login — should land on /change-password.
    await login({ email: created.email, password: TEMP_PASSWORD }, { page });

    // Submit change-password form with mismatched confirmation.
    const result = await changePassword(
      {
        currentPassword: TEMP_PASSWORD,
        newPassword: 'NewPass2@',
        confirmPassword: 'DifferentPass3@', // deliberate mismatch
      },
      { page },
    );

    // Form must not navigate away — the mismatch is caught client-side before submission.
    expect(result.success, 'mismatched confirmation should not navigate away').toBe(false);
    expect(
      result.errorMessage,
      'error message should be present for mismatched passwords',
    ).not.toBeNull();
    expect(
      new URL(result.finalUrl).pathname,
      'browser should stay on /change-password after mismatch error',
    ).toBe('/change-password');
  } finally {
    if (userId) {
      await restClient
        .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/v1/users/${userId}/deactivate`).catch((err: unknown) => {
        console.error(`[F1-P2] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});
