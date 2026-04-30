/**
 * Playwright globalSetup — pre-authenticated admin session for storageState.
 *
 * POSTs credentials directly to the auth API, parses the Set-Cookie header,
 * and writes a storageState JSON file to `.auth/admin.json`. All non-auth test
 * workers load this file instead of navigating through the login UI, eliminating
 * per-test browser login overhead.
 *
 * Auth-specific specs (auth.spec.ts, password-reset.spec.ts, permissions.spec.ts)
 * opt out via `test.use({ storageState: undefined })` and perform real UI logins.
 *
 * The `.auth/` directory is gitignored and claudeignored — never committed.
 *
 * MINCRM-192, MINCRM-221
 */

import type { FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** Path where the admin session storageState is written. */
export const ADMIN_STORAGE_STATE = path.join(__dirname, '.auth', 'admin.json');

/**
 * globalSetup entry point called once before all workers start.
 *
 * @param _config - The resolved Playwright configuration (unused; env vars drive auth).
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const apiUrl = process.env['E2E_API_URL'] ?? 'http://localhost:3001';
  const loginUrl = `${apiUrl}/api/v1/auth/login`;

  const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['E2E_ADMIN_PASSWORD'];

  // When E2E_ADMIN_PASSWORD is absent (e.g. the framework-specs CI job, which
  // runs unit tests with no app server), skip the login and write an empty
  // storageState. Framework specs never use storageState so this is safe.
  if (!adminPassword) {
    const authDir = path.dirname(ADMIN_STORAGE_STATE);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    fs.writeFileSync(ADMIN_STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    console.log(
      '[globalSetup] E2E_ADMIN_PASSWORD not set — skipping login, wrote empty storageState',
    );
    return;
  }

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });

  if (!response.ok) {
    throw new Error(
      `[globalSetup] Login request to ${loginUrl} failed with status ${response.status}`,
    );
  }

  // Extract the minicrm_token value from the Set-Cookie header.
  const setCookieHeader = response.headers.get('set-cookie') ?? '';
  const tokenMatch = setCookieHeader.match(/minicrm_token=([^;]+)/);
  if (!tokenMatch) {
    throw new Error(`[globalSetup] minicrm_token not found in Set-Cookie header from ${loginUrl}`);
  }
  const cookieValue = tokenMatch[1];

  // Mark onboarding as completed so the banner does not appear during E2E runs.
  // The banner is a first-run experience; its own spec manages the flag directly.
  const onboardingUrl = `${apiUrl}/api/v1/settings/onboarding`;
  const onboardingRes = await fetch(onboardingUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `minicrm_token=${cookieValue}`,
    },
    body: JSON.stringify({ onboarding_completed: true }),
  });
  if (!onboardingRes.ok) {
    throw new Error(
      `[globalSetup] PUT ${onboardingUrl} failed with status ${onboardingRes.status}`,
    );
  }

  // Derive the domain from the API URL so the cookie is scoped correctly.
  const apiDomain = new URL(apiUrl).hostname;

  const storageState = {
    cookies: [
      {
        name: 'minicrm_token',
        value: cookieValue,
        domain: apiDomain,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  // Ensure the .auth/ output directory exists.
  const authDir = path.dirname(ADMIN_STORAGE_STATE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  fs.writeFileSync(ADMIN_STORAGE_STATE, JSON.stringify(storageState, null, 2));

  console.log('[globalSetup] Admin storageState saved to', ADMIN_STORAGE_STATE);
}
