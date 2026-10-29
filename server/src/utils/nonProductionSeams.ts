/**
 * Environment variables that point the server at fake mail providers for E2E.
 *
 * Each one widens what the server will dial or switches off a job, so each is honored
 * only where isAuthBypassEnv() holds, and boot refuses any other process that sets one.
 * Ignoring them there silently would leave an operator believing a copied .env worked.
 */

import { isAuthBypassEnv } from './nodeEnv.js';

/** Every seam, so the boot check and the readers cannot disagree about what one is. */
export const NON_PRODUCTION_SEAM_KEYS = [
  'SSRF_ALLOWED_PRIVATE_HOSTS',
  'GMAIL_API_BASE_URL',
  'GRAPH_API_BASE_URL',
  'EMAIL_SYNC_SCHEDULER',
] as const;

export type NonProductionSeamKey = (typeof NON_PRODUCTION_SEAM_KEYS)[number];

const URL_SEAM_KEYS: ReadonlySet<NonProductionSeamKey> = new Set([
  'GMAIL_API_BASE_URL',
  'GRAPH_API_BASE_URL',
]);

/** The values EMAIL_SYNC_SCHEDULER accepts; `off` leaves the email sync job unscheduled. */
export const EMAIL_SYNC_SCHEDULER_VALUES = ['on', 'off'] as const;

function rawSeam(key: NonProductionSeamKey): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

/**
 * A seam's value, or undefined when it is unset or this environment does not honor seams.
 *
 * @param key - The seam to read.
 */
export function nonProductionSeam(key: NonProductionSeamKey): string | undefined {
  return isAuthBypassEnv() ? rawSeam(key) : undefined;
}

function urlProblem(key: NonProductionSeamKey, value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${key} is not a valid URL: ${value}`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `${key} must be an http or https URL: ${value}`;
  }
  if (parsed.search || parsed.hash) {
    return `${key} must not carry a query or fragment, since paths are appended to it: ${value}`;
  }
  if (value.endsWith('/')) {
    return `${key} must not end with a slash, since paths are appended to it: ${value}`;
  }
  return null;
}

/**
 * Why the seams in this environment cannot be honored, or null when boot may continue.
 *
 * @returns An operator-facing message naming every offending key, or null.
 */
export function nonProductionSeamProblem(): string | null {
  const set = NON_PRODUCTION_SEAM_KEYS.filter((key) => rawSeam(key) !== undefined);
  if (set.length === 0) return null;

  if (!isAuthBypassEnv()) {
    return (
      `${set.join(', ')} ${set.length === 1 ? 'is' : 'are'} set, but NODE_ENV is ` +
      `'${process.env.NODE_ENV ?? ''}'. These point the server at fake mail providers ` +
      'and are honored only under development or test. Unset them before starting.'
    );
  }

  const problems: string[] = [];
  for (const key of set) {
    const value = rawSeam(key) ?? '';
    if (URL_SEAM_KEYS.has(key)) {
      const problem = urlProblem(key, value);
      if (problem) problems.push(problem);
    }
  }
  const scheduler = rawSeam('EMAIL_SYNC_SCHEDULER');
  if (
    scheduler !== undefined &&
    // Widened for includes(); the narrower tuple type is exactly what is being tested.
    !(EMAIL_SYNC_SCHEDULER_VALUES as readonly string[]).includes(scheduler)
  ) {
    problems.push(
      `EMAIL_SYNC_SCHEDULER must be one of ${EMAIL_SYNC_SCHEDULER_VALUES.join(', ')}: ${scheduler}`,
    );
  }
  return problems.length > 0 ? problems.join('; ') : null;
}
