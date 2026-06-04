/**
 * F-OB — Setup checklist widget (MINCRM-379, MINCRM-410)
 *
 * Verifies:
 *   OB1 — Widget is visible for admin when is_first_run is true
 *   OB2 — Widget is NOT visible when onboarding_completed is true
 *   OB3 — Dismiss (X) hides the widget and persists onboarding_completed=true
 *   OB4 — Widget collapses to pill when collapse chevron is clicked
 *   OB5 — Collapsed/expanded state persists across navigation
 *   OB6 — All five tasks are shown in the widget
 *   OB7 — Rep user sees four-task checklist when onboarding is incomplete (MINCRM-410)
 *   OB8 — Admin can reset another user's onboarding from the Users page (MINCRM-410)
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
 * MINCRM-379, MINCRM-410
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, loginAsAdmin, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  setOnboardingCompleted,
  getOnboardingStatus,
  resetUserOnboardingViaApi,
  resetPipelineStagesReviewed,
  getSetupChecklistWidgetLocator,
  dismissSetupChecklist,
  getSetupChecklistPillLocator,
  clickSetupChecklistCollapse,
  navigateToDashboardAndWait,
  waitForDashboardHeading,
  isSetupChecklistWidgetHidden,
  isSetupChecklistPillHidden,
  getSetupChecklistTaskListLocator,
} from '@behaviors/minicrm/setup.behaviors.js';
import {
  inviteUserViaApi,
  setUserPassword,
  deactivateUser,
  resetOnboardingViaUI,
} from '@behaviors/minicrm/users.behaviors.js';
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

test.describe.serial('Onboarding (MINCRM-379, MINCRM-410)', () => {
  test.setTimeout(60_000);

  test('@functional F-OB1: widget is visible for admin when is_first_run is true', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    // Restore true in finally so parallel workers never observe false on the
    // shared admin account after this test completes. (MINCRM-415)
    try {
      await setOnboardingCompleted(restClient, false);
      // Ensure pipeline_stages_reviewed is false so at least one admin task is
      // incomplete. If allDone=true the widget auto-dismisses after 3 s before we
      // can assert it's visible. This races with other workers that save pipeline
      // stages (setting the flag), so reset it here — not just in beforeEach. (MINCRM-410)
      await resetPipelineStagesReviewed(restClient);
      await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
      // Assert the widget is visible as soon as the page loads — do NOT wait for
      // dashboard-heading first. The widget is mounted immediately on render; if we
      // wait for the heading and allDone=true the 3 s auto-dismiss may have already
      // fired before we look. The 10 s timeout gives enough time for the initial
      // React render without extending past the auto-dismiss window. (MINCRM-410)
      const widget = await getSetupChecklistWidgetLocator({ page });
      await expect(widget).toBeVisible({ timeout: 10_000 });
    } finally {
      await loginAsAdmin(restClient);
      await setOnboardingCompleted(restClient, true);
    }
  });

  test('@functional F-OB2: widget is NOT visible when onboarding_completed is true', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await setOnboardingCompleted(restClient, true);
    await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

    await navigateToDashboardAndWait({ page });
    await waitForDashboardHeading({ page }, 10_000);
    expect(await isSetupChecklistWidgetHidden({ page })).toBe(true);
    expect(await isSetupChecklistPillHidden({ page })).toBe(true);
  });

  test('@functional F-OB3: dismiss (X) hides the widget and persists onboarding_completed=true', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    // Restore true in finally so parallel workers never observe false on the
    // shared admin account after this test completes. (MINCRM-415)
    try {
      await setOnboardingCompleted(restClient, false);
      await resetPipelineStagesReviewed(restClient);
      await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
      await page.waitForLoadState('networkidle');

      const widget = await getSetupChecklistWidgetLocator({ page });
      await expect(widget).toBeVisible({ timeout: 10_000 });

      await dismissSetupChecklist({ page });

      expect(await isSetupChecklistWidgetHidden({ page })).toBe(true);

      // Verify persistence via API
      const status = await getOnboardingStatus(restClient);
      expect(status.onboarding_completed).toBe(true);
      expect(status.is_first_run).toBe(false);
    } finally {
      await loginAsAdmin(restClient);
      await setOnboardingCompleted(restClient, true);
    }
  });

  test('@functional F-OB4: widget collapses to pill when collapse button is clicked', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    // Restore true in finally so parallel workers never observe false on the
    // shared admin account after this test completes. (MINCRM-415)
    try {
      await setOnboardingCompleted(restClient, false);
      await resetPipelineStagesReviewed(restClient);
      await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
      await page.waitForLoadState('networkidle');

      const widget = await getSetupChecklistWidgetLocator({ page });
      await expect(widget).toBeVisible({ timeout: 10_000 });

      await clickSetupChecklistCollapse({ page });

      const pill = await getSetupChecklistPillLocator({ page });
      await expect(pill).toBeVisible({ timeout: 5_000 });
      expect(await isSetupChecklistWidgetHidden({ page })).toBe(true);
    } finally {
      await loginAsAdmin(restClient);
      await setOnboardingCompleted(restClient, true);
    }
  });

  test('@functional F-OB5: task list shows five tasks', async ({ page, restClient }) => {
    await loginAsAdmin(restClient);
    // Restore true in finally so parallel workers never observe false on the
    // shared admin account after this test completes. (MINCRM-415)
    try {
      await setOnboardingCompleted(restClient, false);
      await resetPipelineStagesReviewed(restClient);
      await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
      await page.waitForLoadState('networkidle');

      await getSetupChecklistWidgetLocator({ page });

      const taskList = await getSetupChecklistTaskListLocator({ page });

      await expect(taskList).toBeVisible({ timeout: 10_000 });

      // Count li elements via innerHTML — SafeLocator.locator() is forbidden
      const html = await taskList.innerHTML();
      const liCount = (html.match(/<li/g) ?? []).length;
      expect(liCount).toBe(5);
    } finally {
      await loginAsAdmin(restClient);
      await setOnboardingCompleted(restClient, true);
    }
  });
  // ---------------------------------------------------------------------------
  // Per-user onboarding tests (MINCRM-410)
  // These tests create ephemeral rep users and clean up in finally blocks.
  // Kept inside the same describe.serial as the setup-checklist widget tests
  // to prevent cross-block races on the shared admin onboarding_completed flag.
  // ---------------------------------------------------------------------------

  test.setTimeout(90_000);

  test('@functional F-OB7: rep user sees four-task checklist when onboarding is incomplete', async ({
    page,
    restClient,
  }) => {
    await loginAsAdmin(restClient);

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const repEmail = `ob7-rep-${uniqueSuffix}@example.com`;
    const repPassword = 'Rep@ssw0rd!1';

    const { user, inviteToken } = await inviteUserViaApi(restClient, {
      name: `OB7 Rep ${uniqueSuffix}`,
      email: repEmail,
      role: 'rep',
    });

    try {
      await setUserPassword(restClient, inviteToken, repPassword);

      // Rep's onboarding_completed starts false by default — no API reset needed.
      await login({ email: repEmail, password: repPassword }, { page });

      const widget = await getSetupChecklistWidgetLocator({ page });
      await expect(widget).toBeVisible({ timeout: 10_000 });

      const taskList = await getSetupChecklistTaskListLocator({ page });

      await expect(taskList).toBeVisible({ timeout: 10_000 });

      // Count li elements via innerHTML — SafeLocator.locator() is forbidden
      const html = await taskList.innerHTML();
      const liCount = (html.match(/<li/g) ?? []).length;
      expect(liCount, 'rep checklist should show exactly four tasks').toBe(4);
    } finally {
      await deactivateUser(restClient, user.id);
    }
  });

  test("@functional F-OB8: admin resets another user's onboarding from the Users page", async ({
    page,
    restClient,
  }) => {
    test.setTimeout(120_000); // browser login + pagination + UI reset + API verify
    await loginAsAdmin(restClient);

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const repEmail = `ob8-rep-${uniqueSuffix}@example.com`;
    const repPassword = 'Rep@ssw0rd!1';

    const { user, inviteToken } = await inviteUserViaApi(restClient, {
      name: `OB8 Rep ${uniqueSuffix}`,
      email: repEmail,
      role: 'rep',
    });

    try {
      await setUserPassword(restClient, inviteToken, repPassword);

      // Mark this rep's onboarding as completed so we have something to reset.
      await loginAs(restClient, repEmail, repPassword);
      await setOnboardingCompleted(restClient, true);

      // Verify it is completed before reset.
      const before = await getOnboardingStatus(restClient);
      expect(before.onboarding_completed, 'onboarding should be completed before reset').toBe(true);

      // Switch back to admin for both the REST client and the browser session.
      // test.use({ storageState: { cookies: [], origins: [] } }) at the top of this
      // file clears the pre-auth storageState, so the page fixture is unauthenticated.
      // We must log in via the browser before navigating to /users. (MINCRM-410)
      await loginAsAdmin(restClient);
      await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

      const result = await resetOnboardingViaUI(user.id, { page });
      expect(result.successToastVisible, 'success toast should appear after reset').toBe(true);

      // Verify the flag was actually cleared via API.
      await loginAs(restClient, repEmail, repPassword);
      const after = await getOnboardingStatus(restClient);
      expect(after.onboarding_completed, 'onboarding_completed should be false after reset').toBe(
        false,
      );
    } finally {
      await loginAsAdmin(restClient);
      await deactivateUser(restClient, user.id);
    }
  });

  test('@functional F-OB9: admin reset via API clears the onboarding flag', async ({
    restClient,
  }) => {
    await loginAsAdmin(restClient);

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const repEmail = `ob9-rep-${uniqueSuffix}@example.com`;
    const repPassword = 'Rep@ssw0rd!1';

    const { user, inviteToken } = await inviteUserViaApi(restClient, {
      name: `OB9 Rep ${uniqueSuffix}`,
      email: repEmail,
      role: 'rep',
    });

    try {
      await setUserPassword(restClient, inviteToken, repPassword);

      // Mark completed as the rep.
      await loginAs(restClient, repEmail, repPassword);
      await setOnboardingCompleted(restClient, true);
      const before = await getOnboardingStatus(restClient);
      expect(before.onboarding_completed).toBe(true);

      // Admin resets via API.
      await loginAsAdmin(restClient);
      await resetUserOnboardingViaApi(restClient, user.id);

      // Verify cleared.
      await loginAs(restClient, repEmail, repPassword);
      const after = await getOnboardingStatus(restClient);
      expect(after.onboarding_completed, 'flag should be false after admin API reset').toBe(false);
    } finally {
      await loginAsAdmin(restClient);
      await deactivateUser(restClient, user.id);
    }
  });
}); // end describe.serial — onboarding (MINCRM-379, MINCRM-410)
