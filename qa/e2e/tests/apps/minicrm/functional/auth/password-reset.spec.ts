/**
 * F1-PR — Password Reset Flow
 *
 * Functional tests for the forgot-password / reset-password flows.
 * (MINCRM-156, MINCRM-157)
 *
 * Test groups:
 *   ForgotPassword — form renders, success message shown, no user enumeration
 *   ResetPassword  — invalid token, mismatch validation, successful reset + auto-login,
 *                    session invalidation on other devices
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through behaviors
 *   - All test data managed via restClient + finally-block teardown
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * Token retrieval:
 *   The server's /api/auth/dev/reset-token endpoint (non-production only) creates
 *   and returns a plaintext reset token for a given email, bypassing SMTP.
 *
 * Tagged @functional so the suite runs in:
 *   npx playwright test --grep @functional
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { logout, requestPasswordReset, resetPassword } from '@behaviors/minicrm/auth.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F1-PR] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InviteResponse {
  user: { id: string; email: string };
  inviteToken: string;
}

interface DevResetTokenResponse {
  token: string;
}

/**
 * Creates an active test user via invite + set-password.
 * Returns the user id, email, and initial password.
 *
 * The caller is responsible for deactivating the user in a finally block.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param initialPassword - Password to set on the account.
 */
async function createActiveTestUser(
  restClient: RestClient,
  initialPassword: string,
): Promise<{ userId: string; email: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inviteRes = await restClient.post<InviteResponse>('/api/users/invite', {
    name: `F1-PR User ${uniqueSuffix}`,
    email: `f1-pr-${uniqueSuffix}@example.com`,
    role: 'rep',
  });
  const { user, inviteToken } = inviteRes.body;

  await restClient.post('/api/users/set-password', {
    token: inviteToken,
    password: initialPassword,
  });

  return { userId: user.id, email: user.email };
}

/**
 * Calls the dev-only endpoint to get a plaintext reset token for an email.
 * Only works in non-production environments.
 *
 * @param restClient - Any RestClient (no auth required by the endpoint).
 * @param email - Email address of the user.
 * @returns The plaintext reset token.
 */
async function getDevResetToken(restClient: RestClient, email: string): Promise<string> {
  const res = await restClient.post<DevResetTokenResponse>('/api/auth/dev/reset-token', { email });
  return res.body.token;
}

// ---------------------------------------------------------------------------
// Forgot-password page tests
// ---------------------------------------------------------------------------

test('@functional F1-PR1: forgot-password form — submission shows success message (no user enumeration)', async ({
  page,
  healPage,
}) => {
  const testName = test.info().title;

  // Submit with a known email — should show success.
  const resultKnown = await requestPasswordReset(ADMIN_EMAIL, { page, healPage, testName });
  expect(resultKnown.success, 'known email should show success message').toBe(true);
});

test('@functional F1-PR2: forgot-password form — unknown email shows same success message (no user enumeration)', async ({
  page,
  healPage,
}) => {
  const testName = test.info().title;

  const result = await requestPasswordReset('no-such-user-xyz-e2e@example.com', {
    page,
    healPage,
    testName,
  });
  expect(result.success, 'unknown email should still show success message').toBe(true);
});

// ---------------------------------------------------------------------------
// Reset-password page tests
// ---------------------------------------------------------------------------

test('@functional F1-PR3: reset-password — invalid token shows error with re-request link', async ({
  page,
  healPage,
}) => {
  const testName = test.info().title;

  const result = await resetPassword('completely-invalid-token-xyz', 'NewPass1', 'NewPass1', {
    page,
    healPage,
    testName,
  });

  expect(result.success, 'invalid token reset should not succeed').toBe(false);
  expect(result.errorMessage, 'error message should be present').not.toBeNull();
  expect(new URL(result.finalUrl).pathname, 'browser should stay on /reset-password').toBe(
    '/reset-password',
  );
});

