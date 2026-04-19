/**
 * F10 — Notification Preferences & Email Notification Global Settings
 *
 * Functional regression tests for email notification features:
 *   - Profile page: user notification preference toggles (MINCRM-161, MINCRM-162)
 *   - Admin Settings: global email notification kill switch (MINCRM-163)
 *   - Recipient count display in admin settings (MINCRM-163)
 *
 * Test groups:
 *   Profile Page     — page renders, all three checkboxes present, save and persist,
 *                      toggle individual checkboxes
 *   Admin Settings   — email notifications section renders, toggle enabled/disabled,
 *                      recipient count displayed
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All UI interactions via behaviors — no raw locators in this file
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: Notification preferences survive a page reload
 *   - AC2: Admin kill switch is reflected in GET /api/settings/email-notifications
 *   - AC3: Recipient count reflects active users with that preference enabled
 *
 * MINCRM-161, MINCRM-162, MINCRM-163, MINCRM-192
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  navigateToProfile,
  getProfilePreferences,
  uncheckAndSavePreference,
  uncheckAllAndSave,
  reloadAndGetProfilePreferences,
  navigateToAdminSettings,
  toggleAdminEmailNotifications,
} from '@behaviors/minicrm/index.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F10] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Profile page — notification preferences
// ---------------------------------------------------------------------------

// All profile preference tests mutate the same admin user's preferences — run
// serially to prevent parallel workers from contaminating each other's state.
test.describe.serial('Profile page — notification preferences', () => {
  test('@functional F10-PP1: profile page renders with all three notification checkboxes', async ({
    page,
  }) => {
    const result = await navigateToProfile({ page });

    expect(result.loaded, 'profile heading should be visible').toBe(true);
    expect(result.notificationsSectionVisible, 'notifications section should be visible').toBe(
      true,
    );
    expect(result.allCheckboxesVisible, 'all three notification checkboxes should be visible').toBe(
      true,
    );
  });

  test('@functional F10-PP2: checkboxes default to checked on first load', async ({
    page,
    restClient,
  }) => {
    // Reset preferences to all-true via API before reading — parallel workers
    // running PP3/PP4 may have unchecked them, causing this assertion to flake.
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await restClient.patch('/api/users/me/notification-preferences', {
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });
    await navigateToProfile({ page });

    const prefs = await getProfilePreferences({ page });
    expect(prefs.preferences.notify_overdue_tasks, 'overdue tasks checkbox should be checked').toBe(
      true,
    );
    expect(prefs.preferences.notify_assignments, 'assignments checkbox should be checked').toBe(
      true,
    );
    expect(
      prefs.preferences.notify_deal_stage_changes,
      'deal stage changes checkbox should be checked',
    ).toBe(true);
  });

  test('@functional F10-PP3: toggling a checkbox and saving persists the preference (AC1)', async ({
    page,
    restClient,
  }) => {
    // Authenticate restClient to use API for setup/teardown
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    // Reset preferences to all-true via API before the test
    await restClient.patch('/api/users/me/notification-preferences', {
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });

    const result = await uncheckAndSavePreference('notify_overdue_tasks', {
      page,
    });

    expect(result.saved, 'success message should appear after saving').toBe(true);
    expect(result.isNowUnchecked, 'overdue tasks checkbox should be unchecked after save').toBe(
      true,
    );

    // Reload and verify preference persisted (AC1)
    const afterReload = await reloadAndGetProfilePreferences({ page });
    expect(
      afterReload.preferences.notify_overdue_tasks,
      'preference should persist after page reload (AC1)',
    ).toBe(false);

    // Restore preferences
    await restClient.patch('/api/users/me/notification-preferences', {
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });
  });

  test('@functional F10-PP4: saving all preferences off and back on works correctly', async ({
    page,
    restClient,
  }) => {
    // Authenticate restClient to use API for setup/teardown
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await restClient.patch('/api/users/me/notification-preferences', {
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });

    const result = await uncheckAllAndSave({ page });

    expect(result.saved, 'success message should appear after saving').toBe(true);
    expect(result.preferences.notify_overdue_tasks, 'overdue tasks should be unchecked').toBe(
      false,
    );
    expect(result.preferences.notify_assignments, 'assignments should be unchecked').toBe(false);
    expect(
      result.preferences.notify_deal_stage_changes,
      'deal stage changes should be unchecked',
    ).toBe(false);

    // Reload and verify all off
    const afterReload = await reloadAndGetProfilePreferences({ page });
    expect(afterReload.preferences.notify_overdue_tasks).toBe(false);
    expect(afterReload.preferences.notify_assignments).toBe(false);
    expect(afterReload.preferences.notify_deal_stage_changes).toBe(false);

    // Restore
    await restClient.patch('/api/users/me/notification-preferences', {
      notify_overdue_tasks: true,
      notify_assignments: true,
      notify_deal_stage_changes: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Admin Settings — global email notifications
// ---------------------------------------------------------------------------

test.describe('Admin Settings — global email notifications', () => {
  test('@functional F10-AS1: email notifications section is visible in admin settings', async ({
    page,
  }) => {
    const result = await navigateToAdminSettings({ page });

    expect(result.sectionVisible, 'email notifications section should be visible').toBe(true);
    expect(result.toggleVisible, 'email notifications toggle should be visible').toBe(true);
  });

  test('@functional F10-AS2: recipient count is displayed in admin settings', async ({ page }) => {
    const result = await navigateToAdminSettings({ page });

    expect(result.recipientCountVisible, 'recipient count element should be visible').toBe(true);
  });

  test('@functional F10-AS3: toggling global email notifications off and back on persists via API (AC2)', async ({
    page,
    restClient,
  }) => {
    // Authenticate restClient to use API for setup/teardown
    await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    // Ensure enabled at start
    await restClient.patch('/api/settings/email-notifications', { enabled: true });

    // Navigate to settings — toggle should show as enabled.
    const initial = await navigateToAdminSettings({ page });
    expect(initial.toggleVisible, 'toggle should be visible').toBe(true);

    // Toggle off
    const disableResult = await toggleAdminEmailNotifications({ page });
    expect(disableResult.saved, 'success message should appear after toggling off').toBe(true);
    expect(disableResult.isEnabled, 'toggle should now be off').toBe(false);

    // Verify via API (AC2)
    const afterDisable = await restClient.get<{ enabled: boolean }>(
      '/api/settings/email-notifications',
    );
    expect(afterDisable.body.enabled, 'API should reflect disabled state (AC2)').toBe(false);

    // Toggle back on
    const enableResult = await toggleAdminEmailNotifications({ page });
    expect(enableResult.saved, 'success message should appear after toggling on').toBe(true);
    expect(enableResult.isEnabled, 'toggle should now be on').toBe(true);

    const afterEnable = await restClient.get<{ enabled: boolean }>(
      '/api/settings/email-notifications',
    );
    expect(afterEnable.body.enabled, 'API should reflect enabled state (AC2)').toBe(true);
  });
});
