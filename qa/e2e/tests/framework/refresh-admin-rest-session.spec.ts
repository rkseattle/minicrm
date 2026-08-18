/**
 * refreshAdminRestSession — unit specs.
 *
 * Covers the REST counterpart to refreshAdminBrowserSession: the function a
 * long-running REST caller uses to slide its session forward before the
 * 30-minute idle expiry kills it mid-run.
 *
 * WHY THIS MATTERS
 * ----------------
 * Two properties here are load-bearing and neither is visible from the call
 * site:
 *
 *   1. The happy path must hit POST /auth/refresh, NOT /auth/login. Refresh is
 *      bcrypt-free; login is not. Across the ~1000-iteration ingest loop on a
 *      single-threaded server, silently regressing to login per refresh is the
 *      stall that already causes ECONNRESET elsewhere in this suite.
 *   2. The fallback must trigger on ANY 401. /auth/refresh sits behind the
 *      authenticate middleware, so an already-expired token is rejected there
 *      and never yields the absolute-timeout code. A fallback keyed to that one
 *      code is dead code exactly when it is needed.
 *
 * Lives under tests/framework/ because that is the only spec directory CI runs
 * unconditionally (`test:framework:coverage`, qa/package.json). No server and
 * no browser are required — the RestClient's underlying context is mocked.
 */

import { test, expect } from '@playwright/test';
import { RestClient } from '@framework/clients/rest-client.js';
import { refreshAdminRestSession } from '@behaviors/minicrm/auth.behaviors.js';
import type { APIRequestContext, APIResponse } from '@playwright/test';

/** A request the mock context observed. */
interface RecordedRequest {
  method: string;
  url: string;
}

/**
 * Builds a mock APIResponse.
 *
 * @param status - HTTP status code.
 * @param body - Object returned by json().
 * @returns Mock APIResponse.
 */
function mockApiResponse(status: number, body: unknown): APIResponse {
  return {
    status: () => status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: () => ({ 'content-type': 'application/json' }),
    ok: () => status >= 200 && status < 300,
    url: () => 'http://localhost:3001/test',
    body: () => Promise.resolve(Buffer.from(JSON.stringify(body))),
    dispose: () => Promise.resolve(),
  } as unknown as APIResponse;
}

/**
 * Builds a mock context that records every POST and replies via `handler`.
 *
 * @param recorded - Array the mock appends each observed request to.
 * @param handler - Maps a request URL to the status it should answer with.
 * @returns Mock APIRequestContext.
 */
function recordingContext(
  recorded: RecordedRequest[],
  handler: (url: string) => number,
): APIRequestContext {
  return {
    post: (url: string) => {
      recorded.push({ method: 'POST', url });
      const status = handler(url);
      return Promise.resolve(
        mockApiResponse(status, status === 200 ? { ok: true } : { error: {} }),
      );
    },
  } as unknown as APIRequestContext;
}

test.describe('refreshAdminRestSession', () => {
  let priorPassword: string | undefined;

  test.beforeEach(() => {
    // loginAsAdmin reads credentials from the environment and throws without
    // them; the fallback tests need it to get far enough to issue its POST.
    priorPassword = process.env['E2E_ADMIN_PASSWORD'];
    process.env['E2E_ADMIN_PASSWORD'] ??= 'test-password-1234';
  });

  test.afterEach(() => {
    // Restore rather than leak: workers run many spec files per process, and a
    // stray fake password would let a later spec that should have failed fast
    // on the missing-var guard proceed to a confusing 401 instead.
    if (priorPassword === undefined) {
      delete process.env['E2E_ADMIN_PASSWORD'];
    } else {
      process.env['E2E_ADMIN_PASSWORD'] = priorPassword;
    }
  });

  test('refreshes via /auth/refresh and never touches /auth/login', async () => {
    const recorded: RecordedRequest[] = [];
    const ctx = recordingContext(recorded, () => 200);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    await refreshAdminRestSession(client);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.url).toContain('/api/v1/auth/refresh');
    // The bcrypt-avoidance property, stated as an assertion rather than a hope.
    expect(recorded.some((r) => r.url.includes('/auth/login'))).toBe(false);
  });

  test('falls back to a full login on a 401 from refresh', async () => {
    const recorded: RecordedRequest[] = [];
    const ctx = recordingContext(recorded, (url) => (url.includes('/auth/refresh') ? 401 : 200));
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    await refreshAdminRestSession(client);

    expect(recorded).toHaveLength(2);
    expect(recorded[0]?.url).toContain('/api/v1/auth/refresh');
    expect(recorded[1]?.url).toContain('/api/v1/auth/login');
  });

  test('propagates a non-401 failure instead of masking it with a login', async () => {
    const recorded: RecordedRequest[] = [];
    const ctx = recordingContext(recorded, () => 500);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    // A 500 is a server problem, not an expired session. Retrying it as a login
    // would convert a loud infrastructure failure into a confusing auth one.
    let caught: unknown;
    try {
      await refreshAdminRestSession(client);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(recorded).toHaveLength(1);
    expect(recorded.some((r) => r.url.includes('/auth/login'))).toBe(false);
  });

  test('surfaces a login failure after a 401 rather than looping', async () => {
    const recorded: RecordedRequest[] = [];
    // A genuinely revoked admin: refresh 401s, and so does the login behind it.
    const ctx = recordingContext(recorded, () => 401);
    const client = new RestClient(ctx, { baseUrl: 'http://localhost:3001' });

    let caught: unknown;
    try {
      await refreshAdminRestSession(client);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(recorded).toHaveLength(2);
  });
});
