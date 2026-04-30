/**
 * Sentry error tracking integration for the client (MINCRM-285).
 * Only initializes when VITE_SENTRY_DSN is set and the build is not a test run.
 * All exports are safe to call unconditionally — they no-op when Sentry is not active.
 */

import * as Sentry from '@sentry/react';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const IS_TEST = import.meta.env.MODE === 'test';

export function initSentry(): void {
  if (!SENTRY_DSN || IS_TEST) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
  });
}

export function captureException(err: unknown): void {
  if (!SENTRY_DSN || IS_TEST) return;
  Sentry.captureException(err);
}
