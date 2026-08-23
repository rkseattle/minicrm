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

/** Environments where the API docs and dev-only test endpoints may be served. */
const NON_PRODUCTION_ENVS = new Set(['development', 'test', 'staging']);

/**
 * Environments where an authentication bypass may be honored.
 *
 * Excludes staging deliberately: it is a real multi-user deployment carrying
 * human traffic, so dropping auth there is a production-grade exposure even
 * though serving the docs there is not.
 */
const AUTH_BYPASS_ENVS = new Set(['development', 'test']);

/** True only for a recognized non-production environment. */
export function isNonProductionEnv(): boolean {
  return NON_PRODUCTION_ENVS.has(process.env.NODE_ENV ?? '');
}

/** True only where dropping an authentication check is acceptable. */
export function isAuthBypassEnv(): boolean {
  return AUTH_BYPASS_ENVS.has(process.env.NODE_ENV ?? '');
}
