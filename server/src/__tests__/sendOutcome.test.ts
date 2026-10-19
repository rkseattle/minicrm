import { describe, it, expect } from 'vitest';

import { PROVIDER_AUTH_EXPIRED } from '@minicrm/shared/schemas/connectedAccountSchema.js';

import {
  isSendFailure,
  SEND_AUTH_EXPIRED,
  SEND_NOT_SENT,
  SEND_OUTCOME_UNKNOWN,
  SEND_RATE_LIMITED,
  sendFailure,
  statusFailureCode,
  transportFailureCode,
} from '../services/mail/sendOutcome.js';

describe('statusFailureCode', () => {
  it.each([
    [400, SEND_NOT_SENT],
    [408, SEND_NOT_SENT],
    [499, SEND_NOT_SENT],
    [401, SEND_AUTH_EXPIRED],
    [403, SEND_AUTH_EXPIRED],
    [429, SEND_RATE_LIMITED],
    [500, SEND_OUTCOME_UNKNOWN],
    [599, SEND_OUTCOME_UNKNOWN],
  ])('classifies %i on the submitting request as %s', (status, code) => {
    expect(statusFailureCode(status, false, true)).toBe(code);
  });

  it('lets a throttle in the body outrank a credential status', () => {
    expect(statusFailureCode(403, true, true)).toBe(SEND_RATE_LIMITED);
  });

  it('treats a redirect, which this driver never follows, as unknown on a submit', () => {
    expect(statusFailureCode(302, false, true)).toBe(SEND_OUTCOME_UNKNOWN);
  });

  it('treats a redirect on a request that submits nothing as not sent', () => {
    expect(statusFailureCode(302, false, false)).toBe(SEND_NOT_SENT);
  });

  it('treats a 5xx on a request that submits nothing as not sent', () => {
    expect(statusFailureCode(503, false, false)).toBe(SEND_NOT_SENT);
  });
});

describe('transportFailureCode', () => {
  const failure = (code?: string): Error =>
    Object.assign(new TypeError('fetch failed'), code ? { cause: { code } } : {});

  it.each([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
  ])('treats %s, a connection that never opened, as not sent', (code) => {
    expect(transportFailureCode(failure(code), false)).toBe(SEND_NOT_SENT);
  });

  it.each(['ECONNRESET', 'UND_ERR_SOCKET', undefined])(
    'treats %s, which can follow an accepted request, as unknown',
    (code) => {
      expect(transportFailureCode(failure(code), false)).toBe(SEND_OUTCOME_UNKNOWN);
    },
  );

  it('treats a timeout as unknown whatever its cause says', () => {
    expect(transportFailureCode(failure('ECONNREFUSED'), true)).toBe(SEND_OUTCOME_UNKNOWN);
  });
});

describe('sendFailure', () => {
  it('builds an error the drivers recognize as already classified', () => {
    expect(isSendFailure(sendFailure(SEND_NOT_SENT, 'Gmail'))).toBe(true);
  });

  it('does not mistake an abort, whose code is numeric, for a classified failure', () => {
    expect(isSendFailure(Object.assign(new Error('aborted'), { code: 20 }))).toBe(false);
  });

  it.each([
    ['a sync code', Object.assign(new Error('x'), { code: 'CONNECTION_FAILED' })],
    ['null', null],
    ['an error with no code', new Error('x')],
  ])('does not mistake %s for a classified failure', (_label, value) => {
    expect(isSendFailure(value)).toBe(false);
  });

  it('shares only the credential code with status_detail', () => {
    expect(SEND_AUTH_EXPIRED).toBe(PROVIDER_AUTH_EXPIRED);
  });
});
