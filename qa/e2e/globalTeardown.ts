/**
 * Playwright globalTeardown — coverage reset safety net (MINCRM-605, MINCRM-607).
 *
 * Resets the backend V8 coverage agent's counters once after the run
 * completes, so a subsequent run (which may not itself call reset() before
 * its first dump) doesn't inherit stale counters left over from this one.
 * No-ops silently if coverage instrumentation isn't configured or the
 * server isn't reachable — this must never fail the E2E run over a
 * best-effort cleanup step.
 *
 * MINCRM-606
 */

const DEFAULT_API_URL = 'http://localhost:3001';
const LOGIN_ENDPOINT = '/api/v1/auth/login';
const RESET_ENDPOINT = '/api/v1/admin/coverage/reset';

function extractSessionCookie(setCookieHeader: string | null): string | undefined {
  if (!setCookieHeader) return undefined;
  return setCookieHeader.split(';')[0];
}

export default async function globalTeardown(): Promise<void> {
  const apiUrl = process.env['E2E_API_URL'] ?? DEFAULT_API_URL;
  const email = process.env['E2E_ADMIN_EMAIL'];
  const password = process.env['E2E_ADMIN_PASSWORD'];
  if (!email || !password) return;

  try {
    const loginResponse = await fetch(`${apiUrl}${LOGIN_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!loginResponse.ok) return;

    const cookie = extractSessionCookie(loginResponse.headers.get('set-cookie'));
    if (!cookie) return;

    await fetch(`${apiUrl}${RESET_ENDPOINT}`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
  } catch {
    // Best-effort cleanup only — never fail the run over this.
  }
}
