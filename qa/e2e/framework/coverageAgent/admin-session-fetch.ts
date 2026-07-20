/**
 * Minimal admin-session HTTP helper for coverage code that runs outside the
 * fixture/test context (reporters, globalTeardown), where Playwright's
 * `request` fixture and RestClient are unavailable. Shared by
 * coverage-reporter.ts and globalTeardown.ts so the login+cookie-extraction
 * logic has one implementation, not two independently-maintained copies.
 */

const DEFAULT_API_URL = 'http://localhost:3001';
const LOGIN_ENDPOINT = '/api/v1/auth/login';

/** Extracts the raw session cookie from a login response's Set-Cookie header. */
function extractSessionCookie(setCookieHeader: string | null): string | undefined {
  if (!setCookieHeader) return undefined;
  return setCookieHeader.split(';')[0];
}

/**
 * Logs in with E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD and returns a Cookie
 * header value for subsequent authenticated fetch() calls, or undefined if
 * credentials are unset, the login fails, or no Set-Cookie header is
 * returned. Never throws — callers in reporters/teardown must treat a
 * missing session as "nothing to do," not a hard error.
 */
export async function fetchAdminSessionCookie(apiUrl?: string): Promise<string | undefined> {
  const resolvedApiUrl = apiUrl ?? process.env['E2E_API_URL'] ?? DEFAULT_API_URL;
  const email = process.env['E2E_ADMIN_EMAIL'];
  const password = process.env['E2E_ADMIN_PASSWORD'];
  if (!email || !password) return undefined;

  try {
    const loginResponse = await fetch(`${resolvedApiUrl}${LOGIN_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!loginResponse.ok) return undefined;

    return extractSessionCookie(loginResponse.headers.get('set-cookie'));
  } catch {
    return undefined;
  }
}

/** Resolves the E2E API base URL the same way fetchAdminSessionCookie does. */
export function resolveE2eApiUrl(): string {
  return process.env['E2E_API_URL'] ?? DEFAULT_API_URL;
}
