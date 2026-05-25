/**
 * Sentry error tracking integration for the client (MINCRM-285).
 * Only initializes when VITE_SENTRY_DSN is set and the build is not a test run.
 * All exports are safe to call unconditionally — they no-op when Sentry is not active.
 */

import * as Sentry from '@sentry/react';
import type { ErrorEvent } from '@sentry/core';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const IS_TEST = import.meta.env.MODE === 'test';

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
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    beforeSend: redactPiiFromEvent,
  });
}

export function captureException(err: unknown): void {
  if (!SENTRY_DSN || IS_TEST) return;
  Sentry.captureException(err);
}
