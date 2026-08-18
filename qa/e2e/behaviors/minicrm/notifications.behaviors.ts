/**
 * Notifications behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 *
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { ProfilePage } from '@pages/minicrm/ProfilePage.js';
import { AdminSettingsPage } from '@pages/minicrm/AdminSettingsPage.js';
import type { NotificationPreferenceKey } from '@pages/minicrm/ProfilePage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by notifications behaviors. */
export interface NotificationsBehaviorContext {
  page: PageFacade;
}

// Re-export for convenience.
export type { NotificationPreferenceKey };

// ---------------------------------------------------------------------------
// navigateToProfile()
// ---------------------------------------------------------------------------

/** Result returned by navigateToProfile. */
export interface NavigateToProfileResult {
  /** True when the profile page heading is visible. */
  loaded: boolean;
  /** True when the notifications section is visible. */
  notificationsSectionVisible: boolean;
  /** True when all three preference checkboxes are visible. */
  allCheckboxesVisible: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the profile page and verifies all notification preference
 * elements are present.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToProfileResult.
 */
export async function navigateToProfile(
  context: NotificationsBehaviorContext,
): Promise<NavigateToProfileResult> {
  const profilePage = new ProfilePage(context);
  await profilePage.navigate();

  const loaded = await profilePage.isLoaded();
  const notificationsSectionVisible = await profilePage.notificationsSectionIsVisible();
  const overdueVisible = await profilePage.checkboxIsVisible('notify_overdue_tasks');
  const assignmentsVisible = await profilePage.checkboxIsVisible('notify_assignments');
  const dealStagesVisible = await profilePage.checkboxIsVisible('notify_deal_stage_changes');
  const allCheckboxesVisible = overdueVisible && assignmentsVisible && dealStagesVisible;
  const finalUrl = profilePage.url();

  return { loaded, notificationsSectionVisible, allCheckboxesVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// getProfilePreferences()
// ---------------------------------------------------------------------------

/** The checked state of all three notification preference checkboxes. */
export interface ProfilePreferences {
  notify_overdue_tasks: boolean;
  notify_assignments: boolean;
  notify_deal_stage_changes: boolean;
}

/** Result returned by getProfilePreferences. */
export interface GetProfilePreferencesResult {
  /** Current checked state of all three checkboxes. */
  preferences: ProfilePreferences;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the profile page and reads the current state of all three
 * notification preference checkboxes.
 *
 * @param context - Playwright fixture context.
 * @returns GetProfilePreferencesResult.
 */
export async function getProfilePreferences(
  context: NotificationsBehaviorContext,
): Promise<GetProfilePreferencesResult> {
  const profilePage = new ProfilePage(context);
  await profilePage.navigate();

  const preferences: ProfilePreferences = {
    notify_overdue_tasks: await profilePage.checkboxIsChecked('notify_overdue_tasks'),
    notify_assignments: await profilePage.checkboxIsChecked('notify_assignments'),
    notify_deal_stage_changes: await profilePage.checkboxIsChecked('notify_deal_stage_changes'),
  };

  return { preferences, finalUrl: profilePage.url() };
}

// ---------------------------------------------------------------------------
// toggleAndSavePreference()
// ---------------------------------------------------------------------------

/** Result returned by toggleAndSavePreference. */
export interface ToggleAndSavePreferenceResult {
  /** True when the save success message appeared. */
  saved: boolean;
  /** True when the preference is unchecked after toggling (was previously checked). */
  isNowUnchecked: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the profile page, unchecks the specified preference,
 * saves, and returns the outcome.
 *
 * @param key - Notification preference key to uncheck.
 * @param context - Playwright fixture context.
 * @returns ToggleAndSavePreferenceResult.
 */
export async function uncheckAndSavePreference(
  key: NotificationPreferenceKey,
  context: NotificationsBehaviorContext,
): Promise<ToggleAndSavePreferenceResult> {
  const profilePage = new ProfilePage(context);
  await profilePage.navigate();

  await profilePage.uncheckPreference(key);
  await profilePage.savePreferences();

  await profilePage.waitForSuccessVisible();

  const saved = await profilePage.successMessageIsVisible();
  const isNowUnchecked = !(await profilePage.checkboxIsChecked(key));
  const finalUrl = profilePage.url();

  return { saved, isNowUnchecked, finalUrl };
}

// ---------------------------------------------------------------------------
// uncheckAllAndSave()
// ---------------------------------------------------------------------------

/** Result returned by uncheckAllAndSave. */
export interface UncheckAllAndSaveResult {
  /** True when the save success message appeared. */
  saved: boolean;
  /** The preference state after saving. */
  preferences: ProfilePreferences;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the profile page, unchecks all three notification preferences,
 * saves, and returns the outcome.
 *
 * @param context - Playwright fixture context.
 * @returns UncheckAllAndSaveResult.
 */
export async function uncheckAllAndSave(
  context: NotificationsBehaviorContext,
): Promise<UncheckAllAndSaveResult> {
  const profilePage = new ProfilePage(context);
  await profilePage.navigate();

  await profilePage.uncheckPreference('notify_overdue_tasks');
  await profilePage.uncheckPreference('notify_assignments');
  await profilePage.uncheckPreference('notify_deal_stage_changes');

  await profilePage.savePreferences();

  await profilePage.waitForSuccessVisible();

  const saved = await profilePage.successMessageIsVisible();
  const preferences: ProfilePreferences = {
    notify_overdue_tasks: await profilePage.checkboxIsChecked('notify_overdue_tasks'),
    notify_assignments: await profilePage.checkboxIsChecked('notify_assignments'),
    notify_deal_stage_changes: await profilePage.checkboxIsChecked('notify_deal_stage_changes'),
  };
  const finalUrl = profilePage.url();

  return { saved, preferences, finalUrl };
}

// ---------------------------------------------------------------------------
// reloadAndGetProfilePreferences()
// ---------------------------------------------------------------------------

/**
 * Reloads the profile page and reads the current preference state.
 * Used to verify persistence after saving.
 *
 * @param context - Playwright fixture context.
 * @returns GetProfilePreferencesResult.
 */
export async function reloadAndGetProfilePreferences(
  context: NotificationsBehaviorContext,
): Promise<GetProfilePreferencesResult> {
  await context.page.reload();
  await context.page.waitForLoadState('networkidle');

  const profilePage = new ProfilePage(context);
  const preferences: ProfilePreferences = {
    notify_overdue_tasks: await profilePage.checkboxIsChecked('notify_overdue_tasks'),
    notify_assignments: await profilePage.checkboxIsChecked('notify_assignments'),
    notify_deal_stage_changes: await profilePage.checkboxIsChecked('notify_deal_stage_changes'),
  };

  return { preferences, finalUrl: profilePage.url() };
}

// ---------------------------------------------------------------------------
// navigateToAdminSettings()
// ---------------------------------------------------------------------------

/** Result returned by navigateToAdminSettings. */
export interface NavigateToAdminSettingsResult {
  /** True when the email notifications section is visible. */
  sectionVisible: boolean;
  /** True when the toggle is visible. */
  toggleVisible: boolean;
  /** True when the recipient count element is visible. */
  recipientCountVisible: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the admin settings page and checks that the email notifications
 * section elements are present.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToAdminSettingsResult.
 */
export async function navigateToAdminSettings(
  context: NotificationsBehaviorContext,
): Promise<NavigateToAdminSettingsResult> {
  const adminSettings = new AdminSettingsPage(context);
  await adminSettings.navigate('notifications');

  const sectionVisible = await adminSettings.emailNotificationsSectionIsVisible();
  const toggleVisible = await adminSettings.emailNotificationsToggleIsVisible();
  const recipientCountVisible = await adminSettings.recipientCountIsVisible();
  const finalUrl = adminSettings.url();

  return { sectionVisible, toggleVisible, recipientCountVisible, finalUrl };
}

// ---------------------------------------------------------------------------
// toggleAdminEmailNotifications()
// ---------------------------------------------------------------------------

/** Result returned by toggleAdminEmailNotifications. */
export interface ToggleAdminEmailNotificationsResult {
  /** True when the success message appeared after toggling. */
  saved: boolean;
  /** The current enabled state of email notifications after the toggle. */
  isEnabled: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to admin settings and toggles the global email notifications switch.
 *
 * @param context - Playwright fixture context.
 * @returns ToggleAdminEmailNotificationsResult.
 */
export async function toggleAdminEmailNotifications(
  context: NotificationsBehaviorContext,
): Promise<ToggleAdminEmailNotificationsResult> {
  const adminSettings = new AdminSettingsPage(context);
  await adminSettings.navigate('notifications');

  // Register the response listener before clicking so the PATCH is always
  // captured — avoids the race where the mutation fires before waitForResponse
  // is registered if the toggle click resolves synchronously.
  const patchDone = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/settings/email-notifications') &&
      response.request().method() === 'PATCH' &&
      response.status() === 200,
  );
  await adminSettings.toggleEmailNotifications();
  await patchDone;

  // Wait for the success message — it is set in React's onSuccess callback,
  // which fires after invalidateQueries. This confirms the UI has processed
  // the mutation before the caller reads isEnabled or queries the API.
  await adminSettings.waitForEmailNotifSuccessVisible();

  const saved = await adminSettings.successMessageIsVisible();
  const isEnabled = await adminSettings.emailNotificationsIsEnabled();
  const finalUrl = adminSettings.url();

  return { saved, isEnabled, finalUrl };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers
// ---------------------------------------------------------------------------

/** Notification preference payload for PATCH /api/v1/users/me/notification-preferences. */
export interface NotificationPreferences {
  notify_overdue_tasks?: boolean;
  notify_assignments?: boolean;
  notify_deal_stage_changes?: boolean;
}

/**
 * Patches the current user's notification preferences via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param prefs - Preference fields to update.
 */
export async function patchNotificationPreferences(
  restClient: RestClient,
  prefs: NotificationPreferences,
): Promise<void> {
  await restClient.patch('/api/v1/users/me/notification-preferences', prefs);
}

/**
 * Fetches the current global email-notifications enabled state from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @returns True when email notifications are enabled globally.
 */
export async function getEmailNotificationsEnabled(restClient: RestClient): Promise<boolean> {
  const res = await restClient.get<{ enabled: boolean }>('/api/v1/settings/email-notifications');
  return res.body.enabled;
}

/**
 * Sets the global email-notifications enabled state via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param enabled - New enabled state.
 */
export async function setEmailNotificationsEnabled(
  restClient: RestClient,
  enabled: boolean,
): Promise<void> {
  await restClient.patch('/api/v1/settings/email-notifications', { enabled });
}
