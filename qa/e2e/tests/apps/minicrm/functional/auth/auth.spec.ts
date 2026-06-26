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
 *   Lockout  — 10 consecutive failures → 429 ACCOUNT_TEMPORARILY_LOCKED (MINCRM-391)
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
 *
 * Parallelism (MINCRM-550):
 *   Evaluated for parallel mode but rejected. All tests create UUID-scoped users
 *   and make no system_settings writes, so intra-file isolation holds. However,
 *   tests hammer the rate-limited POST /api/v1/auth/login endpoint: the lockout
 *   test (F1-LO1) alone fires 11 consecutive requests. When this file runs in
 *   parallel (intra-file) at the same time as other shards, the combined
 *   concurrent login load causes ECONNRESET on the shared CI test server,
 *   breaking tests in other files (observed: F1-PR6 in password-reset.spec.ts
 *   and F8-TN1 in navigation.spec.ts). The /api/v1/auth/login endpoint is
 *   effectively a shared resource under rate limiting; that makes it unsafe to
 *   parallelize. See qa/e2e/PARALLELISM-NOTES.md.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  login,
  loginFromCurrentPage,
  loginAsAdmin,
  logoutViaApi,
  getCurrentUser,
  logout,
  changePassword,
  navigateToProtectedPage,
  sessionExpiredBannerVisible,
  navigateToLoginWithSessionExpired,
} from '@behaviors/minicrm/auth.behaviors.js';
import {
  inviteUserViaApi,
  setUserPassword,
  adminSetUserPassword,
  deactivateUser,
  suppressUserOnboarding,
} from '@behaviors/minicrm/users.behaviors.js';
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
  restClient: Parameters<typeof inviteUserViaApi>[0],
  tempPassword: string,
): Promise<{ userId: string; email: string; tempPassword: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { user, inviteToken } = await inviteUserViaApi(restClient, {
    name: `F1 User ${uniqueSuffix}`,
    email: `f1-auth-${uniqueSuffix}@example.com`,
    role: 'rep',
  });

  // Use set-password with the invite token to activate the account first
  // (required before admin-set-password will accept the user id).
  const activationPassword = 'Activ@te1234!';
  await setUserPassword(restClient, inviteToken, activationPassword);

  // Suppress the onboarding widget so it does not intercept pointer events
  // when tests navigate the UI as this user. (MINCRM-410)
  await suppressUserOnboarding(restClient, user.email, activationPassword);

  // admin-set-password sets must_change_password=true so the user is forced
  // to change password on next login.
  await adminSetUserPassword(restClient, user.id, tempPassword);

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
  await loginAsAdmin(restClient);

  // Confirm the session is valid.
  await getCurrentUser(restClient);

  // Simulate session expiry: logout via API clears the cookie on the
  // restClient's underlying APIRequestContext.
  await logoutViaApi(restClient);

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
 * F1-S4: session-expired banner visible when 401 interceptor redirects to /login (MINCRM-365).
 *
 * When a mid-session API call returns 401, the Axios interceptor navigates to
 * /login?reason=session_expired. The login page must display a contextual notice
 * so the user understands why they were signed out.
 */
test('@functional F1-S4: session-expired banner visible on /login?reason=session_expired (MINCRM-365)', async ({
  page,
}) => {
  await navigateToLoginWithSessionExpired('/contacts', { page });

  const bannerVisible = await sessionExpiredBannerVisible({ page });
  expect(bannerVisible, 'session-expired banner must be visible').toBe(true);
});

/**
 * F1-S5: after session-expired redirect, logging in returns the user to the
 * originally requested path preserved in the ?next= query param. (MINCRM-365)
 *
 * Uses loginFromCurrentPage instead of login so the ?next= query param is NOT
 * stripped by a re-navigation to bare /login before the form is submitted.
 */
test('@functional F1-S5: login after session expiry returns user to ?next= path (MINCRM-365)', async ({
  page,
}) => {
  // Navigate to login with session_expired reason and next=/contacts.
  // The query params must remain in the URL when the form is submitted.
  await navigateToLoginWithSessionExpired(PROTECTED_PATH, { page });

  // Submit credentials without re-navigating (loginFromCurrentPage preserves the URL). (MINCRM-365)
  const loginResult = await loginFromCurrentPage(
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    { page },
  );

  expect(loginResult.success, 'login after session expiry should succeed').toBe(true);
  expect(
    new URL(loginResult.finalUrl).pathname,
    `after re-authentication user should land on ${PROTECTED_PATH}`,
  ).toBe(PROTECTED_PATH);
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
  await loginAsAdmin(restClient);

  // Perform logout via the UI — clears the browser session cookie.
  const logoutResult = await logout({ page });
  expect(logoutResult.success, 'logout should return to /login').toBe(true);

  // Also logout the restClient session so the same APIRequestContext loses its cookie.
  await logoutViaApi(restClient);

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
  const TEMP_PASSWORD = 'TempP@ss1234!';
  const NEW_PASSWORD = 'NewP@ssw0rd!2';

  // Authenticate restClient as admin to create the test user.
  await loginAsAdmin(restClient);

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
      await loginAsAdmin(restClient).catch(() => null);
      await deactivateUser(restClient, userId).catch((err: unknown) => {
        console.error(`[F1-P1] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});

test('@functional F1-P2: password change with mismatched confirmation → inline validation error, no change submitted', async ({
  page,
  restClient,
}) => {
  const TEMP_PASSWORD = 'TempP@ss1234!';

  // Authenticate restClient as admin to create the test user.
  await loginAsAdmin(restClient);

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
        newPassword: 'NewP@ssw0rd!2',
        confirmPassword: 'DifferentP@ss3!', // deliberate mismatch
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
      await loginAsAdmin(restClient).catch(() => null);
      await deactivateUser(restClient, userId).catch((err: unknown) => {
        console.error(`[F1-P2] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Lockout tests (MINCRM-391)
// ---------------------------------------------------------------------------

/**
 * Attempts to login with the given credentials, returning the HTTP status.
 * Catches RestClientError so callers can assert on expected 4xx/5xx responses.
 */
async function attemptLogin(
  restClient: Parameters<typeof loginAsAdmin>[0],
  email: string,
  password: string,
): Promise<number> {
  try {
    const res = await restClient.post<unknown>('/api/v1/auth/login', { email, password });
    return res.status;
  } catch (err: unknown) {
    if (err instanceof RestClientError) return err.status;
    throw err;
  }
}

test('@functional F1-LO1: 10 consecutive failed logins → 11th attempt returns 429 ACCOUNT_TEMPORARILY_LOCKED (MINCRM-391)', async ({
  restClient,
}) => {
  await loginAsAdmin(restClient);

  let userId: string | null = null;
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `f1-lockout-${uniqueSuffix}@example.com`;
  const correctPassword = 'L0ckoutT3st!';

  try {
    // Create a fresh user so the lockout counter starts at zero.
    const { user, inviteToken } = await inviteUserViaApi(restClient, {
      name: `F1 Lockout ${uniqueSuffix}`,
      email,
      role: 'rep',
    });
    userId = user.id;
    await setUserPassword(restClient, inviteToken, correctPassword);

    // Submit 10 consecutive failures to trigger the lockout.
    for (let i = 0; i < 10; i++) {
      const status = await attemptLogin(restClient, email, 'WrongP@ss!999');
      expect(status, `attempt ${i + 1} should return 401 before lockout`).toBe(401);
    }

    // The 11th attempt must be rejected with 429 regardless of the password supplied.
    const lockedStatus = await attemptLogin(restClient, email, 'WrongP@ss!999');
    expect(lockedStatus, 'account must be locked after 10 failures').toBe(429);
  } finally {
    if (userId) {
      await loginAsAdmin(restClient).catch(() => null);
      await deactivateUser(restClient, userId).catch((err: unknown) => {
        console.error(`[F1-LO1] teardown: failed to deactivate user ${userId}: ${String(err)}`);
      });
    }
  }
});
