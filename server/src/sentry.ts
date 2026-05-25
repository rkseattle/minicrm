/**
 * Sentry error tracking integration for the server (MINCRM-285).
 * Only initializes when SENTRY_DSN is set and NODE_ENV is not 'test'.
 * All exports are safe to call unconditionally — they no-op when Sentry is not active.
 */

import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import logger from './logger.js';

const SENTRY_DSN = process.env.SENTRY_DSN;
const IS_TEST = process.env.NODE_ENV === 'test';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Redacts PII from a Sentry event before transmission (MINCRM-394).
 * - Removes POST body (request.data) to prevent credential/payload leakage
 * - Hashes user.email, user.username, user.name (SHA-256) so errors can be
 *   correlated to a specific user without exposing the raw value
 * - Removes all extra fields which may contain arbitrary app-level PII
 */
export function redactPiiFromEvent(event: ErrorEvent): ErrorEvent {
  const redacted = { ...event };

  if (redacted.request) {
    redacted.request = { ...redacted.request, data: undefined };
  }

  if (redacted.user) {
    const { email, username, name, ...safeUser } = redacted.user;
    redacted.user = {
      ...safeUser,
      ...(email !== undefined && { email: sha256Hex(email) }),
      ...(username !== undefined && { username: sha256Hex(username) }),
      ...(name !== undefined && { name: sha256Hex(name) }),
    };
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
