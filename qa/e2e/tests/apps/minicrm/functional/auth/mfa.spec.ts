/**
 * F8 — Two-Factor Authentication (TOTP)
 *
 * Functional regression tests for TOTP MFA setup, login, disable, and
 * admin enforcement. Tests cover the full end-to-end flows as a real user
 * would experience them.
 *
 * Test groups:
 *   Setup    — enable MFA via profile page (QR → verify → recovery codes)
 *   Login    — TOTP login challenge after password succeeds
 *   Recovery — login using a single-use recovery code
 *   Disable  — disable MFA via profile page (password confirmation)
 *   Admin    — admin can toggle org-wide MFA enforcement setting
 *
 * MINCRM-392
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  loginAsAdmin,
  loginViaBrowser,
  loginWithMfaChallenge,
  loginWithRecoveryCode,
  enableMfaViaApi,
  disableMfaViaApi,
  enableMfa,
  disableMfa,
  navigateToAdminSettingsGeneralPage,
  waitForMfaRequiredCheckbox,
  isMfaRequiredChecked,
  clickMfaRequiredCheckbox,
  waitForMfaRequiredSuccess,
} from '@behaviors/minicrm/auth.behaviors.js';
import { createTestUser } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// F8 tests exercise login flows — do not inherit the project-level admin storageState.
test.use({ storageState: { cookies: [], origins: [] } });

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F8-mfa] E2E_ADMIN_PASSWORD is not set');

/** Password used for all test users created in this suite. */
const USER_PASSWORD = 'MfaTest1!Secure';

// ---------------------------------------------------------------------------
// MFA setup tests
// ---------------------------------------------------------------------------

test('@functional F8-S1: enable MFA via profile page — QR → verify → recovery codes → enabled badge', async ({
  page,
  restClient,
}) => {
  // Create a test user as admin.
  await loginAsAdmin(restClient);
  const user = await createTestUser(restClient, { password: USER_PASSWORD });

  // Re-authenticate restClient as the test user so the dev/totp-code endpoint
  // is scoped to that user's pending secret during setup.
  await restClient.post('/api/v1/auth/login', { email: user.email, password: USER_PASSWORD });

  try {
    // Log in via the browser as the test user (page session is separate from restClient).
    await loginViaBrowser(user.email, USER_PASSWORD, { page });

    // Run the full MFA enable flow (uses restClient for the dev TOTP endpoint).
    const result = await enableMfa(restClient, { page });

    expect(result.recoveryCodesShown, 'recovery codes modal should appear after setup').toBe(true);
    expect(result.enabled, 'disable button should be visible once MFA is enabled').toBe(true);
  } finally {
    await disableMfaViaApi(restClient, USER_PASSWORD).catch(() => null);
    await loginAsAdmin(restClient);
    await restClient.patch(`/api/v1/users/${user.id}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// MFA login tests
// ---------------------------------------------------------------------------

test('@functional F8-LS1: TOTP login — password ok → MFA modal → TOTP code → session established', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const user = await createTestUser(restClient, { password: USER_PASSWORD });

  // Pre-enable MFA via API (restClient re-authenticated as the user).
  await restClient.post('/api/v1/auth/login', { email: user.email, password: USER_PASSWORD });
  await enableMfaViaApi(restClient);

  try {
    const result = await loginWithMfaChallenge(user.email, USER_PASSWORD, restClient, { page });

    expect(result.success, 'login should succeed after submitting valid TOTP code').toBe(true);
    expect(result.finalUrl, 'browser should navigate away from /login').not.toContain('/login');
  } finally {
    await disableMfaViaApi(restClient, USER_PASSWORD).catch(() => null);
    await loginAsAdmin(restClient);
    await restClient.patch(`/api/v1/users/${user.id}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// Recovery code login tests
// ---------------------------------------------------------------------------

test('@functional F8-LS2: recovery code login — MFA modal → switch mode → recovery code → session established', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const user = await createTestUser(restClient, { password: USER_PASSWORD });

  await restClient.post('/api/v1/auth/login', { email: user.email, password: USER_PASSWORD });
  const { recoveryCodes } = await enableMfaViaApi(restClient);

  try {
    const result = await loginWithRecoveryCode(user.email, USER_PASSWORD, recoveryCodes[0]!, {
      page,
    });

    expect(result.success, 'login should succeed after submitting a valid recovery code').toBe(
      true,
    );
    expect(result.finalUrl, 'browser should navigate away from /login').not.toContain('/login');
  } finally {
    await disableMfaViaApi(restClient, USER_PASSWORD).catch(() => null);
    await loginAsAdmin(restClient);
    await restClient.patch(`/api/v1/users/${user.id}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// MFA disable tests
// ---------------------------------------------------------------------------

test('@functional F8-D1: disable MFA via profile page — password confirmed → enable button visible', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const user = await createTestUser(restClient, { password: USER_PASSWORD });

  await restClient.post('/api/v1/auth/login', { email: user.email, password: USER_PASSWORD });
  await enableMfaViaApi(restClient);

  try {
    // Browser login: MFA is enabled, so go through the TOTP challenge.
    await loginWithMfaChallenge(user.email, USER_PASSWORD, restClient, { page });

    const result = await disableMfa(USER_PASSWORD, { page });

    expect(result.disabled, 'enable button should be visible after disabling MFA').toBe(true);
  } finally {
    // MFA is disabled by the test body — just deactivate.
    await loginAsAdmin(restClient);
    await restClient.patch(`/api/v1/users/${user.id}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// Admin MFA enforcement tests
// ---------------------------------------------------------------------------

// Unconditionally reset require_mfa to false after F8-A1 regardless of how the
// test body exits. UI-based "restore to initiallyChecked" is not reliable: if
// require_mfa was already true (from a prior dirty run), the test would toggle
// false → true and leave the setting dirty, blocking every other test suite
// that calls loginAsAdmin(). (MINCRM-544 env-cleanup fix)
async function resetMfaRequired(restClient: RestClient): Promise<void> {
  try {
    await loginAsAdmin(restClient);
  } catch {
    // Ignore re-auth errors; attempt the patch regardless.
  }
  await restClient
    .patch('/api/v1/settings/mfa-required', { mfa_required: false })
    .catch(() => undefined);
}

test('@functional F8-A1: admin can toggle org-wide MFA enforcement in General Settings', async ({
  page,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  await loginViaBrowser(ADMIN_EMAIL, ADMIN_PASSWORD, { page });

  try {
    await navigateToAdminSettingsGeneralPage({ page });

    await waitForMfaRequiredCheckbox({ page }, 10_000);

    // Ensure we start from a known-false state so the test is deterministic.
    if (await isMfaRequiredChecked({ page })) {
      await clickMfaRequiredCheckbox({ page });
      await waitForMfaRequiredSuccess({ page }, 5_000);
    }

    // Toggle on.
    await clickMfaRequiredCheckbox({ page });
    await waitForMfaRequiredSuccess({ page }, 5_000);
    expect(
      await isMfaRequiredChecked({ page }),
      'checkbox should be enabled after first click',
    ).toBe(true);

    // Toggle off.
    await clickMfaRequiredCheckbox({ page });
    await waitForMfaRequiredSuccess({ page }, 5_000);
    expect(
      await isMfaRequiredChecked({ page }),
      'checkbox should be disabled after second click',
    ).toBe(false);
  } finally {
    // Always reset via API — UI-based restore is unreliable across dirty runs.
    await resetMfaRequired(restClient);
  }
});
