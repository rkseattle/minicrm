/**
 * Session-token expiry predicate and the refresh cadence built on it.
 *
 * Product-agnostic by design: this module reads a JWT's own `iat`/`exp` claims
 * and knows nothing about which cookie carries the token, which credentials
 * mint it, or which endpoint refreshes it. Callers supply all of that.
 *
 * WHY THIS LIVES IN THE FRAMEWORK LAYER
 * -------------------------------------
 * Two very different callers need the same predicate: the per-test fixtures,
 * which run inside Playwright, and standalone node scripts, which do not. The
 * predicate previously lived in the app-level fixtures module, which executes
 * `test.extend(...)` at import time and pulls in the entire fixture graph — so
 * a plain script could not reuse it without constructing a Playwright test
 * object as a side effect. Duplicating it into the script instead would leave
 * two copies of a rule that must agree with the server's token lifetime.
 */

/**
 * Fraction of a token's remaining life below which it is refreshed.
 *
 * A third of a 30-minute token is a 10-minute floor — comfortably longer than
 * any single test or batch iteration, and short enough that the refresh almost
 * never fires during a normal-length run.
 */
export const TOKEN_REFRESH_THRESHOLD = 1 / 3;

/**
 * The token lifetime this test suite expects the server to issue, in seconds.
 *
 * Must equal the server's own idle-expiry constant, which is redeclared in
 * three controllers. A parity check enforcing that lands alongside the batch
 * caller that depends on this cadence; until then the coupling is by
 * convention, not by gate.
 *
 * It cannot be derived at runtime where it is needed: a long-running batch loop
 * has to plan how often to check its token *before* it holds one, and getting
 * that cadence wrong is precisely the failure this module exists to prevent.
 */
export const EXPECTED_TOKEN_LIFETIME_SECONDS = 30 * 60;

/**
 * How long a caller may go between expiry checks and still be guaranteed to
 * notice before the token dies.
 *
 * A caller that checks at least this often can never cross from "outside the
 * refresh threshold" to "expired" without one check landing in between.
 *
 * Deliberately HALF the threshold window rather than all of it. At the exact
 * boundary the predicate is strict (`remaining < window`), so a token with
 * precisely one window of life left reports "not yet" — and a caller that then
 * waited a full window would find it expired with zero margin. Halving the
 * interval guarantees at least one check lands strictly inside the refresh
 * window for every possible token age, which is the property the batch cadence
 * actually depends on.
 */
export const TOKEN_CHECK_INTERVAL_SECONDS = Math.floor(
  (EXPECTED_TOKEN_LIFETIME_SECONDS * TOKEN_REFRESH_THRESHOLD) / 2,
);

/**
 * Returns true when a JWT is inside the last third of its lifetime, or when its
 * expiry cannot be read.
 *
 * Unreadable is treated as nearing expiry deliberately: a token this cannot
 * parse is one it cannot vouch for, and a needless refresh is far cheaper than
 * work that silently runs unauthenticated.
 *
 * @param token - The raw JWT from the auth cookie.
 * @returns Whether the token should be refreshed before further use.
 */
export function isTokenNearingExpiry(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iat?: number;
      exp?: number;
    };
    if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') return true;
    const lifetimeSeconds = claims.exp - claims.iat;
    if (lifetimeSeconds <= 0) return true;
    const remainingSeconds = claims.exp - Math.floor(Date.now() / 1000);
    return remainingSeconds < lifetimeSeconds * TOKEN_REFRESH_THRESHOLD;
  } catch {
    return true;
  }
}
