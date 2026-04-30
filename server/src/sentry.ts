/**
 * Sentry error tracking integration for the server (MINCRM-285).
 * Only initializes when SENTRY_DSN is set and NODE_ENV is not 'test'.
 * All exports are safe to call unconditionally — they no-op when Sentry is not active.
 */

import * as Sentry from '@sentry/node';
import logger from './logger.js';

const SENTRY_DSN = process.env.SENTRY_DSN;
const IS_TEST = process.env.NODE_ENV === 'test';

export function initSentry(): void {
  if (!SENTRY_DSN || IS_TEST) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
  });

  logger.info('Sentry error tracking initialized');
}

export function captureException(err: unknown): void {
  if (!SENTRY_DSN || IS_TEST) return;
  Sentry.captureException(err);
}
