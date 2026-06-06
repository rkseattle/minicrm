/**
 * F-FF — Feature Flag Registry (MINCRM-463)
 *
 * Functional regression tests for the admin feature flag management UI
 * and API gate enforcement.
 *
 * Test groups:
 *   F-FF1 — Admin views the feature flags page
 *   F-FF2 — Admin toggles a flag off and sees the confirmation dialog
 *   F-FF3 — Flag toggle writes an audit log entry
 *   F-FF4 — Disabled feature flag returns 403 on the guarded API route
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviors imported from @behaviors/* only — never @pages/*
 *   - Test data cleaned up via TestDataManager + direct REST resets
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  getFeatureFlagsListLocator,
  getFeatureFlagToggleLocator,
  getFeatureFlagConfirmDialogLocator,
  getFeatureFlagConfirmOkLocator,
} from '@behaviors/minicrm/settings.behaviors.js';
import { listFeatureFlags, updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';
import { getAuditLog } from '@behaviors/minicrm/audit-log.behaviors.js';

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

  await navigateToAdminSettings({ page }, 'features');

  const list = await getFeatureFlagsListLocator({ page });
  await expect(list).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// F-FF2 — Admin toggles a flag off via the confirmation dialog
// ---------------------------------------------------------------------------

test('@functional F-FF2: admin can disable a flag via the confirmation dialog', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Ensure the notes flag starts enabled.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'notes', { enabled: true });

  await navigateToAdminSettings({ page }, 'features');

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

test('@functional F-FF3: toggling a flag writes a feature_flag audit entry', async ({
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

test('@functional F-FF4: API route guarded by requireFeatureEnabled returns 403 when flag is disabled', async ({
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
