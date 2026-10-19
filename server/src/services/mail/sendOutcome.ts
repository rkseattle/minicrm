/**
 * How a send can fail, decided the same way by every driver.
 *
 * The distinction that matters is not the provider's but the user's: a message that was
 * definitely not sent can be sent again, and one whose outcome is unknown must not be,
 * because the recipient may already have it. A driver that reported both as one code
 * would leave the caller choosing between losing mail and duplicating it.
 *
 * These codes are deliberately not `status_detail` values. A send refused for a missing
 * scope or a throttle says nothing about whether the mailbox can sync, and a caller that
 * recorded one against the account would park a mailbox that is still healthy. The one
 * exception is `SEND_AUTH_EXPIRED`, which is `PROVIDER_AUTH_EXPIRED`: the credential
 * itself was refused, the same fact on either path.
 */

import {
  PROVIDER_AUTH_EXPIRED,
  type ConnectedAccountStatusDetail,
} from '@minicrm/shared/schemas/connectedAccountSchema.js';

/** The provider may have accepted the message. Never retry, never report it as failed. */
export const SEND_OUTCOME_UNKNOWN = 'SEND_OUTCOME_UNKNOWN';

/** The provider certainly did not accept the message. Safe to send again. */
export const SEND_NOT_SENT = 'SEND_NOT_SENT';

/** The provider refused for volume. Not sent; the limit resets on its own. */
export const SEND_RATE_LIMITED = 'SEND_RATE_LIMITED';

/** The grant can read this mailbox but not send from it. Reconnecting fixes it. */
export const SEND_SCOPE_MISSING = 'SEND_SCOPE_MISSING';

/** The credential itself was refused — the one code a send shares with `status_detail`. */
// Safe: the shared constant is typed as the whole union but holds exactly this literal.
export const SEND_AUTH_EXPIRED = PROVIDER_AUTH_EXPIRED as Extract<
  ConnectedAccountStatusDetail,
  'PROVIDER_AUTH_EXPIRED'
>;

export const SEND_FAILURE_CODES = [
  SEND_OUTCOME_UNKNOWN,
  SEND_NOT_SENT,
  SEND_RATE_LIMITED,
  SEND_SCOPE_MISSING,
  SEND_AUTH_EXPIRED,
] as const;

export type SendFailureCode = (typeof SEND_FAILURE_CODES)[number];

/**
 * Bound on the request that submits a message, longer than a read's.
 *
 * A send that times out leaves its outcome unknown and is never retried, so every timeout
 * is a message the user cannot confirm. The longer bound trades a slower failure for fewer
 * of those; it is not a measured latency.
 */
export const SEND_TIMEOUT_MS = 30_000;

/**
 * Transport error codes that mean the connection never opened, so nothing was submitted.
 *
 * Anything else — a reset, a socket closed mid-response — can arrive after the provider
 * read the whole request, so it stays unknown. undici reports all of these as the same
 * `TypeError: fetch failed`; only `cause.code` tells them apart.
 */
const NEVER_CONNECTED_CODES = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
];

/** The log message for a code. Never the provider's own words, which may reach a user. */
function messageFor(code: SendFailureCode, provider: string): string {
  switch (code) {
    case SEND_OUTCOME_UNKNOWN:
      return `${provider} did not confirm the send; the message may have been sent.`;
    case SEND_NOT_SENT:
      return `${provider} did not accept the message.`;
    case SEND_RATE_LIMITED:
      return `${provider} is rate limiting sends from this mailbox.`;
    case SEND_SCOPE_MISSING:
      return 'This mailbox did not grant permission to send mail. Reconnect it to send from it.';
    case SEND_AUTH_EXPIRED:
      return `${provider} rejected the stored credentials.`;
  }
}

/** A send failure carrying its code, for the caller to map to a response. */
export function sendFailure(code: SendFailureCode, provider: string): Error {
  return Object.assign(new Error(messageFor(code, provider)), { code });
}

/** True for an error this module built, which a driver must rethrow untouched. */
export function isSendFailure(err: unknown): err is Error & { code: SendFailureCode } {
  const code = (err as { code?: unknown } | null)?.code; // Safe: narrowed by the typeof below.
  // Safe: widening the tuple so includes() accepts any string.
  return typeof code === 'string' && (SEND_FAILURE_CODES as readonly string[]).includes(code);
}

/**
 * Classifies a request that threw before any response arrived.
 *
 * @param aborted - Whether this driver's own timer cancelled the request. A timeout is
 *   always unknown: the provider may have accepted the message and simply not answered.
 */
export function transportFailureCode(err: unknown, aborted: boolean): SendFailureCode {
  if (aborted) return SEND_OUTCOME_UNKNOWN;
  // Safe: an arbitrary thrown value, narrowed by the typeof below.
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === 'string' && NEVER_CONNECTED_CODES.includes(cause)
    ? SEND_NOT_SENT
    : SEND_OUTCOME_UNKNOWN;
}

/**
 * Classifies a non-2xx answer.
 *
 * A 4xx is a definite refusal. A 5xx is not: a non-idempotent POST that failed on the
 * server may have been processed before it failed, so it is unknown — unless the request
 * could not have submitted mail at all, which is what `submits` says.
 *
 * @param throttled - The provider's own body says this was a quota, not a credential.
 * @param submits - This request is the one that hands mail to the provider.
 */
export function statusFailureCode(
  status: number,
  throttled: boolean,
  submits: boolean,
): SendFailureCode {
  if (status === 429 || throttled) return SEND_RATE_LIMITED;
  if (status === 401 || status === 403) return SEND_AUTH_EXPIRED;
  if (status >= 400 && status < 500) return SEND_NOT_SENT;
  return submits ? SEND_OUTCOME_UNKNOWN : SEND_NOT_SENT;
}
