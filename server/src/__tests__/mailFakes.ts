/**
 * Test doubles shared by the mail driver suites.
 *
 * Kept apart from each suite's own fake fetch because those encode one provider's contract;
 * this encodes undici's, which both drivers meet the same way.
 */

/**
 * A promise that never settles until the request's own signal aborts it, then rejects with
 * the signal's reason — the DOMException real fetch rejects with, numeric `code` and all.
 */
export function rejectOnAbort<T>(init: RequestInit): Promise<T> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });
}
