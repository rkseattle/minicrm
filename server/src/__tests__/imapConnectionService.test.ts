/**
 * Unit tests for classifyImapError, which decides whether a failed IMAP login is the
 * user's to fix (bad credentials) or the server's (unreachable), and for closeImapClient,
 * which ends a session. No server involved.
 */

import type { ImapFlow, ImapFlowError } from 'imapflow';
import logger from '../logger.js';
import {
  classifyImapError,
  closeImapClient,
  CONNECTION_FAILED,
  PROVIDER_AUTH_EXPIRED,
} from '../services/imapConnectionService.js';

/** An error shaped as imapflow throws it from a failed LOGIN. */
function loginError(fields: Partial<ImapFlowError>): Error {
  return Object.assign(new Error('Command failed'), fields);
}

describe('classifyImapError', () => {
  it('reads a refused login as expired credentials', () => {
    expect(classifyImapError(loginError({ authenticationFailed: true }))).toBe(
      PROVIDER_AUTH_EXPIRED,
    );
  });

  it('reads an AUTHENTICATIONFAILED response code as expired credentials', () => {
    expect(classifyImapError(loginError({ serverResponseCode: 'AUTHENTICATIONFAILED' }))).toBe(
      PROVIDER_AUTH_EXPIRED,
    );
  });

  it.each([
    ['a non-auth response code', loginError({ serverResponseCode: 'UNAVAILABLE' })],
    [
      'an explicit false flag beside a non-auth code',
      loginError({ authenticationFailed: false, serverResponseCode: 'UNAVAILABLE' }),
    ],
    ['a DNS failure', Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })],
    ['the auth code on .code', Object.assign(new Error('x'), { code: 'AUTHENTICATIONFAILED' })],
    ['a non-boolean flag', Object.assign(new Error('x'), { authenticationFailed: 'true' })],
    ['a thrown null', null],
    ['a thrown undefined', undefined],
    ['a thrown string', 'AUTHENTICATIONFAILED'],
  ])('reads %s as an unreachable server', (_label, err) => {
    expect(classifyImapError(err)).toBe(CONNECTION_FAILED);
  });
});

describe('closeImapClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function clientWhoseLogout(
    outcome: Promise<void>,
    usable = true,
  ): { client: ImapFlow; close: () => void; logout: () => Promise<void> } {
    const close = vi.fn();
    const logout = vi.fn(() => outcome);
    // Safe: closeImapClient touches only usable, logout and close.
    const client = { usable, logout, close } as unknown as ImapFlow;
    return { client, close, logout };
  }

  it('logs a failed logout, then closes the socket', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const failure = new Error('socket gone');
    const { client, close } = clientWhoseLogout(Promise.reject(failure));

    await closeImapClient(client);

    expect(close).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.stringContaining('logout failed'),
    );
  });

  it('closes without a logout or a warning when the session never connected', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { client, close, logout } = clientWhoseLogout(Promise.resolve(), false);

    await closeImapClient(client);

    expect(logout).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not close or log when logout succeeds', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { client, close } = clientWhoseLogout(Promise.resolve());

    await closeImapClient(client);

    expect(close).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
