/**
 * Session upkeep — unit specs (MINCRM-703).
 *
 * `applySessionUpkeep` decides whether a session needs refreshing before more
 * work is done on it. Three callers share it: the `page` fixture, the
 * `restClient` fixture (giving REST specs the protection the browser half
 * already had), and the coverage-dump ingest script, whose ~1000-iteration loop
 * outlives the idle window outright.
 *
 * These specs drive the real function, not a copy of it — a spec that
 * re-implemented these branches would keep passing while the callers drifted
 * away from it.
 *
 * WHY THIS MATTERS
 * ----------------
 * Three branches, each with a distinct failure mode if it inverts:
 *   - No cookie at all: must NOT refresh. Many specs deliberately run
 *     unauthenticated, and minting a session for them would silently defeat
 *     exactly what they assert.
 *   - Healthy cookie: must NOT refresh. Refreshing per test adds a round trip
 *     per test across the whole suite for no benefit.
 *   - Nearing-expiry cookie: must refresh. This is the whole point — the
 *     30-minute idle window is shorter than a long suite, and a dead cookie
 *     turns every subsequent request into a 401.
 *
 * A failed cookie read never propagates. A failed refresh propagates only when
 * the caller asks: fixtures warn and continue, because a spec managing its own
 * auth must not break over an opportunistic refresh, while a batch loop throws,
 * because an unrenewable session means every remaining iteration is guaranteed
 * to fail and should say so once rather than hundreds of times.
 */

import { test, expect } from '@playwright/test';
import {
  applySessionUpkeep,
  EXPECTED_TOKEN_LIFETIME_SECONDS,
} from '@framework/auth/token-expiry.js';
import type { RestClientSessionRefresh } from '@framework/fixtures/rest-client.fixture.js';
import { RestClient } from '@framework/clients/rest-client.js';
import type { APIRequestContext } from '@playwright/test';

const COOKIE_NAME = 'test_session_cookie';

/**
 * Builds a JWT-shaped token issued `ageSeconds` ago.
 *
 * @param ageSeconds - How long ago the token was issued.
 * @returns A JWT-shaped string.
 */
