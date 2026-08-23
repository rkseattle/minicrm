/**
 * Environment classification for production safeguards.
 *
 * Every gate that relaxes a safeguard outside production goes through here, so
 * a new one cannot be added to one list and forgotten in another.
 *
 * Both predicates are allowlists rather than `!== 'production'`: an unset or
 * misspelled NODE_ENV must fail closed. Inverted, it served the API docs, a
 * plaintext reset-token endpoint, and a live TOTP endpoint to any deployment
 * that forgot the variable.
 */

/** Environments where the API docs may be served and errors need not be redacted. */
const NON_PRODUCTION_ENVS = new Set(['development', 'test', 'staging']);

/**
 * Environments where credentials may be handed out without authentication.
 *
 * Excludes staging deliberately: it is a real multi-user deployment carrying
 * human traffic, so an endpoint that mints a password-reset token or a live TOTP
 * code is a production-grade exposure there, even though serving the docs is not.
 */
const AUTH_BYPASS_ENVS = new Set(['development', 'test']);

/** True only for a recognized non-production environment. */
export function isNonProductionEnv(): boolean {
  return NON_PRODUCTION_ENVS.has(process.env.NODE_ENV ?? '');
}

/**
 * True wherever transport security must not be relaxed.
 *
 * The inverse of isAuthBypassEnv, not of isNonProductionEnv: staging serves the
 * API docs but carries real traffic, so a session cookie without Secure is a
 * production-grade exposure there for the same reason a reset-token endpoint is.
 * Written as a negation rather than `=== 'production'` so an unset or misspelled
 * NODE_ENV gets the safeguard instead of losing it.
 */
export function isProductionEnv(): boolean {
  return !isAuthBypassEnv();
}

/** True only where handing out credentials without authentication is acceptable. */
export function isAuthBypassEnv(): boolean {
  return AUTH_BYPASS_ENVS.has(process.env.NODE_ENV ?? '');
}
