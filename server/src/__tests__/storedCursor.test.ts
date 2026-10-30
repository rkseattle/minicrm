/**
 * Unit tests for parseStoredCursor, which every mail driver reads its stored cursor through.
 */

import logger from '../logger.js';
import { parseStoredCursor } from '../services/mail/storedCursor.js';

describe('parseStoredCursor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a stored object as it is', () => {
    expect(parseStoredCursor('{"INBOX":{"uidNext":"5"}}', 'IMAP')).toEqual({
      INBOX: { uidNext: '5' },
    });
  });

  it('reads text that is not JSON as no cursor, and logs it', () => {
    const warn = vi.spyOn(logger, 'warn');
    expect(parseStoredCursor('{truncated', 'Gmail')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ driver: 'Gmail', err: expect.any(SyntaxError) }),
      expect.stringContaining('is not JSON'),
    );
  });

  it('reads JSON that is not an object as no cursor, and logs it', () => {
    const warn = vi.spyOn(logger, 'warn');
    for (const stored of ['[]', '"x"', 'null', '7']) {
      expect(parseStoredCursor(stored, 'Graph')).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(
      { driver: 'Graph' },
      expect.stringContaining('is not an object'),
    );
  });
});