function tokenAged(ageSeconds: number): string {
  const issuedAt = Math.floor(Date.now() / 1000) - ageSeconds;
  const payload = Buffer.from(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + EXPECTED_TOKEN_LIFETIME_SECONDS }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

/**
 * Builds a real RestClient whose context reports the given cookie.
 *
 * @param value - Cookie value to report, or null for an empty jar.
 * @returns A RestClient over a stubbed context.
 */
function clientWithCookie(value: string | null): RestClient {
  const ctx = {
    storageState: () =>
      Promise.resolve({
        cookies: value === null ? [] : [{ name: COOKIE_NAME, value }],
        origins: [],
      }),
  } as unknown as APIRequestContext;
  return new RestClient(ctx, { baseUrl: 'http://localhost:3001' });
}

/**
 * Builds a client whose cookie can be replaced, modelling a real context whose
 * jar is mutated by an authenticated request.
 *
 * @param value - Initial cookie value.
 * @returns The client plus a setter for its current cookie.
 */
function mutableClient(value: string): { client: RestClient; setCookie: (v: string) => void } {
  let current = value;
  const ctx = {
    storageState: () =>
      Promise.resolve({ cookies: [{ name: COOKIE_NAME, value: current }], origins: [] }),
  } as unknown as APIRequestContext;
  return {
    client: new RestClient(ctx, { baseUrl: 'http://localhost:3001' }),
    setCookie: (v: string) => {
      current = v;
    },
  };
}

/**
 * Builds an upkeep config that records whether its refresh ran.
 *
 * @param onRefresh - Optional behavior for the refresh call.
 * @returns The config plus a getter for whether refresh was invoked.
 */
function upkeepSpy(onRefresh: () => Promise<void> = () => Promise.resolve()): {
  config: RestClientSessionRefresh;
  called: () => boolean;
} {
  let called = false;
  return {
    config: {
      cookieName: COOKIE_NAME,
      refresh: () => {
        called = true;
        return onRefresh();
      },
    },
    called: () => called,
  };
}

test.describe('applySessionUpkeep', () => {
  test('does nothing when no upkeep is injected', async () => {
    const result = await applySessionUpkeep(clientWithCookie(tokenAged(29 * 60)), null);
    expect(result.attempted).toBe(false);
  });

  test('does not refresh an unauthenticated context', async () => {
    // Minting a session here would silently authenticate the many specs that
    // deliberately start with an empty jar.
    const spy = upkeepSpy();
    const result = await applySessionUpkeep(clientWithCookie(null), spy.config);
    expect(result.attempted).toBe(false);
    expect(spy.called()).toBe(false);
  });

  test('does not refresh a healthy token', async () => {
    const spy = upkeepSpy();
    const result = await applySessionUpkeep(clientWithCookie(tokenAged(60)), spy.config);
    expect(result.attempted).toBe(false);
    expect(spy.called()).toBe(false);
  });

  test('refreshes a token inside the expiry threshold', async () => {
    const { client, setCookie } = mutableClient(tokenAged(25 * 60));
    let called = false;

    const result = await applySessionUpkeep(client, {
      cookieName: COOKIE_NAME,
      refresh: () => {
        called = true;
        setCookie(tokenAged(0));
        return Promise.resolve();
      },
    });

    expect(called).toBe(true);
    expect(result.attempted).toBe(true);
    expect(result.refreshed).toBe(true);
  });

  test('refreshes an unparseable token rather than trusting it', async () => {
    const { client, setCookie } = mutableClient('not-a-jwt');

    const result = await applySessionUpkeep(client, {
      cookieName: COOKIE_NAME,
      refresh: () => {
        setCookie(tokenAged(0));
        return Promise.resolve();
      },
    });

    expect(result.attempted).toBe(true);
    expect(result.refreshed).toBe(true);
  });

  test('reports failure when the refresh leaves the client unchanged', async () => {
    // The defect this guard exists for: a refresh that renews a session
    // somewhere else — a throwaway context, a file — leaves this caller holding
    // the same dying token. Reporting that as success is what turns "one
    // refresh" into "every subsequent request 401s".
    const { client } = mutableClient(tokenAged(25 * 60));

    const result = await applySessionUpkeep(client, {
      cookieName: COOKIE_NAME,
      refresh: () => Promise.resolve(),
    });

    expect(result.attempted).toBe(true);
    expect(result.refreshed).toBe(false);
  });

  test('throws on an unchanged client when the caller asks to', async () => {
    const { client } = mutableClient(tokenAged(25 * 60));

    await expect(
      applySessionUpkeep(
        client,
        { cookieName: COOKIE_NAME, refresh: () => Promise.resolve() },
        { throwOnFailure: true },
      ),
    ).rejects.toThrow(/unchanged/);
  });

  test('a failing refresh does not propagate by default', async () => {
    const spy = upkeepSpy(() => Promise.reject(new Error('server unreachable')));

    // Resolves rather than rejects — the assertion that would fail if the catch
    // were removed.
    const result = await applySessionUpkeep(clientWithCookie(tokenAged(25 * 60)), spy.config);

    expect(spy.called()).toBe(true);
    expect(result.attempted).toBe(true);
    // The distinction the caller needs: it was tried, and it did NOT work.
    // Reporting this as a completed refresh is what let a batch loop log
    // "1 session refresh" while every subsequent request failed.
    expect(result.refreshed).toBe(false);
  });

  test('a failing refresh throws when the caller asks it to', async () => {
    // Batch callers opt into this: if the session cannot be renewed, every
    // remaining iteration is guaranteed to fail, so one loud error beats
    // hundreds of misleading ones.
    const spy = upkeepSpy(() => Promise.reject(new Error('server unreachable')));

    await expect(
      applySessionUpkeep(clientWithCookie(tokenAged(25 * 60)), spy.config, {
        throwOnFailure: true,
      }),
    ).rejects.toThrow('server unreachable');
    expect(spy.called()).toBe(true);
  });

  test('a successful refresh does not throw under throwOnFailure', async () => {
    const { client, setCookie } = mutableClient(tokenAged(25 * 60));

    const result = await applySessionUpkeep(
      client,
      {
        cookieName: COOKIE_NAME,
        refresh: () => {
          setCookie(tokenAged(0));
          return Promise.resolve();
        },
      },
      { throwOnFailure: true },
    );

    expect(result.refreshed).toBe(true);
  });

  test('persists the refreshed session when the caller supplies a hook', async () => {
    // Without persistence the refreshed cookie dies with the caller that
    // earned it and the next one refreshes again — a login per test rather
    // than per token lifetime.
    const { client, setCookie } = mutableClient(tokenAged(25 * 60));
    let persisted = false;

    const result = await applySessionUpkeep(client, {
      cookieName: COOKIE_NAME,
      refresh: () => {
        setCookie(tokenAged(0));
        return Promise.resolve();
      },
      onRefreshed: () => {
        persisted = true;
        return Promise.resolve();
      },
    });

    expect(result.refreshed).toBe(true);
    expect(persisted).toBe(true);
  });

  test('does not persist when no refresh was needed', async () => {
    let persisted = false;
    await applySessionUpkeep(clientWithCookie(tokenAged(60)), {
      cookieName: COOKIE_NAME,
      refresh: () => Promise.resolve(),
      onRefreshed: () => {
        persisted = true;
        return Promise.resolve();
      },
    });

    expect(persisted).toBe(false);
  });

  test('a failing persist does not fail the refresh', async () => {
    // The session is live either way; only the sharing of it failed, so the
    // caller that earned it proceeds and later ones simply refresh again.
    const { client, setCookie } = mutableClient(tokenAged(25 * 60));

    const result = await applySessionUpkeep(client, {
      cookieName: COOKIE_NAME,
      refresh: () => {
        setCookie(tokenAged(0));
        return Promise.resolve();
      },
      onRefreshed: () => Promise.reject(new Error('disk full')),
    });

    expect(result.refreshed).toBe(true);
  });

  test('a failing cookie read does not propagate', async () => {
    const ctx = {
      storageState: () => Promise.reject(new Error('context disposed')),
    } as unknown as APIRequestContext;
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });
    const spy = upkeepSpy();

    const result = await applySessionUpkeep(client, spy.config);

    expect(result.attempted).toBe(false);
    expect(spy.called()).toBe(false);
  });
});
