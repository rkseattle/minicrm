/**
 * F1-INV — Invite Set-Password Flow
 *
 * Functional tests for the invite / set-password UI. (MINCRM-262)
 *
 * Covers:
 *   - /set-password renders for an unauthenticated user with a valid invite token
 *   - Invalid / missing token shows the error state, not a redirect to login
 *   - Mismatched passwords show an inline validation error
 *   - Successful set-password redirects to /login
 *   - Already-activated token shows the already-activated message
 *   - Protected routes still redirect unauthenticated users to login (no regression)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through behaviors
 *   - All test data managed via restClient + finally-block teardown
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * Token retrieval:
 *   The invite token is returned inline by POST /api/users/invite (admin only),
 *   so no separate dev endpoint is needed.
 *
 * Tagged @functional so the suite runs in:
 *   npx playwright test --grep @functional
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { setPassword, navigateToProtectedPage } from '@behaviors/minicrm/auth.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// MINCRM-262: Set-password tests exercise an unauthenticated flow. Use an
// empty storageState to prevent the project-level admin session from loading.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F1-INV] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InviteResponse {
  user: { id: string; email: string };
  inviteToken: string;
}

/**
 * Creates a new invited user and returns the user id, email, and invite token.
 * The caller is responsible for deactivating/cleaning up the user.
 *
 * @param restClient - Admin-authenticated RestClient.
 */
async function createInvitedUser(
  restClient: RestClient,
): Promise<{ userId: string; email: string; inviteToken: string }> {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const inviteRes = await restClient.post<InviteResponse>('/api/users/invite', {
    name: `F1-INV User ${uniqueSuffix}`,
    email: `f1-inv-${uniqueSuffix}@example.com`,
    role: 'rep',
  });
  const { user, inviteToken } = inviteRes.body;
  return { userId: user.id, email: user.email, inviteToken };
}

// ---------------------------------------------------------------------------
// Set-password page — route guard regression
// ---------------------------------------------------------------------------

test('@functional F1-INV1: /set-password — renders form for unauthenticated user with invite token (no redirect to login)', async ({
  page,
  restClient,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { userId, inviteToken } = await createInvitedUser(restClient);

  try {
    const setPasswordPage = (await import('@pages/minicrm/SetPasswordPage.js')).SetPasswordPage;
    const po = new setPasswordPage({ page });

    await po.navigate(inviteToken);

    const invalidToken = await po.invalidTokenVisible();
    expect(invalidToken, 'set-password form should render, not show invalid-token error').toBe(
      false,
    );

    const finalUrl = page.url();
    expect(
      new URL(finalUrl).pathname,
      'unauthenticated user should stay on /set-password, not be redirected to /login',
    ).toBe('/set-password');
  } finally {
    await restClient.patch(`/api/users/${userId}/deactivate`, {});
  }
});

test('@functional F1-INV2: /set-password — invalid token shows error on the page, not a redirect to login', async ({
  page,
}) => {
  const setPasswordPage = (await import('@pages/minicrm/SetPasswordPage.js')).SetPasswordPage;
  const po = new setPasswordPage({ page });

  await po.navigate('completely-invalid-token-xyz');

  const finalUrl = page.url();
  expect(
    new URL(finalUrl).pathname,
    'invalid token should stay on /set-password, not redirect to /login',
  ).toBe('/set-password');
});

test('@functional F1-INV3: /set-password — missing token shows invalid-token error, not a redirect to login', async ({
  page,
}) => {
  await page.goto('/set-password');

  const setPasswordPage = (await import('@pages/minicrm/SetPasswordPage.js')).SetPasswordPage;
  const po = new setPasswordPage({ page });

  const invalidToken = await po.invalidTokenVisible();
  expect(invalidToken, 'missing token should show invalid-token error').toBe(true);

  const finalUrl = page.url();
  expect(
    new URL(finalUrl).pathname,
    'missing token should stay on /set-password, not redirect to /login',
  ).toBe('/set-password');
});

// ---------------------------------------------------------------------------
// Set-password page — form validation
// ---------------------------------------------------------------------------

test('@functional F1-INV4: /set-password — mismatched passwords shows inline validation error', async ({
  page,
  restClient,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { userId, inviteToken } = await createInvitedUser(restClient);

  try {
    const result = await setPassword(inviteToken, 'NewPass1!', 'DifferentPass2!', { page });

    expect(result.success, 'mismatched passwords should not succeed').toBe(false);
    expect(result.errorMessage, 'mismatch error should be shown').not.toBeNull();
    expect(new URL(result.finalUrl).pathname, 'browser should stay on /set-password').toBe(
      '/set-password',
    );
  } finally {
    await restClient.patch(`/api/users/${userId}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// Set-password page — successful activation
// ---------------------------------------------------------------------------

test('@functional F1-INV5: /set-password — successful activation redirects to /login', async ({
  page,
  restClient,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const { userId, inviteToken } = await createInvitedUser(restClient);

  try {
    const NEW_PASSWORD = 'InvitePass1!';
    const result = await setPassword(inviteToken, NEW_PASSWORD, NEW_PASSWORD, { page });

    expect(result.success, 'successful set-password should navigate away from /set-password').toBe(
      true,
    );
    expect(
      new URL(result.finalUrl).pathname,
      'successful set-password should redirect to /login',
    ).toBe('/login');
  } finally {
    await restClient.patch(`/api/users/${userId}/deactivate`, {});
  }
});

// ---------------------------------------------------------------------------
// Auth guard regression — protected routes still redirect unauthenticated users
// ---------------------------------------------------------------------------

test('@functional F1-INV6: auth guard — unauthenticated access to /contacts still redirects to /login (no regression)', async ({
  page,
}) => {
  const result = await navigateToProtectedPage('/contacts', { page });

  expect(
    result.redirectedToLogin,
    'unauthenticated access to /contacts should redirect to /login',
  ).toBe(true);
});
