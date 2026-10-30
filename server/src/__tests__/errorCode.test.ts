/**
 * Unit tests for thrownCode, which reads the `code` a thrown value carries.
 */

import { thrownCauseCode, thrownCode } from '../utils/errorCode.js';

describe('thrownCode', () => {
  it('returns the code an Error was tagged with', () => {
    expect(thrownCode(Object.assign(new Error('x'), { code: 'SYNC_FAILED' }))).toBe('SYNC_FAILED');
  });

  it('returns undefined for an Error with no code', () => {
    expect(thrownCode(new Error('x'))).toBeUndefined();
  });

  it('returns undefined for an Error whose code is not a string, as a DOMException has', () => {
    expect(thrownCode(Object.assign(new Error('x'), { code: 20 }))).toBeUndefined();
  });

  it('returns undefined for a thrown non-Error, even one carrying code', () => {
    for (const thrown of [{ code: 'SYNC_FAILED' }, null, undefined, 'SYNC_FAILED', 7]) {
      expect(thrownCode(thrown)).toBeUndefined();
    }
  });
});

describe('thrownCauseCode', () => {
  it("returns the string code on an error's cause", () => {
    const cause = Object.assign(new Error('dns'), { code: 'ENOTFOUND' });
    expect(thrownCauseCode(new TypeError('fetch failed', { cause }))).toBe('ENOTFOUND');
  });

  it('reads the code off a cause that is a plain object', () => {
    expect(thrownCauseCode(new Error('x', { cause: { code: 'ENOTFOUND' } }))).toBe('ENOTFOUND');
  });

  it('returns undefined with no cause, a non-object cause, or a non-string code', () => {
    const numeric = Object.assign(new Error('x'), { code: 20 });
    for (const thrown of [
      new Error('x'),
      new Error('x', { cause: 'ENOTFOUND' }),
      new Error('x', { cause: numeric }),
      { cause: new Error('x') },
      null,
    ]) {
      expect(thrownCauseCode(thrown)).toBeUndefined();
    }
  });
});
