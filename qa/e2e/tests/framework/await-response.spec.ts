/**
 * Unit tests for awaitResponse: which responses it matches, the timeout it hands
 * Playwright, and how it fails on an unexpected status. A stub page replays a fixed list of
 * responses through the predicate, as Playwright offers each one in turn. No browser.
 */

import { test, expect } from '@framework/fixtures';
import type { Page, Response } from '@playwright/test';
import { awaitResponse, NO_RESPONSE_TIMEOUT } from '@framework/network/await-response';

interface FakeResponse {
  method: string;
  url: string;
  status: number;
}

/** A page whose waitForResponse returns the first replayed response its predicate accepts. */
function pageReplaying(responses: FakeResponse[]): {
  page: Pick<Page, 'waitForResponse'>;
  timeouts: Array<number | undefined>;
} {
  const timeouts: Array<number | undefined> = [];
  const page = {
    waitForResponse: async (
      predicate: (response: Response) => boolean,
      options?: { timeout?: number },
    ) => {
      timeouts.push(options?.timeout);
      for (const fake of responses) {
        // Safe: the predicate and the caller read only request().method(), url() and status().
        const response = {
          request: () => ({ method: () => fake.method }),
          url: () => fake.url,
          status: () => fake.status,
        } as unknown as Response;
        if (predicate(response)) return response;
      }
      throw new Error('no response matched');
    },
  } as unknown as Pick<Page, 'waitForResponse'>;
  return { page, timeouts };
}

const ORIGIN = 'http://app.test';

test.describe('awaitResponse', () => {
  test('matches an exact pathname and method, skipping other methods and paths', async () => {
    const { page } = pageReplaying([
      { method: 'GET', url: `${ORIGIN}/items/1`, status: 200 },
      { method: 'PATCH', url: `${ORIGIN}/items/10`, status: 200 },
      { method: 'PATCH', url: `${ORIGIN}/items/1?x=1`, status: 204 },
    ]);

    const response = await awaitResponse(page, 'PATCH', '/items/1', 5_000);

    expect(response.status()).toBe(204);
  });

  test('takes a test on the whole URL, query string included', async () => {
    const { page } = pageReplaying([
      { method: 'GET', url: `${ORIGIN}/items`, status: 200 },
      { method: 'GET', url: `${ORIGIN}/items?search=a`, status: 201 },
    ]);

    const response = await awaitResponse(
      page,
      'GET',
      (url) => url.href.includes('search='),
      NO_RESPONSE_TIMEOUT,
    );

    expect(response.status()).toBe(201);
  });

  test('hands its timeout to Playwright as given, zero meaning no limit', async () => {
    const { page, timeouts } = pageReplaying([{ method: 'GET', url: `${ORIGIN}/a`, status: 200 }]);

    await awaitResponse(page, 'GET', '/a', NO_RESPONSE_TIMEOUT);
    await awaitResponse(page, 'GET', '/a', 1_234);

    expect(timeouts).toEqual([0, 1_234]);
  });

  test('fails at once on a status other than the one expected, naming both', async () => {
    const { page } = pageReplaying([{ method: 'POST', url: `${ORIGIN}/a`, status: 409 }]);

    await expect(awaitResponse(page, 'POST', '/a', 5_000, 201)).rejects.toThrow(
      'POST /a answered 409, expected 201',
    );
  });

  test('applies a status test, and passes a status it accepts', async () => {
    const { page } = pageReplaying([{ method: 'DELETE', url: `${ORIGIN}/a`, status: 404 }]);

    await expect(
      awaitResponse(page, 'DELETE', '/a', 5_000, (status) => status < 400),
    ).rejects.toThrow('DELETE /a answered 404, which the wait rejects');
    await expect(
      awaitResponse(page, 'DELETE', '/a', 5_000, (status) => status === 404),
    ).resolves.toBeDefined();
  });
});
