import { afterEach, describe, expect, it, vi } from 'vitest';

import { newIdempotencyKey } from './idempotencyKey.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a v4 UUID, different each time', () => {
    const first = newIdempotencyKey();

    expect(first).toMatch(UUID_V4);
    expect(newIdempotencyKey()).not.toBe(first);
  });

  it('works where randomUUID is unavailable, as outside a secure context', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('not a secure context');
    });

    expect(newIdempotencyKey()).toMatch(UUID_V4);
  });
});