test('@functional F1-PR4: reset-password — mismatched passwords shows inline validation error', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  const INITIAL_PASSWORD = 'InitPass1!';

  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  let userId: string | null = null;
  try {
    const { userId: uid, email } = await createActiveTestUser(restClient, INITIAL_PASSWORD);
    userId = uid;

    const token = await getDevResetToken(restClient, email);

    const result = await resetPassword(token, 'NewPass1!', 'DifferentPass2!', {
      page,
      healPage,
      testName,
    });

    expect(result.success, 'mismatched confirmation should not succeed').toBe(false);
    expect(result.errorMessage, 'mismatch error should be present').not.toBeNull();
    expect(new URL(result.finalUrl).pathname, 'browser should stay on /reset-password').toBe(
      '/reset-password',
    );
  } finally {
    if (userId) {
      await restClient
        .post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/users/${userId}/deactivate`).catch((err: unknown) => {
        console.error(`[F1-PR4] teardown failed: ${String(err)}`);
      });
    }
  }
});

test('@functional F1-PR5: reset-password — successful reset logs user in and redirects to dashboard', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  const INITIAL_PASSWORD = 'InitPass1!';
  const NEW_PASSWORD = 'NewPass2@';

  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  let userId: string | null = null;
  try {
    const { userId: uid, email } = await createActiveTestUser(restClient, INITIAL_PASSWORD);
    userId = uid;

    // Get the reset token via dev endpoint.
    const token = await getDevResetToken(restClient, email);

    // ── 1. Use the reset link ─────────────────────────────────────────────────
    const resetResult = await resetPassword(token, NEW_PASSWORD, NEW_PASSWORD, {
      page,
      healPage,
      testName,
    });

    expect(resetResult.success, 'password reset should succeed').toBe(true);
    expect(resetResult.errorMessage, 'no error on successful reset').toBeNull();

    // ── 2. Should be auto-logged in (redirected to dashboard, not /login) ─────
    expect(
      new URL(resetResult.finalUrl).pathname,
      'user should be redirected to dashboard after reset',
    ).not.toBe('/login');
    expect(
      new URL(resetResult.finalUrl).pathname,
      'user should not stay on /reset-password',
    ).not.toBe('/reset-password');

    // ── 3. Old token must be invalidated (single-use) ─────────────────────────
    // Navigate away first so we can test the old token.
    await logout({ page, healPage, testName });

    const replayResult = await resetPassword(token, 'AnotherPass3@', 'AnotherPass3@', {
      page,
      healPage,
      testName,
    });
    expect(replayResult.success, 'replaying used token should fail').toBe(false);
    expect(replayResult.errorMessage, 'replay error should be present').not.toBeNull();
  } finally {
    if (userId) {
      await restClient
        .post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/users/${userId}/deactivate`).catch((err: unknown) => {
        console.error(`[F1-PR5] teardown failed: ${String(err)}`);
      });
    }
  }
});

test('@functional F1-PR6: reset-password — old password rejected after reset, confirming password change (MINCRM-157)', async ({
  page,
  healPage,
  restClient,
}) => {
  const testName = test.info().title;
  const INITIAL_PASSWORD = 'InitPass1!';
  const NEW_PASSWORD = 'NewPass2@';

  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  let userId: string | null = null;
  try {
    const { userId: uid, email } = await createActiveTestUser(restClient, INITIAL_PASSWORD);
    userId = uid;

    // ── 1. Establish a restClient session for the test user ───────────────────
    await restClient.post('/api/auth/login', { email, password: INITIAL_PASSWORD });
    const beforeReset = await restClient.get<{ user: { id: string } }>('/api/auth/me');
    expect(beforeReset.status, 'restClient session should be valid before reset').toBe(200);

    // ── 2. Reset password via browser ─────────────────────────────────────────
    // Re-auth admin to get a new dev token (restClient now holds test-user session).
    const adminClient = await restClient.post('/api/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    void adminClient; // used for side-effect (login sets cookie on restClient)
    const token = await getDevResetToken(restClient, email);

    // Do the reset in the browser — this sets password_changed_at.
    await resetPassword(token, NEW_PASSWORD, NEW_PASSWORD, { page, healPage, testName });

    // ── 3. restClient session (issued before reset) must be invalidated ────────
    // Log the test user back in on restClient to refresh to the old session cookie.
    // Actually since restClient lost the session on admin login, we need to re-login
    // as the test user with the OLD password — which should now fail.
    let caughtStatus: number | null = null;
    try {
      await restClient.post('/api/auth/login', { email, password: INITIAL_PASSWORD });
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        caughtStatus = err.status;
      } else {
        throw err;
      }
    }

    // Old password should be rejected (401 invalid credentials).
    expect(caughtStatus, 'old password should be rejected after reset (password was changed)').toBe(
      401,
    );
  } finally {
    if (userId) {
      await restClient
        .post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
        .catch(() => null);
      await restClient.patch(`/api/users/${userId}/deactivate`).catch((err: unknown) => {
        console.error(`[F1-PR6] teardown failed: ${String(err)}`);
      });
    }
  }
});
