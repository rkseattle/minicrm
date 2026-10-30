/**
 * Unit tests for apps/minicrm/helpers.ts's awaitApiResponse, against a fake page that
 * captures the predicate and timeout it is armed with. No browser involved.
 */

import { test, expect } from '@framework/fixtures';
import { awaitApiResponse, FIRST_INTERACTION_TIMEOUT_MS } from '@apps/minicrm/helpers';

type ArmedPage = Parameters<typeof awaitApiResponse>[0];
/** The two members of a response awaitApiResponse's matcher reads. */
interface FakeResponse {
  request: () => { method: () => string };
  url: () => string;
}
type Predicate = (response: FakeResponse) => boolean;

function armed(...args: [string, string | ((url: URL) => boolean), number?]) {
  let predicate: Predicate = () => false;
  let timeout: number | undefined;
  const page = {
    waitForResponse: (matcher: Predicate, options?: { timeout?: number }) => {
      predicate = matcher;
      timeout = options?.timeout;
      return Promise.resolve();
    },
  };
  // Safe: the fake implements the one waitForResponse overload awaitApiResponse calls.
  void awaitApiResponse(page as unknown as ArmedPage, ...args);
  return { matches: (method: string, url: string) => predicate(fake(method, url)), timeout };
}

function fake(method: string, url: string): FakeResponse {
  return { request: () => ({ method: () => method }), url: () => url };
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
});
