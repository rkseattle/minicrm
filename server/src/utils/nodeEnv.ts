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

/**
 * Every value the safeguards above recognize.
 *
 * AUTH_BYPASS_ENVS is a subset of NON_PRODUCTION_ENVS, so it contributes nothing.
 */
const RECOGNIZED_ENVS: readonly string[] = [...NON_PRODUCTION_ENVS, 'production'];

/**
 * Why the current NODE_ENV cannot be trusted, or null when it is recognized.
 *
 * The allowlists above fail closed, so an unrecognized value is safe — and
 * therefore invisible, indistinguishable from a deliberate production
 * deployment. Boot is where that gets said out loud.
 *
 * @returns An operator-facing message, or null when NODE_ENV is recognized.
 */
export function unrecognizedEnvMessage(): string | null {
  const current = process.env.NODE_ENV;
  if (current && RECOGNIZED_ENVS.includes(current)) return null;
  return (
    `NODE_ENV is ${current ? `set to '${current}', which is not recognized` : 'not set'}. ` +
    `Set it to one of: ${RECOGNIZED_ENVS.join(', ')}. ` +
    'Every production safeguard is chosen by this value; an unrecognized one gets the ' +
    'full production posture, which is safe but hides whether that was intended. ' +
    'See docs/operations.md#node_env.'
  );
}
