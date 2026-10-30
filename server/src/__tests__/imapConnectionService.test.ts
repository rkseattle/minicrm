/**
 * Unit tests for classifyImapError, which decides whether a failed IMAP login is the
 * user's to fix (bad credentials) or the server's (unreachable). No server involved.
 */

import type { ImapFlowError } from 'imapflow';
import {
  classifyImapError,
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
