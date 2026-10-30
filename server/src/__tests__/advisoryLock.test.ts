/**
 * Unit tests for unlockThenDispose, which every session-level advisory lock is released through.
 */

import logger from '../logger.js';
import { unlockThenDispose } from '../utils/advisoryLock.js';

describe('unlockThenDispose', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unlocks, then disposes of the connection with no failure', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const order: string[] = [];
    await unlockThenDispose(
      async () => {
        order.push('unlock');
      },
      (failure) => {
        order.push(failure ? 'destroy' : 'release');
      },
      'test',
    );
    expect(order).toEqual(['unlock', 'release']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still disposes of the connection when there is nothing to unlock', async () => {
    const dispose = vi.fn();
    await unlockThenDispose(null, dispose, 'test');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith();
  });

  it('logs a failed unlock and hands dispose the error, so the session is ended', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const failure = new Error('connection lost');
    const dispose = vi.fn();

    await unlockThenDispose(() => Promise.reject(failure), dispose, 'test');

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(failure);
    expect(warn).toHaveBeenCalledWith(
      { err: failure, lock: 'test' },
      'could not release an advisory lock; ending the session',
    );
  });

  it('wraps a thrown non-Error, so dispose still gets an Error to destroy with', async () => {
    vi.spyOn(logger, 'warn');
    const dispose = vi.fn();
    await unlockThenDispose(() => Promise.reject('boom'), dispose, 'test');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(expect.any(Error));
  });
});
