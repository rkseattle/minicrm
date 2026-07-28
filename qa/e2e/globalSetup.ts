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
 * MINCRM-192, MINCRM-221, MINCRM-559
 */

import type { FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/** Path where the admin session storageState is written. */
export const ADMIN_STORAGE_STATE = path.join(__dirname, '.auth', 'admin.json');

const IS_CI = Boolean(process.env['CI']);

/** User count at which a stale-data warning is emitted (local only). */
const STALE_DATA_WARN_THRESHOLD = 500;

/** User count at which the run is aborted to prevent cascading failures (local only). */
const STALE_DATA_ABORT_THRESHOLD = 2000;

/**
 * MINCRM-559: Check for accumulated test data in the local E2E database.
 *
 * Skipped in CI where the database is always freshly seeded. Locally, test
 * users accumulate across sessions when `npm run e2e:setup` is skipped.
 * 50k+ users have been observed, causing user-list pagination timeouts that
 * cascade across unrelated specs.
 */
async function assertStaleDataGuard(): Promise<void> {
  if (IS_CI) return;

  const databaseUrl = process.env['E2E_DATABASE_URL'];
  if (!databaseUrl) {
    console.warn(
      '[globalSetup] E2E_DATABASE_URL not set — skipping stale-data guard. ' +
        'Set it in qa/e2e/.env to enable the guard (see .env.example).',
    );
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
    const userCount = parseInt(result.rows[0].count, 10);

    if (userCount >= STALE_DATA_ABORT_THRESHOLD) {
      throw new Error(
        `[globalSetup] E2E database contains ${userCount} users — ` +
          "run 'npm run e2e:setup' to reset before testing locally.",
      );
    }

    if (userCount >= STALE_DATA_WARN_THRESHOLD) {
      console.warn(
        `[globalSetup] E2E database contains ${userCount} users — ` +
          "run 'npm run e2e:setup' to reset before testing locally.",
      );
    }
  } catch (err) {
    // The guard is advisory — a down DB or missing table should not kill the run.
    // Re-throw only for the intentional abort-threshold error; swallow everything else.
    if (err instanceof Error && err.message.startsWith('[globalSetup]')) throw err;
    console.warn(
      '[globalSetup] Stale-data guard skipped — could not query E2E database:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await client.end().catch(() => {
      // Ignore end() errors on an unconnected client.
    });
  }
}

/**
 * globalSetup entry point called once before all workers start.
 *
 * @param _config - The resolved Playwright configuration (unused; env vars drive auth).
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // MINCRM-559: Abort or warn early if the local E2E database has accumulated
  // too many users from prior test sessions. Runs before anything else so
  // cascading failures from stale data are caught before any worker starts.
  await assertStaleDataGuard();

  // No default outside CI. A silent fallback to :3001 points the whole suite at the DEV
  // server and, through it, the dev database — the leak class MINCRM-684 exists to
  // close. Every documented local invocation sources qa/e2e/.env (which sets :3002), so
  // an unset value here means the runner was started wrong, and failing beats silently
  // driving the wrong stack. CI sets E2E_API_URL explicitly in all nine of its jobs;
  // the fallback is kept for that path only.
  const E2E_API_URL =
    process.env['E2E_API_URL'] ?? (process.env['CI'] ? 'http://localhost:3001' : '');
  if (!E2E_API_URL) {
    throw new Error(
      'E2E_API_URL is not set. Local E2E runs must target the test stack on ' +
        'http://localhost:3002 — never the dev server on :3001. Source qa/e2e/.env first:\n' +
        "  cd qa && env $(cat e2e/.env | grep -v '^#' | grep -v '^$' | xargs) npm run test",
    );
  }
  const loginUrl = `${E2E_API_URL}/api/v1/auth/login`;

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

  // Cookie name is env-driven so the test stack can use its own and avoid clobbering
  // the dev stack's session in the shared localhost cookie jar. (MINCRM-684)
  const authCookieName = process.env['AUTH_COOKIE_NAME'] ?? 'minicrm_token';

  // Extract the auth cookie value from the Set-Cookie header.
  const setCookieHeader = response.headers.get('set-cookie') ?? '';
  const tokenMatch = setCookieHeader.match(new RegExp(`${authCookieName}=([^;]+)`));
  if (!tokenMatch) {
    throw new Error(
      `[globalSetup] ${authCookieName} not found in Set-Cookie header from ${loginUrl}`,
    );
  }
  const cookieValue = tokenMatch[1];

  // Mark onboarding as completed so the banner does not appear during E2E runs.
  // The banner is a first-run experience; its own spec manages the flag directly.
  const onboardingUrl = `${E2E_API_URL}/api/v1/settings/onboarding`;
  const onboardingRes = await fetch(onboardingUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${authCookieName}=${cookieValue}`,
    },
    body: JSON.stringify({ onboarding_completed: true }),
  });
  if (!onboardingRes.ok) {
    throw new Error(
      `[globalSetup] PUT ${onboardingUrl} failed with status ${onboardingRes.status}`,
    );
  }

  // Derive the domain from the API URL so the cookie is scoped correctly.
  const apiDomain = new URL(E2E_API_URL).hostname;

  const storageState = {
    cookies: [
      {
        name: authCookieName,
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
