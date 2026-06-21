/**
 * F-FF — Feature Flag Registry (MINCRM-463, MINCRM-477)
 *
 * Functional regression tests for the admin feature flag management UI,
 * API gate enforcement, and client-side flag isolation via withFlags().
 *
 * Test groups:
 *   F-FF1 — Admin views the feature flags page
 *   F-FF2 — Admin toggles a flag off and sees the confirmation dialog
 *   F-FF3 — Flag toggle writes an audit log entry
 *   F-FF4 — Disabled feature flag returns 403 on the guarded API route
 *   F-FF5 — withFlags() hides a nav link when its flag is intercepted as off
 *   F-FF6 — withFlags() shows a nav link when its flag is intercepted as on
 *   F-FF7 — AI tab is disabled when ai_features flag is intercepted as off
 *   F-FF8 — AI tab is enabled when ai_features flag is intercepted as on
 *   F-FF9 — Toggling ai_features off disables the AI tab without a page refresh
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviors imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *     (MINCRM-477) — never via PATCH /api/admin/feature-flags/:key in UI tests
 *   - Test data cleaned up via TestDataManager + direct REST resets
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  getFeatureFlagsListLocator,
  getFeatureFlagToggleLocator,
  getFeatureFlagConfirmDialogLocator,
  getFeatureFlagConfirmOkLocator,
  getAdminSettingsAiTabLocator,
} from '@behaviors/minicrm/settings.behaviors.js';
import { listFeatureFlags, updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';
import { getAuditLog } from '@behaviors/minicrm/audit-log.behaviors.js';
import { isNavLinkHidden, assertNavLinkIsVisible } from '@behaviors/minicrm/nav.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test.afterEach(async ({ restClient }) => {
  // Restore any flags that tests may have toggled.
  await updateFeatureFlag(restClient, 'notes', { enabled: true }).catch(() => {});
  await updateFeatureFlag(restClient, 'tags', { enabled: true }).catch(() => {});
  await updateFeatureFlag(restClient, 'ai_features', { enabled: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// F-FF1 — Admin views the feature flags page
// ---------------------------------------------------------------------------

test('@functional F-FF1: admin can navigate to the Features tab and see the flag list', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'flags');

  const list = await getFeatureFlagsListLocator({ page });
  await expect(list).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// F-FF2 — Admin toggles a flag off via the confirmation dialog
// ---------------------------------------------------------------------------

test('@functional @serial F-FF2: admin can disable a flag via the confirmation dialog', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Ensure the notes flag starts enabled.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'notes', { enabled: true });

  await navigateToAdminSettings({ page }, 'flags');

  const list = await getFeatureFlagsListLocator({ page });
  await expect(list).toBeVisible({ timeout: 10_000 });

  // notes flag should be enabled
  const notesToggle = await getFeatureFlagToggleLocator('notes', { page });
  await expect(notesToggle).toHaveAttribute('aria-checked', 'true');

  // Click the toggle to trigger the confirmation dialog
  await notesToggle.click();

  const confirmDialog = await getFeatureFlagConfirmDialogLocator({ page });
  await expect(confirmDialog).toBeVisible({ timeout: 5_000 });

  // Confirm the disable
  const confirmOk = await getFeatureFlagConfirmOkLocator({ page });
  await confirmOk.click();

  // Dialog should close after confirmation
  await expect(confirmDialog).not.toBeVisible({ timeout: 5_000 });

  // The toggle should now reflect disabled state
  const refreshedToggle = await getFeatureFlagToggleLocator('notes', { page });
  await expect(refreshedToggle).toHaveAttribute('aria-checked', 'false', { timeout: 5_000 });

  // REST API should confirm the flag is now disabled
  const flags = await listFeatureFlags(restClient);
  const notes = flags.find((f) => f.flag_key === 'notes');
  expect(notes?.enabled).toBe(false);
});

// ---------------------------------------------------------------------------
// F-FF3 — Flag toggle writes an audit log entry
// ---------------------------------------------------------------------------

test('@functional @serial F-FF3: toggling a flag writes a feature_flag audit entry', async ({
  restClient,
  grpcClient,
}) => {
  await loginAsAdmin(restClient);

  // Disable the tags flag via REST
  await updateFeatureFlag(restClient, 'tags', { enabled: false });

  // Fetch the audit log filtered to feature_flag record type
  const { entries } = await getAuditLog(restClient, grpcClient, { recordType: 'feature_flag' });

  const toggleEntry = entries.find(
    (e) =>
      e.record_type === 'feature_flag' && e.field_name === 'enabled' && e.new_value === 'false',
  );

  expect(toggleEntry).toBeDefined();
});

// ---------------------------------------------------------------------------
// F-FF4 — Disabled feature flag returns 403 on the guarded API route
// ---------------------------------------------------------------------------

test('@functional @serial F-FF4: API route guarded by requireFeatureEnabled returns 403 when flag is disabled', async ({
  restClient,
}) => {
  await loginAsAdmin(restClient);

  // Disable the tags flag
  await updateFeatureFlag(restClient, 'tags', { enabled: false });

  // Attempting to list tags should now return 403
  try {
    await restClient.get('/api/v1/tags');
    // If we get here, the flag gate was not enforced — fail the test
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status =
      (err as { status?: number }).status ??
      (err as { response?: { status?: number } }).response?.status;
    expect(status).toBe(403);
  }
});

// ---------------------------------------------------------------------------
// F-FF5 — withFlags() hides a flagged nav link when intercepted as disabled
// ---------------------------------------------------------------------------

test('@functional F-FF5: withFlags() hides the Reports nav link when reporting flag is intercepted as off', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  // Intercept /api/v1/feature-flags/me before the first navigation so the
  // client receives reporting=false and omits the Reports link from the nav.
  await withFlags(page, { reporting: false });

  await loginViaBrowser(admin.email, admin.password, { page });

  // The Reports nav link must not be visible in the top nav.
  const hidden = await isNavLinkHidden('nav-top-reports', { page }, 5_000);
  expect(hidden).toBe(true);
});

// ---------------------------------------------------------------------------
// F-FF6 — withFlags() shows a flagged nav link when intercepted as enabled
// ---------------------------------------------------------------------------

test('@functional F-FF6: withFlags() shows the Reports nav link when reporting flag is intercepted as on', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  // Intercept to explicitly assert the enabled path, even if the DB seed
  // already has reporting=true — this documents the expected on-state behaviour.
  await withFlags(page, { reporting: true });

  await loginViaBrowser(admin.email, admin.password, { page });

  // Assert the Reports nav link is visible on the current viewport.
  // On mobile the link lives inside the hamburger drawer; assertNavLinkIsVisible
  // opens the drawer first so the correct element is checked. (mobile fix)
  await assertNavLinkIsVisible('reports', { page }, 10_000);
});

// ---------------------------------------------------------------------------
// F-FF7 — AI tab is disabled when ai_features flag is intercepted as off
// ---------------------------------------------------------------------------

test('@functional F-FF7: AI tab is disabled in admin settings when ai_features is intercepted as off', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  // Intercept before login so the flag map is resolved before the page renders.
  await withFlags(page, { ai_features: false });

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');

  // On mobile the tab renders as a hidden <option> inside a <select> — toBeAttached
  // confirms presence in the DOM without requiring it to be visually visible.
  const aiTab = await getAdminSettingsAiTabLocator({ page });
  await expect(aiTab).toBeAttached({ timeout: 5_000 });
  await expect(aiTab).toBeDisabled();
});

// ---------------------------------------------------------------------------
// F-FF8 — AI tab is enabled when ai_features flag is intercepted as on
// ---------------------------------------------------------------------------

test('@functional F-FF8: AI tab is enabled in admin settings when ai_features is intercepted as on', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  await withFlags(page, { ai_features: true });

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');

  // On mobile the tab renders as a hidden <option> inside a <select>.
  const aiTab = await getAdminSettingsAiTabLocator({ page });
  await expect(aiTab).toBeAttached({ timeout: 5_000 });
  await expect(aiTab).not.toBeDisabled();
});

// ---------------------------------------------------------------------------
// F-FF9 — Toggling ai_features off disables the AI tab without a page refresh
// ---------------------------------------------------------------------------

test('@functional @serial F-FF9: toggling ai_features off disables the AI tab in real time', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  // Ensure ai_features starts enabled so the toggle goes off→on direction.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'ai_features', { enabled: true });

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');

  const list = await getFeatureFlagsListLocator({ page });
  await expect(list).toBeVisible({ timeout: 10_000 });

  // AI tab should be enabled before toggling.
  const aiTab = await getAdminSettingsAiTabLocator({ page });
  await expect(aiTab).not.toBeDisabled();

  // Toggle ai_features off via the confirmation dialog.
  const toggle = await getFeatureFlagToggleLocator('ai_features', { page });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();

  const confirmDialog = await getFeatureFlagConfirmDialogLocator({ page });
  await expect(confirmDialog).toBeVisible({ timeout: 5_000 });

  const confirmOk = await getFeatureFlagConfirmOkLocator({ page });
  await confirmOk.click();
  await expect(confirmDialog).not.toBeVisible({ timeout: 5_000 });

  // The AI tab must become disabled without any page navigation.
  const refreshedAiTab = await getAdminSettingsAiTabLocator({ page });
  await expect(refreshedAiTab).toBeDisabled({ timeout: 5_000 });
});
