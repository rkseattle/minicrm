/**
 * BVT-01 — Authentication
 *
 * Smoke-tests the three critical auth flows:
 *   1. Valid credentials → dashboard
 *   2. Invalid credentials → error shown, login page stays
 *   3. Logout → redirect back to login page
 *
 * No test data setup or teardown required — auth state is ephemeral.
 *
 * Tagged @bvt so the suite can be run in isolation:
 *   npx playwright test --grep @bvt
 *
 * MINCRM-110
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, logout } from '@behaviors/minicrm/auth.behaviors.js';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[BVT-01] E2E_ADMIN_PASSWORD is not set');

test('@bvt BVT-01: authentication — login, invalid login, logout', async ({ page, healPage }) => {
  const testName = test.info().title;

  // ── 1. Valid credentials → dashboard ─────────────────────────────────────
  const loginResult = await login(
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    { page, healPage, testName },
  );

  expect(loginResult.success, 'valid login should succeed').toBe(true);
  expect(loginResult.errorMessage).toBeNull();
  expect(loginResult.finalUrl).not.toMatch(/^.*\/$/); // not the login route

  // ── 2. Invalid credentials → error shown, still on login page ────────────
  const badLoginResult = await login(
    { email: 'nobody@example.com', password: 'wrong-password' },
    { page, healPage, testName },
  );

  expect(badLoginResult.success, 'invalid login should fail').toBe(false);
  expect(badLoginResult.errorMessage).not.toBeNull();

  // Log back in so we can test logout.
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // ── 3. Logout → back to login page ───────────────────────────────────────
  const logoutResult = await logout({ page, healPage, testName });

  expect(logoutResult.success, 'logout should redirect to login page').toBe(true);
});
