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
import { login, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { setOnboardingCompleted, getOnboardingStatus } from '@behaviors/minicrm/setup.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';
import { OnboardingPage } from '@pages/minicrm/OnboardingPage.js';

// Tests navigate to the UI login page, so they must not inherit the pre-auth
// admin storageState from globalSetup.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Known-good system state before each test (MINCRM-358)
//
// Resets all mutable system settings to defaults before each test so a prior
// test's failed teardown cannot contaminate this one. Individual tests still
// call setOnboardingCompleted(restClient, false) explicitly to exercise the
// first-run state — that per-test call overrides the default set here.
//
// No afterEach: the per-test loginAsAdmin + setOnboardingCompleted calls
// already own teardown, and adding an afterEach creates a timing race where
// the server is mid-reset when login() returns and the banner query fires.
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
});

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F-OB] E2E_ADMIN_PASSWORD is not set');

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
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    // Wait for all initial queries (including getOnboardingStatus) to settle
    // before probing for the banner. OnboardingBanner renders null until the
    // query resolves, so without this the probe races against network latency.
    await page.waitForLoadState('networkidle');

    const onboardingPage = new OnboardingPage({ page });
    const banner = await onboardingPage.bannerLocator();
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test('@functional F-OB2: banner is NOT visible when is_first_run is false', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, true);
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
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');

    const onboardingPage = new OnboardingPage({ page });
    const banner = await onboardingPage.bannerLocator();
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await onboardingPage.dismiss();

    // Banner should disappear after dismiss.
    expect(await page.isNotVisible([{ type: 'testId', value: 'onboarding-banner' }])).toBe(true);

    // Verify persistence via API.
    const status = await getOnboardingStatus(restClient);
    expect(status.onboarding_completed).toBe(true);
    expect(status.is_first_run).toBe(false);
  });

  test('@functional F-OB4: step 1 advances to step 2 when "Looks good" is clicked', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');

    const onboardingPage = new OnboardingPage({ page });
    // Wait for the banner to appear before resolving step1 — the step-1 panel
    // is only mounted after the banner's initial API fetch completes.
    const banner = await onboardingPage.bannerLocator();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const step1 = await onboardingPage.step1Locator();
    await expect(step1).toBeVisible({ timeout: 10_000 });

    await onboardingPage.clickLooksGood();

    const step2 = await onboardingPage.step2Locator();
    await expect(step2).toBeVisible({ timeout: 5_000 });
  });
}); // end describe.serial
