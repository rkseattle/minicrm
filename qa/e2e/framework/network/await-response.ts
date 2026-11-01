/**
 * Waits for one HTTP response by method and URL — the network half of an action whose
 * outcome a test reads from the server's answer rather than from the DOM.
 *
 * Lives in the framework so page objects can use it: they depend on the framework only.
 */

import type { Page } from '@playwright/test';

/** Zero tells Playwright no limit; the test's own timeout still bounds the wait. */
export const NO_RESPONSE_TIMEOUT = 0;

/** The methods a response is matched on. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Arms a wait for the next response with this method and URL; await it after acting.
 *
 * Arm it before the click or navigation that sends the request, or a fast answer is missed.
 * With `status`, the first matching response must have it: any other fails the wait at once,
 * naming the status that came, rather than being passed over until the wait times out.
 *
 * @param page - The page whose network to watch.
 * @param method - HTTP method.
 * @param path - The exact pathname, or a test on the whole URL.
 * @param timeout - How long to wait for the response; NO_RESPONSE_TIMEOUT for no limit.
 * @param status - The status expected, or a test on it; any status when omitted.
 * @throws When the matched response's status fails `status`, or the wait times out.
 */
export async function awaitResponse(
  page: Pick<Page, 'waitForResponse'>,
  method: HttpMethod,
  path: string | ((url: URL) => boolean),
  timeout: number,
  status?: number | ((status: number) => boolean),
): ReturnType<Page['waitForResponse']> {
  const matches = typeof path === 'string' ? (url: URL) => url.pathname === path : path;
  const response = await page.waitForResponse(
    (candidate) => candidate.request().method() === method && matches(new URL(candidate.url())),
    { timeout },
  );
  const expected = typeof status === 'number' ? (actual: number) => actual === status : status;
  if (expected && !expected(response.status())) {
    throw new Error(
      `${method} ${new URL(response.url()).pathname} answered ${String(response.status())}` +
        (typeof status === 'number' ? `, expected ${String(status)}` : ', which the wait rejects'),
    );
  }
  return response;
}
