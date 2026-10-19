import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  driverFetch,
  isTransportFailure,
  readBodyOrNull,
  refuseLiveFetch,
  startBound,
} from '../services/mail/transport.js';

describe('startBound', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts its signal once the bound passes, and says so', async () => {
    vi.useFakeTimers();
    const bound = startBound(1_000);

    await vi.advanceTimersByTimeAsync(999);
    expect(bound.timedOut()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(bound.timedOut()).toBe(true);
    expect(bound.signal.aborted).toBe(true);
  });

  it('never fires once released', async () => {
    vi.useFakeTimers();
    const bound = startBound(1_000);

    bound.release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bound.timedOut()).toBe(false);
  });
});

describe('readBodyOrNull', () => {
  it('returns the decoded body', async () => {
    expect(await readBodyOrNull({ json: () => Promise.resolve({ id: 'x' }) }, 'Gmail')).toEqual({
      id: 'x',
    });
  });

  it.each([
    ['an undecodable body', new SyntaxError('Unexpected end of JSON input')],
    [
      'a body cut off mid-stream',
      Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } }),
    ],
  ])('returns null for %s rather than replacing the status', async (_label, err) => {
    expect(await readBodyOrNull({ json: () => Promise.reject(err) }, 'Gmail')).toBeNull();
  });
});

describe('isTransportFailure', () => {
  it('recognizes undici’s TypeError with a cause code', () => {
    const err = Object.assign(new TypeError('terminated'), { cause: { code: 'UND_ERR_SOCKET' } });
    expect(isTransportFailure(err)).toBe(true);
  });

  it.each([
    ['a TypeError with no cause', new TypeError('x is not a function')],
    ['a SyntaxError', new SyntaxError('bad json')],
    ['null', null],
  ])('does not mistake %s for a transport failure', (_label, err) => {
    expect(isTransportFailure(err)).toBe(false);
  });
});

describe('driverFetch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hands a driver built under test a transport that refuses, naming the host', () => {
    const fetchImpl = driverFetch();

    expect(fetchImpl).toBe(refuseLiveFetch);
    expect(() => refuseLiveFetch('https://gmail.googleapis.com/x')).toThrow(
      /gmail\.googleapis\.com/,
    );
  });

  it('leaves the real transport in place outside test', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(driverFetch()).toBeUndefined();
  });
});
