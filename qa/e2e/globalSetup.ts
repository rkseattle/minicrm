/**
 * Playwright globalSetup — pre-authenticated admin session for storageState.
 *
 * Performs one API-based login as the E2E admin user and saves the resulting
 * browser storageState (cookies) to `.auth/admin.json`. All non-auth test
 * workers load this file instead of navigating through the login UI, eliminating
 * per-test browser login overhead.
 *
 * Auth-specific specs (auth.spec.ts, password-reset.spec.ts, permissions.spec.ts)
 * opt out via `test.use({ storageState: undefined })` and perform real UI logins.
 *
 * The `.auth/` directory is gitignored and claudeignored — never committed.
 *
 * MINCRM-192
 */

import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** Path where the admin session storageState is written. */
export const ADMIN_STORAGE_STATE = path.join(__dirname, '.auth', 'admin.json');

/**
 * globalSetup entry point called once before all workers start.
 *
 * @param config - The resolved Playwright configuration.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    process.env['E2E_BASE_URL'] ?? config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';

  const adminEmail = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['E2E_ADMIN_PASSWORD'];
  if (!adminPassword) {
    throw new Error('[globalSetup] E2E_ADMIN_PASSWORD is not set');
  }

  // Ensure the .auth/ output directory exists.
  const authDir = path.dirname(ADMIN_STORAGE_STATE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();

  try {
    const page = await context.newPage();

    // Navigate to the login page and submit credentials.
    await page.goto(`${baseURL}/login`);

    // Fill email field — locate by label text for robustness.
    await page.getByLabel(/email/i).fill(adminEmail);
    await page.getByLabel(/password/i).fill(adminPassword);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();

    // Wait for the SPA to navigate away from /login, confirming authentication.
    await page.waitForURL((url) => new URL(url).pathname !== '/login', { timeout: 15_000 });

    // Persist cookies + localStorage to disk.
    await context.storageState({ path: ADMIN_STORAGE_STATE });

    console.log('[globalSetup] Admin storageState saved to', ADMIN_STORAGE_STATE);
  } finally {
    await context.close();
    await browser.close();
  }
}
