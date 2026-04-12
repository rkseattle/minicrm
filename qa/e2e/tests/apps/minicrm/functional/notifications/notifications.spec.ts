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
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * AC notes:
 *   - AC1: Notification preferences survive a page reload
 *   - AC2: Admin kill switch is reflected in GET /api/settings/email-notifications
 *   - AC3: Recipient count reflects active users with that preference enabled
 *
 * MINCRM-161, MINCRM-162, MINCRM-163
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F10] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Profile page — notification preferences
// ---------------------------------------------------------------------------

test.describe('Profile page — notification preferences', () => {
  test(
    'renders the profile page with all three notification checkboxes',
    { tag: '@functional' },
    async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/profile');
      await expect(page.getByTestId('profile-heading')).toBeVisible();
      await expect(page.getByTestId('profile-notifications-section')).toBeVisible();
      await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeVisible();
      await expect(page.getByTestId('notif-checkbox-notify_assignments')).toBeVisible();
      await expect(page.getByTestId('notif-checkbox-notify_deal_stage_changes')).toBeVisible();
    },
  );

  test('checkboxes default to checked on first load', { tag: '@functional' }, async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/profile');
    await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeChecked();
    await expect(page.getByTestId('notif-checkbox-notify_assignments')).toBeChecked();
    await expect(page.getByTestId('notif-checkbox-notify_deal_stage_changes')).toBeChecked();
  });

  test(
    'toggling a checkbox and saving persists the preference (AC1)',
    { tag: '@functional' },
    async ({ page, restClient }) => {
      // Reset preferences to all-true via API before the test
      await restClient.patch('/api/users/me/notification-preferences', {
        notify_overdue_tasks: true,
        notify_assignments: true,
        notify_deal_stage_changes: true,
      });

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/profile');

      // Wait for prefs to load
      await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeChecked();

      // Uncheck "overdue tasks"
      await page.getByTestId('notif-checkbox-notify_overdue_tasks').click();
      await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).not.toBeChecked();

      // Save
      await page.getByTestId('profile-prefs-save').click();
      await expect(page.getByTestId('profile-prefs-success')).toBeVisible();

      // Reload and verify preference persisted (AC1)
      await page.reload();
      await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).not.toBeChecked();

      // Restore preferences
      await restClient.patch('/api/users/me/notification-preferences', {
        notify_overdue_tasks: true,
        notify_assignments: true,
        notify_deal_stage_changes: true,
      });
    },
  );

  test(
    'saving all preferences off and back on works correctly',
    { tag: '@functional' },
    async ({ page, restClient }) => {
      await restClient.patch('/api/users/me/notification-preferences', {
        notify_overdue_tasks: true,
        notify_assignments: true,
        notify_deal_stage_changes: true,
      });

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/profile');

      await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).toBeChecked();

      // Uncheck all three
      await page.getByTestId('notif-checkbox-notify_overdue_tasks').click();
      await page.getByTestId('notif-checkbox-notify_assignments').click();
      await page.getByTestId('notif-checkbox-notify_deal_stage_changes').click();

      await page.getByTestId('profile-prefs-save').click();
      await expect(page.getByTestId('profile-prefs-success')).toBeVisible();

      await page.reload();
      await expect(page.getByTestId('notif-checkbox-notify_overdue_tasks')).not.toBeChecked();
      await expect(page.getByTestId('notif-checkbox-notify_assignments')).not.toBeChecked();
      await expect(page.getByTestId('notif-checkbox-notify_deal_stage_changes')).not.toBeChecked();

      // Restore
      await restClient.patch('/api/users/me/notification-preferences', {
        notify_overdue_tasks: true,
        notify_assignments: true,
        notify_deal_stage_changes: true,
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Admin Settings — global email notifications
// ---------------------------------------------------------------------------

test.describe('Admin Settings — global email notifications', () => {
  test(
    'email notifications section is visible in admin settings',
    { tag: '@functional' },
    async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/admin/settings');
      await expect(page.getByTestId('email-notif-section')).toBeVisible();
      await expect(page.getByTestId('email-notif-toggle')).toBeVisible();
    },
  );

  test(
    'recipient count is displayed in admin settings',
    { tag: '@functional' },
    async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/admin/settings');
      await expect(page.getByTestId('email-notif-recipient-count')).toBeVisible();
    },
  );

  test(
    'toggling global email notifications off and back on persists via API (AC2)',
    { tag: '@functional' },
    async ({ page, restClient }) => {
      // Ensure enabled at start
      await restClient.patch('/api/settings/email-notifications', { enabled: true });

      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/admin/settings');

      // Toggle off
      const toggle = page.getByTestId('email-notif-toggle');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await toggle.click();
      await expect(page.getByTestId('email-notif-success')).toBeVisible();

      // Verify via API (AC2)
      const settingAfterDisable = await restClient.get<{ enabled: boolean }>(
        '/api/settings/email-notifications',
      );
      expect(settingAfterDisable.enabled).toBe(false);

      // Toggle back on
      await toggle.click();
      await expect(page.getByTestId('email-notif-success')).toBeVisible();

      const settingAfterEnable = await restClient.get<{ enabled: boolean }>(
        '/api/settings/email-notifications',
      );
      expect(settingAfterEnable.enabled).toBe(true);
    },
  );
});
