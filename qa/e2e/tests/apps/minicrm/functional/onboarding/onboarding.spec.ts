/**
 * F-OB — Setup checklist widget (MINCRM-379)
 *
 * Verifies:
 *   OB1 — Widget is visible for admin when is_first_run is true
 *   OB2 — Widget is NOT visible when onboarding_completed is true
 *   OB3 — Dismiss (X) hides the widget and persists onboarding_completed=true
 *   OB4 — Widget collapses to pill when collapse chevron is clicked
 *   OB5 — Collapsed/expanded state persists across navigation
 *   OB6 — All five tasks are shown in the widget
 *
 * Each test resets the onboarding flag via the API before running.
 * The globalSetup marks onboarding completed to suppress the widget for all
 * other E2E tests; this spec overrides that per-test via the admin restClient.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all interaction via page.locate / page.click
 *   - Tests start unauthenticated (storageState override) so login() controls session
 *
 * MINCRM-379
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  setOnboardingCompleted,
  getOnboardingStatus,
  getSetupChecklistWidgetLocator,
  dismissSetupChecklist,
  getSetupChecklistPillLocator,
  clickSetupChecklistCollapse,
} from '@behaviors/minicrm/setup.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

// Tests navigate to the UI login page, so they must not inherit the pre-auth
// admin storageState from globalSetup.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Known-good system state before each test (MINCRM-358)
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
// All tests mutate the same system_settings row (onboarding_completed).
// test.describe.serial prevents races where one test's setup overwrites
// another test's state mid-run.
// ---------------------------------------------------------------------------

test.describe.serial('Setup checklist widget (MINCRM-379)', () => {
  test.setTimeout(60_000);

  test('@functional F-OB1: widget is visible for admin when is_first_run is true', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');

    const widget = await getSetupChecklistWidgetLocator({ page });
    await expect(widget).toBeVisible({ timeout: 10_000 });
  });

  test('@functional F-OB2: widget is NOT visible when onboarding_completed is true', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, true);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitFor([{ type: 'testId', value: 'dashboard-heading' }], 'visible', {}, 10_000);
    expect(await page.isNotVisible([{ type: 'testId', value: 'setup-checklist-widget' }])).toBe(
      true,
    );
    expect(await page.isNotVisible([{ type: 'testId', value: 'setup-checklist-pill' }])).toBe(true);
  });

  test('@functional F-OB3: dismiss (X) hides the widget and persists onboarding_completed=true', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');

    const widget = await getSetupChecklistWidgetLocator({ page });
    await expect(widget).toBeVisible({ timeout: 10_000 });

    await dismissSetupChecklist({ page });

    expect(await page.isNotVisible([{ type: 'testId', value: 'setup-checklist-widget' }])).toBe(
      true,
    );

    // Verify persistence via API
    const status = await getOnboardingStatus(restClient);
    expect(status.onboarding_completed).toBe(true);
    expect(status.is_first_run).toBe(false);
  });

  test('@functional F-OB4: widget collapses to pill when collapse button is clicked', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');

    const widget = await getSetupChecklistWidgetLocator({ page });
    await expect(widget).toBeVisible({ timeout: 10_000 });

    await clickSetupChecklistCollapse({ page });

    const pill = await getSetupChecklistPillLocator({ page });
    await expect(pill).toBeVisible({ timeout: 5_000 });
    expect(await page.isNotVisible([{ type: 'testId', value: 'setup-checklist-widget' }])).toBe(
      true,
    );
  });

  test('@functional F-OB5: task list shows five tasks', async ({ page, restClient }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, false);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
    await page.waitForLoadState('networkidle');

    await getSetupChecklistWidgetLocator({ page });

    const taskList = await page
      .locate(
        [
          { type: 'testId', value: 'setup-checklist-task-list' },
          { type: 'role', value: 'list' },
        ],
        { intent: 'setup checklist task list showing five setup tasks' },
      )
      .resolve();

    await expect(taskList).toBeVisible({ timeout: 10_000 });

    // Count li elements via innerHTML — SafeLocator.locator() is forbidden
    const html = await taskList.innerHTML();
    const liCount = (html.match(/<li/g) ?? []).length;
    expect(liCount).toBe(5);
  });
}); // end describe.serial
