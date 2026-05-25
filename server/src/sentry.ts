/**
 * Sentry error tracking integration for the server (MINCRM-285).
 * Only initializes when SENTRY_DSN is set and NODE_ENV is not 'test'.
 * All exports are safe to call unconditionally — they no-op when Sentry is not active.
 */

import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import logger from './logger.js';

const SENTRY_DSN = process.env.SENTRY_DSN;
const IS_TEST = process.env.NODE_ENV === 'test';

/**
 * Strips PII from a Sentry event before transmission (MINCRM-394).
 * - Removes POST body (request.data) to prevent credential/payload leakage
 * - Removes user.email, user.username, user.name to comply with GDPR
 * - Removes all extra fields which may contain arbitrary app-level PII
 */
export function redactPiiFromEvent(event: ErrorEvent): ErrorEvent {
  const redacted = { ...event };

  if (redacted.request) {
    redacted.request = { ...redacted.request, data: undefined };
  }

  if (redacted.user) {
    const { email: _email, username: _username, name: _name, ...safeUser } = redacted.user;
    redacted.user = safeUser;
  }

  if (redacted.extra !== undefined) {
    redacted.extra = undefined;
  }

  return redacted;
}

export function initSentry(): void {
  if (!SENTRY_DSN || IS_TEST) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    beforeSend: redactPiiFromEvent,
  });

  logger.info('Sentry error tracking initialized');
}

export function captureException(err: unknown): void {
  if (!SENTRY_DSN || IS_TEST) return;
  Sentry.captureException(err);
}
