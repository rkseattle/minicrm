/**
 * Unit tests for apps/minicrm/helpers.ts's awaitApiResponse, against a fake page that
 * captures the predicate and timeout it is armed with. No browser involved.
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

test.describe('awaitApiResponse', () => {
  test('a string matches the exact pathname, whatever the query', () => {
    const { matches } = armed('GET', '/api/v1/contacts');
    expect(matches('GET', 'http://localhost:5173/api/v1/contacts?page=2')).toBe(true);
    expect(matches('GET', 'http://localhost:5173/api/v1/contacts/1')).toBe(false);
  });

  test('a predicate sees the whole URL, query included', () => {
    const { matches } = armed('GET', (url) => url.searchParams.get('record_id') === 'r1');
    expect(matches('GET', 'http://localhost/api/v1/email-messages?record_id=r1')).toBe(true);
    expect(matches('GET', 'http://localhost/api/v1/email-messages?record_id=r2')).toBe(false);
  });

  test('ignores a response to another method on the same path', () => {
    const { matches } = armed('PATCH', '/api/v1/accounts/1');
    expect(matches('GET', 'http://localhost/api/v1/accounts/1')).toBe(false);
    expect(matches('PATCH', 'http://localhost/api/v1/accounts/1')).toBe(true);
  });

  test('defaults the timeout and passes an explicit one through, zero included', () => {
    expect(armed('GET', '/x').timeout).toBe(FIRST_INTERACTION_TIMEOUT_MS);
    expect(armed('GET', '/x', 0).timeout).toBe(0);
  });

  test('a status never narrows the match, so a wrong one is reported rather than skipped', () => {
    const { matches } = armed('POST', '/api/v1/leads', 0, 201);
    expect(matches('POST', 'http://localhost/api/v1/leads', 500)).toBe(true);
  });

  test('a status fails the wait at once when the matching response has another', async () => {
    await expect(answered(201, 'POST', '/api/v1/leads', 0, 201)).resolves.toBeDefined();
    await expect(answered(500, 'POST', '/api/v1/leads', 0, 201)).rejects.toThrow(
      'POST /api/v1/leads answered 500, expected 201',
    );
  });

  test('a test on the status decides it', async () => {
    const failing = (status: number) => status >= 400;
    await expect(answered(503, 'POST', '/api/v1/leads', 0, failing)).resolves.toBeDefined();
    await expect(answered(200, 'POST', '/api/v1/leads', 0, failing)).rejects.toThrow(
      'answered 200, which the wait rejects',
    );
  });

  test('with no status, any status resolves the wait', async () => {
    await expect(answered(500, 'GET', '/x')).resolves.toBeDefined();
  });
});
