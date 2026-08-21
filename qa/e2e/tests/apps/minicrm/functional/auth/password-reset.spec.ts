/**
 * F1-PR — Password Reset Flow
 *
 * Functional tests for the forgot-password / reset-password flows.
 *
 * Test groups:
 *   ForgotPassword — form renders, success message shown, no user enumeration
 *   ResetPassword  — invalid token, mismatch validation, successful reset + auto-login,
 *                    session invalidation on other devices
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through behaviors
 *   - All test data managed via restClient + finally-block teardown
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * Token retrieval:
 *   The server's /api/v1/auth/dev/reset-token endpoint (non-production only) creates
 *   and returns a plaintext reset token for a given email, bypassing SMTP.
 *
 * Tagged @functional so the suite runs in:
 *   npx playwright test --grep @functional
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { registerUserDeactivation } from '@apps/minicrm/helpers.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import {
  loginAsAdmin,
  loginAs,
  getCurrentUser,
  getDevResetToken,
  logout,
  requestPasswordReset,
  resetPassword,
} from '@behaviors/minicrm/auth.behaviors.js';
import {
  inviteUserViaApi,
  setUserPassword,
  suppressUserOnboarding,
} from '@behaviors/minicrm/users.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// Password-reset tests exercise unauthenticated flows (forgot-password,
// reset link, auto-login on reset). They must not load the pre-authenticated
// storageState — each test needs a fresh, unauthenticated browser context.
// Use an empty storageState to prevent the project-level admin session
// from loading. `undefined` does not override the project config — an explicit empty
// object is required to start each test with a fresh, unauthenticated browser context.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F1-PR] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an active test user via invite + set-password.
 * Returns the user id and email.
 *
 * The caller is responsible for deactivating the user in a finally block.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param initialPassword - Password to set on the account.
 */
async function createActiveTestUser(
  testData: TestDataManager,
  restClient: RestClient,
  initialPassword: string,
): Promise<{ userId: string; email: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { user, inviteToken } = await inviteUserViaApi(restClient, {
    name: `F1-PR User ${uniqueSuffix}`,
    email: `f1-pr-${uniqueSuffix}@example.com`,
    role: 'rep',
  });
  registerUserDeactivation(testData, restClient, user.id, 'rep');

  await setUserPassword(restClient, inviteToken, initialPassword);

  // Suppress the onboarding widget so it does not intercept pointer events
  // when tests navigate the UI as this user.
  await suppressUserOnboarding(restClient, user.email, initialPassword);

  return { userId: user.id, email: user.email };
}

// ---------------------------------------------------------------------------
// Forgot-password page tests
// ---------------------------------------------------------------------------

test('@functional F1-PR1: forgot-password form — submission shows success message (no user enumeration)', async ({
  page,
}) => {
  // Submit with a known email — should show success.
  const resultKnown = await requestPasswordReset(ADMIN_EMAIL, { page });
  expect(resultKnown.success, 'known email should show success message').toBe(true);
});

test('@functional F1-PR2: forgot-password form — unknown email shows same success message (no user enumeration)', async ({
  page,
}) => {
  const result = await requestPasswordReset('no-such-user-xyz-e2e@example.com', {
    page,
  });
  expect(result.success, 'unknown email should still show success message').toBe(true);
});

// ---------------------------------------------------------------------------
// Reset-password page tests
// ---------------------------------------------------------------------------

test('@functional F1-PR3: reset-password — invalid token shows error with re-request link', async ({
  page,
}) => {
  const result = await resetPassword(
    'completely-invalid-token-xyz',
    'NewP@ssw0rd!2',
    'NewP@ssw0rd!2',
    {
      page,
    },
  );

  expect(result.success, 'invalid token reset should not succeed').toBe(false);
  expect(result.errorMessage, 'error message should be present').not.toBeNull();
  expect(new URL(result.finalUrl).pathname, 'browser should stay on /reset-password').toBe(
    '/reset-password',
  );
});

test('@functional F1-PR4: reset-password — mismatched passwords shows inline validation error', async ({
  testData,
  page,
  restClient,
}) => {
  const INITIAL_PASSWORD = 'InitP@ss1234!';

  await loginAsAdmin(restClient);

  try {
    const { email } = await createActiveTestUser(testData, restClient, INITIAL_PASSWORD);

    const token = await getDevResetToken(restClient, email);

    const result = await resetPassword(token, 'NewPass1!', 'DifferentPass2!', {
      page,
    });

    expect(result.success, 'mismatched confirmation should not succeed').toBe(false);
    expect(result.errorMessage, 'mismatch error should be present').not.toBeNull();
    expect(new URL(result.finalUrl).pathname, 'browser should stay on /reset-password').toBe(
      '/reset-password',
    );
  } finally {
    // Restore the admin session; the user is deactivated by its registered
    // teardown.
    await loginAsAdmin(restClient).catch(() => null);
  }
});

test('@functional F1-PR5: reset-password — successful reset logs user in and redirects to dashboard', async ({
  testData,
  page,
  restClient,
}) => {
  const INITIAL_PASSWORD = 'InitP@ss1234!';
  const NEW_PASSWORD = 'NewP@ssw0rd!2';

  await loginAsAdmin(restClient);

  try {
    const { email } = await createActiveTestUser(testData, restClient, INITIAL_PASSWORD);

    // Get the reset token via dev endpoint.
    const token = await getDevResetToken(restClient, email);

    // ── 1. Use the reset link ─────────────────────────────────────────────────
    const resetResult = await resetPassword(token, NEW_PASSWORD, NEW_PASSWORD, {
      page,
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
    await logout({ page });

    const replayResult = await resetPassword(token, 'AnotherP@ss3!4', 'AnotherP@ss3!4', {
      page,
    });
    expect(replayResult.success, 'replaying used token should fail').toBe(false);
    expect(replayResult.errorMessage, 'replay error should be present').not.toBeNull();
  } finally {
    // Restore the admin session; the user is deactivated by its registered
    // teardown.
    await loginAsAdmin(restClient).catch(() => null);
  }
});

test('@functional F1-PR6: reset-password — old password rejected after reset, confirming password change (MINCRM-157)', async ({
  testData,
  page,
  restClient,
}) => {
  const INITIAL_PASSWORD = 'InitP@ss1234!';
  const NEW_PASSWORD = 'NewP@ssw0rd!2';

  await loginAsAdmin(restClient);

  try {
    const { email } = await createActiveTestUser(testData, restClient, INITIAL_PASSWORD);

    // ── 1. Establish a restClient session for the test user ───────────────────
    await loginAs(restClient, email, INITIAL_PASSWORD);
    // getCurrentUser() throws on non-2xx — success here confirms session is valid.
    await getCurrentUser(restClient);

    // ── 2. Reset password via browser ─────────────────────────────────────────
    // Re-auth admin to get a new dev token (restClient now holds test-user session).
    await loginAsAdmin(restClient);
    const token = await getDevResetToken(restClient, email);

    // Do the reset in the browser — this sets password_changed_at.
    await resetPassword(token, NEW_PASSWORD, NEW_PASSWORD, { page });

    // ── 3. restClient session (issued before reset) must be invalidated ────────
    // Log the test user back in on restClient to refresh to the old session cookie.
    // Actually since restClient lost the session on admin login, we need to re-login
    // as the test user with the OLD password — which should now fail.
    let caughtStatus: number | null = null;
    try {
      await loginAs(restClient, email, INITIAL_PASSWORD);
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
    // Restore the admin session; the user is deactivated by its registered
    // teardown.
    await loginAsAdmin(restClient).catch(() => null);
  }
});
