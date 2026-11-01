/**
 * Unit tests for apps/minicrm/helpers.ts's awaitApiResponse, the app's default-timeout
 * wrapper over awaitResponse, against a fake page. No browser involved.
 */

import { test, expect } from '@framework/fixtures';
import { awaitApiResponse, FIRST_INTERACTION_TIMEOUT_MS } from '@apps/minicrm/helpers';

type ArmedPage = Parameters<typeof awaitApiResponse>[0];
/** The members of a response awaitApiResponse's matcher reads. */
interface FakeResponse {
  request: () => { method: () => string };
  url: () => string;
  status: () => number;
}
type Predicate = (response: FakeResponse) => boolean;

function armed(
  ...args: Parameters<typeof awaitApiResponse> extends [unknown, ...infer Rest] ? Rest : never
) {
  let predicate: Predicate = () => false;
  let timeout: number | undefined;
  const page = {
    waitForResponse: (matcher: Predicate, options?: { timeout?: number }) => {
      predicate = matcher;
      timeout = options?.timeout;
      // Answers with the expected status, so a status-checking wait armed here resolves.
      const [, , , status] = args;
      return Promise.resolve(
        fake('GET', 'http://localhost/', typeof status === 'number' ? status : 200),
      );
    },
  };
  // Safe: the fake implements the one waitForResponse overload awaitApiResponse calls.
  void awaitApiResponse(page as unknown as ArmedPage, ...args);
  return {
    matches: (method: string, url: string, status = 200) => predicate(fake(method, url, status)),
    timeout,
  };
}

/** Runs a wait whose page answers once, with this status, on the path armed. */
function answered(
  status: number,
  ...args: Parameters<typeof awaitApiResponse> extends [unknown, ...infer Rest] ? Rest : never
) {
  const [, path] = args;
  const url = `http://localhost${typeof path === 'string' ? path : '/'}`;
  const page = {
    waitForResponse: () => Promise.resolve(fake(args[0], url, status)),
  };
  // Safe: the fake implements the one waitForResponse overload awaitApiResponse calls.
  return awaitApiResponse(page as unknown as ArmedPage, ...args);
}

function fake(method: string, url: string, status: number): FakeResponse {
  return { request: () => ({ method: () => method }), url: () => url, status: () => status };
}

// Matching and status handling are awaitResponse's, tested in tests/framework/await-response.spec.ts.
test.describe('awaitApiResponse', () => {
  test('defaults the timeout and passes an explicit one through, zero included', () => {
    expect(armed('GET', '/x').timeout).toBe(FIRST_INTERACTION_TIMEOUT_MS);
    expect(armed('GET', '/x', 0).timeout).toBe(0);
  });

  test('passes method, path and status through to the wait', async () => {
    const { matches } = armed('PATCH', '/api/v1/accounts/1');
    expect(matches('PATCH', 'http://localhost/api/v1/accounts/1')).toBe(true);
    expect(matches('GET', 'http://localhost/api/v1/accounts/1')).toBe(false);
    await expect(answered(500, 'POST', '/api/v1/leads', 0, 201)).rejects.toThrow(
      'POST /api/v1/leads answered 500, expected 201',
    );
  });
});
