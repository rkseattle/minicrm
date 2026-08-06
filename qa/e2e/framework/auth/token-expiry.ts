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
 * Must equal the server's own idle-expiry constant, which lives in
 * server/src/auth/sessionCookie.ts. The two cannot share a definition — this
 * workspace must not import server modules at runtime — so the coupling is
 * enforced by qa/scripts/check-token-refresh-parity.sh, which fails CI if
 * either side moves without the other.
 *
 * It cannot be derived at runtime where it is needed: callers reason about the
 * cadence of their own expiry checks against it, and the specs construct tokens
 * of the lifetime the server really issues rather than an invented one.
 *
 * Callers must check at least once per refresh window
 * (lifetime * TOKEN_REFRESH_THRESHOLD, i.e. 10 minutes here) or a token can go
 * from "not yet" to expired between two checks. Both current callers check
 * before every unit of work, which is far inside that bound.
 */
export const EXPECTED_TOKEN_LIFETIME_SECONDS = 30 * 60;

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

/** A client that can report a cookie value from its own context. */
export interface CookieReadableClient {
  getCookie(name: string): Promise<string | null>;
}

/**
 * How a caller keeps a session alive: which cookie carries it, and how to mint
 * a fresh one.
 *
 * Both halves are supplied by the caller so this layer stays free of any
 * knowledge of cookie names, routes, or credentials.
 */
export interface SessionUpkeep<TClient extends CookieReadableClient> {
  /** Name of the cookie holding the session token. */
  cookieName: string;
  /** Mints a fresh session on the client's own context. */
  refresh: (client: TClient) => Promise<void>;
  /**
   * Called after a successful refresh so the caller can persist the new session
   * somewhere durable.
   *
   * Essential for per-test callers whose context is rebuilt from a file each
   * time. Without persistence the refreshed cookie dies with the test that
   * earned it, the next test re-reads the same stale token, and the refresh
   * fires again — turning an amortized once-per-token-lifetime cost into a
   * per-test one. On a single-threaded server that is a password hash per test,
   * the precise cost the refresh threshold exists to avoid.
   *
   * Failures are swallowed and warned about: a session that was refreshed but
   * not shared is still usable by the caller that earned it.
   */
  onRefreshed?: (client: TClient) => Promise<void>;
}

/** What a caller wants to happen when the refresh itself fails. */
export interface SessionUpkeepOptions {
  /**
   * Throw when the refresh fails, instead of warning and continuing.
   *
   * The right answer differs by caller and there is no safe default for both:
   *
   * - Per-test fixtures pass false (the default). A spec that manages its own
   *   auth, or that never needed the shared session, must not fail because an
   *   opportunistic refresh could not reach the server.
   * - Batch loops pass true. When the session cannot be renewed, every
   *   remaining iteration is guaranteed to fail as unauthorized — continuing
   *   turns one clear error into hundreds of misleading ones, and reports a
   *   partial result as though the refresh had worked.
   */
  throwOnFailure?: boolean;
}

/** Outcome of an upkeep pass. */
export interface SessionUpkeepResult {
  /** Whether the token was stale enough that a refresh was attempted. */
  attempted: boolean;
  /** Whether that refresh actually succeeded. False whenever none was tried. */
  refreshed: boolean;
}

/**
 * Refreshes a client's session when its token is at or past the refresh
 * threshold. No-op when upkeep is not configured, when the context holds no
 * such cookie, or when the token still has ample life.
 *
 * Shared by the per-test fixture and by long-running batch scripts, which need
 * the same decision for the same reason: the idle window is shorter than the
 * work, and sliding it requires an explicit call. They differ only in what a
 * failure means — see SessionUpkeepOptions.throwOnFailure.
 *
 * @param client - Client whose underlying context holds the session cookie.
 * @param upkeep - Cookie name and refresh function, or null to opt out.
 * @param options - Failure policy. Warn-and-continue unless told otherwise.
 * @returns Whether a refresh was attempted, and whether it succeeded.
 */
export async function applySessionUpkeep<TClient extends CookieReadableClient>(
  client: TClient,
  upkeep: SessionUpkeep<TClient> | null,
  options: SessionUpkeepOptions = {},
): Promise<SessionUpkeepResult> {
  if (!upkeep) return { attempted: false, refreshed: false };

  // Only when a token already exists and is actually close to expiring. An
  // unauthenticated context is the normal case for many callers and must not
  // be silently authenticated here; and refreshing every time would add a
  // round trip per unit of work for no benefit.
  const token = await client.getCookie(upkeep.cookieName).catch(() => null);
  if (!token || !isTokenNearingExpiry(token)) {
    return { attempted: false, refreshed: false };
  }

  try {
    await upkeep.refresh(client);

    // Confirm the client's own session actually changed, rather than trusting
    // that refresh() did not throw. A refresh that renews a session somewhere
    // else — a throwaway context, a file — leaves this caller holding the same
    // dying token while reporting success, and every request it then makes
    // fails as unauthorized. Verifying here is what makes `refreshed`
    // meaningful to the caller and to the counters built on it.
    // Compares the raw cookie because a renewed token is a different string in
    // every case this can reach: the guard only runs on a token already inside
    // the refresh threshold, i.e. minutes old, so the new one always carries a
    // later iat. Two signings within the same whole second WOULD be
    // byte-identical — the payload has no nonce — but that requires refreshing
    // a token issued moments ago, which the threshold check makes unreachable.
    const renewedToken = await client.getCookie(upkeep.cookieName).catch(() => null);
    if (renewedToken === token) {
      throw new Error(
        `session refresh left the client's ${upkeep.cookieName} cookie unchanged — ` +
          'the refresh did not renew this context',
      );
    }

    if (upkeep.onRefreshed) {
      await upkeep.onRefreshed(client).catch((err: unknown) => {
        // The session is live either way — only the sharing of it failed, so
        // this caller proceeds and the next one simply refreshes again.
        console.warn(
          '[session-upkeep] refreshed session could not be persisted; ' +
            'subsequent callers will refresh again:',
          err instanceof Error ? err.message : String(err),
        );
      });
    }
    return { attempted: true, refreshed: true };
  } catch (err) {
    if (options.throwOnFailure) throw err;
    // Best-effort, but never silent: this refresh is the only thing standing
    // between a long run and a dead cookie, and a swallowed failure degrades
    // into every request failing as unauthorized, which reads as a permissions
    // bug rather than an expired session.
    console.warn(
      '[session-upkeep] refresh failed; continuing with the existing cookie, ' +
        'which may already be rejected:',
      err instanceof Error ? err.message : String(err),
    );
    return { attempted: true, refreshed: false };
  }
}
