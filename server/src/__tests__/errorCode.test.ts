/**
 * Unit tests for thrownCode, which reads the `code` a thrown value carries.
 */

import { thrownCode } from '../utils/errorCode.js';

describe('thrownCode', () => {
  it('returns the code an Error was tagged with', () => {
    expect(thrownCode(Object.assign(new Error('x'), { code: 'SYNC_FAILED' }))).toBe('SYNC_FAILED');
  });

  it('returns undefined for an Error with no code', () => {
    expect(thrownCode(new Error('x'))).toBeUndefined();
  });

  it('returns undefined for a thrown non-Error, even one carrying code', () => {
    for (const thrown of [{ code: 'SYNC_FAILED' }, null, undefined, 'SYNC_FAILED', 7]) {
      expect(thrownCode(thrown)).toBeUndefined();
    }
  });
});
