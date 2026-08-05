/**
 * Session-cookie policy — the single definition of how long a session lasts and
 * how its cookie is written.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * These values were previously copy-pasted across authController, mfaController
 * and ssoController, with comments ("must match authController constant", "kept
 * in sync with authController") standing in for an import. The absolute cap was
 * exported from authController yet redeclared inside the auth middleware,
 * shadowing the export. Five `res.cookie` call sites repeated the same option
 * block verbatim.
 *
 * That is a security-relevant duplication, not just untidy: the project requires
 * `httpOnly`, prod-only `secure`, `sameSite: 'lax'` and a bounded `maxAge` on
 * every authentication cookie, and with five copies that requirement held only
 * because all five happened to agree. A sixth login path — another SSO provider,
 * a device-trust flow — would be one forgotten `httpOnly` away from shipping a
 * script-readable session cookie, and nothing would have failed. Centralizing
 * makes the policy impossible to partially apply. (MINCRM-703)
 */

import type { Response } from 'express';

/**
 * Name of the cookie that holds the JWT.
 *
 * Overridable via AUTH_COOKIE_NAME so two stacks on the same host can hold independent
 * sessions. Cookies are scoped by domain, NOT by port, so the dev stack (localhost:5173)
 * and the test stack (localhost:5175) otherwise share one jar: logging into either
 * overwrites the other's token, and the victim sees "your session has expired" because
 * the surviving token names a user that exists only in the other stack's database.
 * Defaults to the historical value, so unset changes nothing. (MINCRM-684)
 *
 * Defined here rather than in the auth middleware because the cookie's name is
 * part of the same policy as its attributes and lifetime; the middleware
 * re-exports it so existing importers are unaffected. (MINCRM-703)
 */
export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? 'minicrm_token';

/**
 * JWT idle-expiry window — 30 minutes (MINCRM-365).
 *
 * The token slides with use, but only because the client calls the refresh
 * endpoint on activity: `authenticate` verifies a token without ever re-issuing
 * it, so a caller that never refreshes dies at this boundary no matter how busy
 * it is.
 */
export const JWT_IDLE_EXPIRY_SECONDS = 30 * 60;

/** Cookie max-age in milliseconds for idle-expiry tokens. */
export const COOKIE_MAX_AGE_MS = JWT_IDLE_EXPIRY_SECONDS * 1000;

/**
 * Absolute session cap — 8 hours from original login (MINCRM-365).
 *
 * Enforced against the `login_at` claim, which is embedded at login and
 * preserved through every refresh, so refreshing cannot extend a session past
 * this. Distinct from the idle expiry above: this one is not slideable.
 */
export const ABSOLUTE_SESSION_CAP_SECONDS = 8 * 60 * 60;

/**
 * Attributes required on every authentication cookie, and shared by setting and
 * clearing each one.
 *
 * A cookie is only removable by a `clearCookie` whose attributes match the ones
 * it was written with — differ on `sameSite` or `secure` and the browser keeps
 * the original. For the session cookie that leaves a logged-out user holding a
 * live token; for the SSO relay-state cookie it leaves a single-use CSRF value
 * in the jar, available for replay. Sharing one definition is what keeps each
 * set/clear pair in agreement.
 *
 * Exported so shorter-lived auth cookies (the SSO relay state) carry the same
 * attributes without restating them.
 */
export const AUTH_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
} as const;

/**
 * Writes the session cookie with the project's required attributes.
 *
 * Every login path must go through this rather than calling `res.cookie`
 * directly, so the security attributes cannot be partially applied.
 *
 * @param res - Express response to set the cookie on.
 * @param token - The signed session JWT.
 */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...AUTH_COOKIE_ATTRIBUTES,
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

/**
 * Clears the session cookie using the same attributes it was written with.
 *
 * @param res - Express response to clear the cookie on.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, AUTH_COOKIE_ATTRIBUTES);
}
