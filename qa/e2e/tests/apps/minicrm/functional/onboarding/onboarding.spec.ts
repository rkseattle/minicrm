/**
 * F-OB — Onboarding banner (MINCRM-256)
 *
 * Verifies:
 *   OB1 — Banner is visible for admin when is_first_run is true
 *   OB2 — Banner is NOT visible when is_first_run is false
 *   OB3 — Dismiss (X) hides the banner and persists onboarding_completed=true
 *   OB4 — Step 1 → Step 2 progression via "Looks good" button
 *
 * Each test resets the onboarding flag via the API before running and restores
 * it to true (first-run) for the next test. The globalSetup marks onboarding
 * completed to suppress the banner for all other E2E tests; this spec overrides
 * that per-test via the admin restClient.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all interaction via page.locate / page.click
 *   - Tests start unauthenticated (storageState override) so login() controls session
 *
 * MINCRM-256
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { OnboardingPage } from '@pages/minicrm/OnboardingPage.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// Tests navigate to the UI login page, so they must not inherit the pre-auth
// admin storageState from globalSetup.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F-OB] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resets onboarding_completed to the given value via the admin API. */
async function setOnboardingCompleted(completed: boolean, restClient: RestClient): Promise<void> {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await restClient.put('/api/v1/settings/onboarding', { onboarding_completed: completed });
}

// ---------------------------------------------------------------------------
// Tests
//
// All four tests mutate the same system_settings row (onboarding_completed).
// Running them in parallel causes races where one test's setup overwrites
// another test's state mid-run. test.describe.serial forces sequential
// execution within this file while the rest of the suite stays parallel.
// ---------------------------------------------------------------------------

test.describe.serial('Onboarding banner (MINCRM-256)', () => {
  test('@functional F-OB1: banner is visible for admin when is_first_run is true', async ({
    page,
    restClient,
  }) => {
    await setOnboardingCompleted(false, restClient);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const banner = await page
      .locate([
        { type: 'testId', value: 'onboarding-banner' },
        { type: 'css', value: '[data-testid="onboarding-banner"]' },
      ])
      .resolve();
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test('@functional F-OB2: banner is NOT visible when is_first_run is false', async ({
    page,
    restClient,
  }) => {
    await setOnboardingCompleted(true, restClient);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    // Navigate explicitly to the dashboard and wait for its heading — this is
    // layout- and viewport-agnostic, and guarantees all queries have settled
    // before we assert the banner is absent.
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitFor([{ type: 'testId', value: 'dashboard-heading' }], 'visible', {}, 10_000);
    expect(await page.isNotVisible([{ type: 'testId', value: 'onboarding-banner' }])).toBe(true);
  });

  test('@functional F-OB3: dismiss (X) hides the banner and persists onboarding_completed=true', async ({
    page,
    restClient,
  }) => {
    await setOnboardingCompleted(false, restClient);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    const banner = await page
      .locate([
        { type: 'testId', value: 'onboarding-banner' },
        { type: 'css', value: '[data-testid="onboarding-banner"]' },
      ])
      .resolve();
    await expect(banner).toBeVisible({ timeout: 10_000 });

    const onboardingPage = new OnboardingPage({ page });
    await onboardingPage.dismiss();

    // Banner should disappear after dismiss.
    expect(await page.isNotVisible([{ type: 'testId', value: 'onboarding-banner' }])).toBe(true);

    // Verify persistence via API.
    const res = await restClient.get<{ is_first_run: boolean; onboarding_completed: boolean }>(
      '/api/v1/settings/onboarding',
    );
    expect(res.body.onboarding_completed).toBe(true);
    expect(res.body.is_first_run).toBe(false);
  });

  test('@functional F-OB4: step 1 advances to step 2 when "Looks good" is clicked', async ({
    page,
    restClient,
  }) => {
    await setOnboardingCompleted(false, restClient);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await expect(
      await page
        .locate([
          { type: 'testId', value: 'onboarding-step-1' },
          { type: 'css', value: '[data-testid="onboarding-step-1"]' },
        ])
        .resolve(),
    ).toBeVisible({ timeout: 10_000 });

    const onboardingPage2 = new OnboardingPage({ page });
    await onboardingPage2.clickLooksGood();

    await expect(
      await page
        .locate([
          { type: 'testId', value: 'onboarding-step-2' },
          { type: 'css', value: '[data-testid="onboarding-step-2"]' },
        ])
        .resolve(),
    ).toBeVisible({ timeout: 5_000 });
  });
}); // end describe.serial
