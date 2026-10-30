/**
 * Releasing a session-level advisory lock, the same way at every site that takes one.
 */

import logger from '../logger.js';

/**
 * Unlocks, then disposes of the connection, logging an unlock that fails.
 *
 * The connection is always disposed of, so a failed unlock cannot leak it still holding the
 * lock. On that failure `dispose` gets the error: a pooled connection must then be destroyed,
 * not returned, since ending its session is what drops the lock.
 *
 * @param unlock - Runs the unlock; null when this session never took the lock.
 * @param dispose - Returns or ends the connection, given the unlock's error when it failed.
 * @param label - Names the lock in the warning.
 */
export async function unlockThenDispose(
  unlock: (() => Promise<unknown>) | null,
  dispose: (failure?: Error) => void | Promise<void>,
  label: string,
): Promise<void> {
  try {
    if (unlock) await unlock();
  } catch (err) {
    logger.warn({ err, lock: label }, 'could not release an advisory lock; ending the session');
    await dispose(err instanceof Error ? err : new Error(String(err)));
    return;
  }
  await dispose();
}
