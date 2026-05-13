/**
 * Settings behaviors for MiniCRM — system-wide defaults enforcement.
 *
 * MINCRM-358
 */

import type { RestClient } from '@framework/clients/rest-client.js';

/**
 * Resets all mutable system settings to their known-good defaults in parallel.
 * Callers must ensure restClient is authenticated as admin.
 *
 * Each reset is fire-and-forget — individual failures are swallowed so that a
 * missing or misconfigured setting does not abort the entire reset sequence.
 * This makes the function safe to call in beforeEach/afterEach even in
 * environments where some settings have never been configured.
 *
 * @param restClient - Admin-authenticated RestClient.
 */
export async function ensureSystemDefaults(restClient: RestClient): Promise<void> {
  await Promise.all([
    restClient
      .patch('/api/v1/settings/default-language', { language: 'en' })
      .catch(() => undefined),
    restClient.patch('/api/v1/settings/nav-layout', { layout: 'top' }).catch(() => undefined),
    restClient
      .patch('/api/v1/settings/email-notifications', { enabled: true })
      .catch(() => undefined),
    restClient
      .patch('/api/v1/settings/tags-restrict-creation', { restricted: false })
      .catch(() => undefined),
    restClient
      .put('/api/v1/settings/currencies', { home_currency: 'USD', currencies: [] })
      .catch(() => undefined),
    restClient
      .put('/api/v1/settings/onboarding', { onboarding_completed: true })
      .catch(() => undefined),
    restClient.delete('/api/v1/settings/branding').catch(() => undefined),
  ]);
}
