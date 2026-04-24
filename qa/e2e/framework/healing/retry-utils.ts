/**
 * Retry helper for transient API failures in the AiHealer tier.
 *
 * MINCRM-224
 */

import { APIError } from '@anthropic-ai/sdk/error.js';

/** Status codes that represent transient failures worth retrying. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Default backoff delays (ms) between retry attempts. */
export const DEFAULT_RETRY_DELAYS_MS = [1_000, 2_000] as const;

/**
 * Wraps an async function with up to `delays.length` retries on transient errors.
 *
 * Retries on: 429, 500, 502, 503, 504.
 * Does not retry on: 400, 401, 403, or non-APIError throws.
 *
 * @param fn - The async operation to attempt.
 * @param delays - Per-attempt delay in ms. Defaults to [1000, 2000]. Pass [0, 0] in tests.
 * @returns The resolved value, or re-throws the last error after all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const status = err instanceof APIError ? err.status : undefined;

      if (status === undefined || !RETRYABLE_STATUS_CODES.has(status)) {
        // Non-transient error — do not retry.
        throw err;
      }

      if (attempt < delays.length) {
        console.warn(
          `AiHealer: transient API error (status ${status}), retrying (attempt ${attempt + 1} of ${delays.length})`,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
      } else {
        console.error(
          `AiHealer: transient API error (status ${status}), all ${delays.length} retries exhausted`,
        );
      }
    }
  }

  throw lastError;
}
