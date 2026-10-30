/**
 * Reading a provider's stored sync cursor, which every driver keeps as a JSON object.
 */

import logger from '../../logger.js';

/**
 * The stored cursor as an object, or null when it is not one.
 *
 * A cursor that will not parse, or parses to something other than an object, is logged and
 * read as no cursor at all: the driver then resyncs from the start, which recovers it, and
 * the log is what says a stored row was corrupt rather than merely new.
 *
 * @param cursor - The stored text.
 * @param driver - Names the driver in the warning.
 */
export function parseStoredCursor(cursor: string, driver: string): Record<string, unknown> | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(cursor);
  } catch (err) {
    logger.warn(
      { err, driver },
      'mail driver: stored cursor is not JSON; resyncing from the start',
    );
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    logger.warn(
      { driver },
      'mail driver: stored cursor is not an object; resyncing from the start',
    );
    return null;
  }
  // Safe: checked just above to be a non-array object.
  return decoded as Record<string, unknown>;
}
