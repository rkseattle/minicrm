/**
 * Where the browser lands after either OAuth leg, with a result code.
 *
 * One helper rather than a copy per caller: the allowlist is the only thing stopping a
 * library message or a provider banner reaching the address bar, and a second
 * unguarded path to the same redirect is how that protection gets bypassed later.
 */

/** Result codes that may appear in a redirect URL. */
const SAFE_OAUTH_RESULT_CODES = new Set([
  'connected',
  'PROVIDER_NOT_CONFIGURED',
  'OAUTH_STATE_INVALID',
  'PROVIDER_NO_EMAIL',
  'FEATURE_DISABLED',
  'SESSION_EXPIRED',
  'INSUFFICIENT_CAPABILITY',
]);

/** Builds the profile URL carrying an allowlisted result code. */
export function profileRedirectUrl(code: string): string {
  const base = process.env.APP_BASE_URL ?? 'http://localhost:5173';
  const safe = SAFE_OAUTH_RESULT_CODES.has(code) ? code : 'OAUTH_FAILED';
  return `${base}/profile?connect=${encodeURIComponent(safe)}`;
}
