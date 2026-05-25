/**
 * Sentry error tracking integration for the client (MINCRM-285).
 * Only initializes when VITE_SENTRY_DSN is set and the build is not a test run.
 * All exports are safe to call unconditionally — they no-op when Sentry is not active.
 */

import * as Sentry from '@sentry/react';
import type { ErrorEvent } from '@sentry/core';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const IS_TEST = import.meta.env.MODE === 'test';

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Redacts PII from a Sentry event before transmission (MINCRM-394).
 * - Removes POST body (request.data) to prevent credential/payload leakage
 * - Hashes user.email, user.username, user.name (SHA-256) so errors can be
 *   correlated to a specific user without exposing the raw value
 * - Removes all extra fields which may contain arbitrary app-level PII
 */
export async function redactPiiFromEvent(event: ErrorEvent): Promise<ErrorEvent> {
  const redacted = { ...event };

  if (redacted.request) {
    redacted.request = { ...redacted.request, data: undefined };
  }

  if (redacted.user) {
    const { email, username, name, ...safeUser } = redacted.user;
    redacted.user = {
      ...safeUser,
      ...(email !== undefined && { email: await sha256Hex(email) }),
      ...(username !== undefined && { username: await sha256Hex(username) }),
      ...(name !== undefined && { name: await sha256Hex(name) }),
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
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    beforeSend: redactPiiFromEvent,
  });
}

export function captureException(err: unknown): void {
  if (!SENTRY_DSN || IS_TEST) return;
  Sentry.captureException(err);
}
