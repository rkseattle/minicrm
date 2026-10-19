/**
 * The request mechanics the HTTP mail drivers and their OAuth calls share: the bound on a
 * request, and reading a body whose failure must not replace the status that came with it.
 *
 * Here rather than in a driver because no driver may import another, and each copy of
 * these rules is a place for one provider to time out or classify differently.
 */

import logger from '../../logger.js';

/** A request's timeout, and whether it is what ended the request. */
export interface RequestBound {
  signal: AbortSignal;
  /** True once the bound fired. A request that failed afterwards failed because of it. */
  timedOut: () => boolean;
  /** Cancels the bound. Call it once the response, body included, has been read. */
  release: () => void;
}

/**
 * Starts the bound for one request.
 *
 * A timer rather than `AbortSignal.timeout`: that one runs on a timer a test cannot
 * advance, so every timeout path would need a real wait to exercise.
 */
export function startBound(timeoutMs: number): RequestBound {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.aborted,
    release: () => clearTimeout(timer),
  };
}

/**
 * Reads a JSON body, or null when it is empty, will not decode, or stops arriving.
 *
 * For a body read after its status already decided the outcome — an error envelope, or the
 * acknowledgement of a write. Losing it costs only detail, so the failure is logged rather
 * than allowed to replace that verdict.
 */
export async function readBodyOrNull(
  response: { json: () => Promise<unknown> },
  driver: string,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    logger.debug({ err, driver }, 'mail driver: response body could not be read');
    return null;
  }
}

/**
 * True for an error undici raises when the connection itself failed.
 *
 * undici reports every transport failure as a `TypeError` carrying a string `cause.code`,
 * including a body cut off mid-stream, which arrives after the headers did.
 */
export function isTransportFailure(err: unknown): boolean {
  // Safe: an arbitrary thrown value, narrowed by the typeof below.
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return err instanceof TypeError && typeof cause === 'string';
}

/**
 * A transport that refuses to leave the machine, for a driver built while under test.
 *
 * Drivers check scope at construction, so tests legitimately build real ones. What must
 * never happen is a test that gets past that check reaching a provider, so the refusal
 * sits on the wire rather than on the constructor.
 */
export function refuseLiveFetch(url: string): never {
  throw new Error(`mail driver: a test tried to reach ${new URL(url).host}; inject a provider`);
}

/** The transport a driver should be built with: the real one, or the refusal under test. */
export function driverFetch(): typeof refuseLiveFetch | undefined {
  return process.env.NODE_ENV === 'test' ? refuseLiveFetch : undefined;
}
