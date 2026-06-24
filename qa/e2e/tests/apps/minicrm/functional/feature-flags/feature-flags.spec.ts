/**
 * F-FF — Feature Flag Registry (MINCRM-463, MINCRM-477, MINCRM-490, MINCRM-491, MINCRM-492)
 *
 * Functional regression tests for the admin feature flag management UI,
 * API gate enforcement, and client-side flag isolation via withFlags().
 *
 * Test groups:
 *   F-FF1  — Admin views the feature flags page
 *   F-FF2  — Admin toggles a flag off and sees the confirmation dialog
 *   F-FF3  — Flag toggle writes an audit log entry
 *   F-FF4  — Disabled feature flag returns 403 on the guarded API route
 *   F-FF5  — withFlags() hides a nav link when its flag is intercepted as off
 *   F-FF6  — withFlags() shows a nav link when its flag is intercepted as on
 *   F-FF7  — AI tab is disabled when ai_features flag is intercepted as off
 *   F-FF8  — AI tab is enabled when ai_features flag is intercepted as on
 *   F-FF9  — Toggling ai_features off disables the AI tab without a page refresh
 *   F-FF14 — Rollout percentage badge appears in admin UI when rollout_percentage is set (MINCRM-490)
 *   F-FF15 — Rep bucketed out of rollout sees flag as disabled via /me (MINCRM-490)
 *   F-FF16 — Force-enabled override badge appears in admin UI (MINCRM-492)
 *   F-FF17 — Force-enabled user sees a globally-disabled flag as enabled via /me (MINCRM-492)
 *   F-FF18 — Admin creates a group and sees it in the groups section (MINCRM-491)
 *   F-FF19 — Disabling a group gate blocks member flags for non-beta users (MINCRM-491)
 *   F-FF20 — Re-enabling a group gate restores member flag visibility (MINCRM-491)
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
import { createTestAdmin, createTestRep, withFlags } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  expectFeatureFlagsListVisible,
  clickFeatureFlagToggle,
  expectFeatureFlagToggleChecked,
  expectFeatureFlagToggleUnchecked,
  expectFeatureFlagConfirmDialogVisible,
  expectFeatureFlagConfirmDialogNotVisible,
  clickFeatureFlagConfirmOk,
  expectAdminSettingsAiTabAttached,
  expectAdminSettingsAiTabDisabled,
  expectAdminSettingsAiTabEnabled,
  expectFeatureFlagScheduledBadgeVisible,
  expectFeatureFlagOffBadgeNotVisible,
  clickFeatureFlagClearSchedule,
  expectFeatureFlagScheduledBadgeNotVisible,
  expectBetaUserRowVisible,
  expandBetaUsersPanel,
  expandAdvancedPanel,
  expectRolloutPercentageBadgeVisible,
  expectRolloutPercentageBadgeNotVisible,
  expectOverrideCountBadgeVisible,
  expectOverrideCountBadgeNotVisible,
  expectOverrideRowVisible,
  expectOverrideRowNotVisible,
  clickOverrideRemove,
  expectFlagGroupsSectionVisible,
  expectFlagGroupRowVisible,
} from '@behaviors/minicrm/settings.behaviors.js';
import {
  listFeatureFlags,
  updateFeatureFlag,
  enrollBetaUser,
  removeBetaUser,
  getMyFeatureFlags,
  updateFeatureFlagRollout,
  listUserOverrides,
  upsertUserOverride,
  deleteUserOverride,
  createFlagGroup,
  updateFlagGroup,
  deleteFlagGroup,
} from '@behaviors/minicrm/feature-flags.behaviors.js';
import { getAuditLog } from '@behaviors/minicrm/audit-log.behaviors.js';
import { isNavLinkHidden, assertNavLinkIsVisible } from '@behaviors/minicrm/nav.behaviors.js';
import { loginAs } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

test.afterEach(async ({ restClient }) => {
  // Re-auth as admin first — some tests end as a rep and subsequent cleanup calls would 403.
  await loginAsAdmin(restClient);
  // Restore any flags that tests may have toggled.
  await updateFeatureFlag(restClient, 'notes', { enabled: true, enable_at: null }).catch(() => {});
  await updateFeatureFlag(restClient, 'tags', { enabled: true, enable_at: null }).catch(() => {});
  await updateFeatureFlag(restClient, 'ai_features', { enabled: true, enable_at: null }).catch(
    () => {},
  );
  await updateFeatureFlag(restClient, 'mobile_access', {
    enabled: false,
    enable_at: null,
  }).catch(() => {});
  // Clear rollout fields set by F-FF14 and F-FF15 (enabled:false matches the reset above).
  await updateFeatureFlagRollout(restClient, 'mobile_access', {
    enabled: false,
    rollout_percentage: null,
    rollout_stages: null,
  }).catch(() => {});
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

  await expectFeatureFlagsListVisible({ page }, 10_000);
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

  await expectFeatureFlagsListVisible({ page }, 10_000);

  // notes flag should be enabled
  await expectFeatureFlagToggleChecked('notes', { page });

  // Click the toggle to trigger the confirmation dialog
  await clickFeatureFlagToggle('notes', { page });

  await expectFeatureFlagConfirmDialogVisible({ page }, 5_000);

  // Confirm the disable
  await clickFeatureFlagConfirmOk({ page });

  // Dialog should close after confirmation
  await expectFeatureFlagConfirmDialogNotVisible({ page }, 5_000);

  // The toggle should now reflect disabled state
  await expectFeatureFlagToggleUnchecked('notes', { page }, 5_000);

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
  await expectAdminSettingsAiTabAttached({ page }, 5_000);
  await expectAdminSettingsAiTabDisabled({ page });
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
  await expectAdminSettingsAiTabAttached({ page }, 5_000);
  await expectAdminSettingsAiTabEnabled({ page });
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

  await expectFeatureFlagsListVisible({ page }, 10_000);

  // AI tab should be enabled before toggling.
  await expectAdminSettingsAiTabEnabled({ page });

  // Toggle ai_features off via the confirmation dialog.
  await expectFeatureFlagToggleChecked('ai_features', { page });
  await clickFeatureFlagToggle('ai_features', { page });

  await expectFeatureFlagConfirmDialogVisible({ page }, 5_000);

  await clickFeatureFlagConfirmOk({ page });
  await expectFeatureFlagConfirmDialogNotVisible({ page }, 5_000);

  // The AI tab must become disabled without any page navigation.
  await expectAdminSettingsAiTabDisabled({ page }, 5_000);
});

// ---------------------------------------------------------------------------
// F-FF10 — Scheduled enable_at shows Scheduled badge in admin UI (MINCRM-488)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF10: admin sets enable_at and the Scheduled badge appears; clearing it removes the badge', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  // Schedule mobile_access to enable 2 hours from now via REST (flag must be disabled).
  await loginAsAdmin(restClient);
  const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false, enable_at: futureDate });

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');
  await expectFeatureFlagsListVisible({ page }, 10_000);

  // Scheduled badge must be visible; Off badge must be absent.
  await expectFeatureFlagScheduledBadgeVisible('mobile_access', { page }, 8_000);
  await expectFeatureFlagOffBadgeNotVisible('mobile_access', { page });

  // Clearing the schedule now routes through ConfirmDialog — confirm it.
  await clickFeatureFlagClearSchedule('mobile_access', { page });
  await clickFeatureFlagConfirmOk({ page });
  await expectFeatureFlagScheduledBadgeNotVisible('mobile_access', { page }, 8_000);
});

// ---------------------------------------------------------------------------
// F-FF11 — Scheduled flag auto-enables when enable_at passes (MINCRM-488)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF11: a scheduled flag is seen as enabled by an ordinary user once enable_at passes', async ({
  restClient,
  testData,
}) => {
  // Create a rep user who will be used to check flag visibility.
  const rep = await createTestRep(testData, restClient);

  // Schedule mobile_access to enable 2 seconds from now.
  await loginAsAdmin(restClient);
  const soonDate = new Date(Date.now() + 2_000).toISOString();
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false, enable_at: soonDate });

  // Authenticate as the rep and confirm the flag is still disabled before time.
  await loginAs(restClient, rep.email, rep.password);
  const flagsBefore = await getMyFeatureFlags(restClient);
  expect(flagsBefore['mobile_access']).toBe(false);

  // Wait for enable_at to pass and the service cache to expire (TTL capped to ~2s).
  await new Promise((resolve) => setTimeout(resolve, 4_000));

  // After the TTL expires the flag reloads from DB and is auto-enabled.
  const flagsAfter = await getMyFeatureFlags(restClient);
  expect(flagsAfter['mobile_access']).toBe(true);

  // Re-auth as admin for afterEach cleanup.
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// F-FF12 — Beta-enrolled user sees a disabled flag as enabled (MINCRM-489)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF12: beta-enrolled rep sees a globally-disabled flag as enabled via /me', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);

  // Ensure mobile_access is disabled globally.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false });

  // Rep should see it as disabled before enrollment.
  await loginAs(restClient, rep.email, rep.password);
  const flagsBefore = await getMyFeatureFlags(restClient);
  expect(flagsBefore['mobile_access']).toBe(false);

  // Enroll the rep in beta (requires admin).
  await loginAsAdmin(restClient);
  await enrollBetaUser(restClient, 'mobile_access', rep.userId);

  // Rep now sees it as enabled (beta bypass — isFlagEnabledForUser is always fresh).
  await loginAs(restClient, rep.email, rep.password);
  const flagsAfter = await getMyFeatureFlags(restClient);
  expect(flagsAfter['mobile_access']).toBe(true);

  // Cleanup: remove beta enrollment (requires admin).
  await loginAsAdmin(restClient);
  await removeBetaUser(restClient, 'mobile_access', rep.userId).catch(() => {});
});

// ---------------------------------------------------------------------------
// F-FF13 — Beta user panel shows enrolled user in admin UI (MINCRM-489)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF13: enrolled beta user appears in the admin feature flags beta panel', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  const rep = await createTestRep(testData, restClient);

  // Enroll the rep in the mobile_access beta.
  await loginAsAdmin(restClient);
  await enrollBetaUser(restClient, 'mobile_access', rep.userId);

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');
  await expectFeatureFlagsListVisible({ page }, 10_000);

  // The advanced panel is collapsed — expand it to reveal beta/override sub-panels. (MINCRM-490)
  await expandAdvancedPanel('mobile_access', { page });
  // The beta panel is collapsed (beta_user_count > 0) — expand it too. (MINCRM-489)
  await expandBetaUsersPanel('mobile_access', { page });

  // The enrolled rep must appear in the beta panel for mobile_access.
  await expectBetaUserRowVisible('mobile_access', rep.userId, { page }, 8_000);

  // Cleanup: remove beta enrollment.
  await loginAsAdmin(restClient);
  await removeBetaUser(restClient, 'mobile_access', rep.userId).catch(() => {});
});

// ---------------------------------------------------------------------------
// F-FF14 — Rollout percentage badge appears in admin UI (MINCRM-490)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF14: setting rollout_percentage shows a badge in the admin UI; clearing it removes the badge', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);

  // Ensure mobile_access is enabled so the rollout section renders.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: true });

  // Set a 25% rollout via REST (flag is enabled, required by the PATCH endpoint).
  await updateFeatureFlagRollout(restClient, 'mobile_access', {
    enabled: true,
    rollout_percentage: 25,
  });

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');
  await expectFeatureFlagsListVisible({ page }, 10_000);

  // Badge must appear showing the rollout percentage.
  await expectRolloutPercentageBadgeVisible('mobile_access', { page }, 8_000);

  // Clear the rollout percentage via REST and reload the page.
  await loginAsAdmin(restClient);
  await updateFeatureFlagRollout(restClient, 'mobile_access', {
    enabled: true,
    rollout_percentage: null,
  });

  await navigateToAdminSettings({ page }, 'flags');
  await expectFeatureFlagsListVisible({ page }, 10_000);

  // Badge must be absent once rollout_percentage is null.
  await expectRolloutPercentageBadgeNotVisible('mobile_access', { page }, 8_000);
});

// ---------------------------------------------------------------------------
// F-FF15 — Rep bucketed outside rollout sees flag as disabled via /me (MINCRM-490)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF15: a rep bucketed outside a 0% rollout sees the flag as disabled via /me', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);

  // Enable the flag but set rollout to 0% — no one in the bucket.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: true });
  await updateFeatureFlagRollout(restClient, 'mobile_access', {
    enabled: true,
    rollout_percentage: 0,
  });

  // Rep with no beta enrollment should see the flag as disabled (bucketed out).
  await loginAs(restClient, rep.email, rep.password);
  const flags = await getMyFeatureFlags(restClient);
  expect(flags['mobile_access']).toBe(false);

  // Cleanup: clear rollout and disable the flag.
  await loginAsAdmin(restClient);
  await updateFeatureFlagRollout(restClient, 'mobile_access', {
    enabled: true,
    rollout_percentage: null,
  });
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false });
});

// ---------------------------------------------------------------------------
// F-FF16 — Force-enabled override badge appears in admin UI (MINCRM-492)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF16: adding a force_enabled override shows the badge in admin UI; removing it hides the badge and row', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  const rep = await createTestRep(testData, restClient);

  // Clear any leftover overrides from prior runs so the count starts at 0.
  await loginAsAdmin(restClient);
  const existingOverrides = await listUserOverrides(restClient, 'mobile_access');
  await Promise.all(
    existingOverrides.map((o) =>
      deleteUserOverride(restClient, 'mobile_access', o.user_id).catch(() => {}),
    ),
  );

  // Add exactly one force_enabled override for the rep.
  await upsertUserOverride(restClient, 'mobile_access', rep.userId, 'force_enabled', 'E2E test');

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');
  await expectFeatureFlagsListVisible({ page }, 10_000);

  // Badge showing forced-on count must appear.
  await expectOverrideCountBadgeVisible('mobile_access', 'force_enabled', { page }, 8_000);

  // The advanced panel is collapsed — expand it to reveal the overrides panel. (MINCRM-492)
  await expandAdvancedPanel('mobile_access', { page });

  // The override row must be present inside the overrides panel.
  await expectOverrideRowVisible('mobile_access', rep.userId, { page }, 8_000);

  // Remove the override via the UI remove button.
  await clickOverrideRemove('mobile_access', rep.userId, { page });

  // Row must disappear; badge must also disappear (count drops to 0).
  await expectOverrideRowNotVisible('mobile_access', rep.userId, { page }, 8_000);
  await expectOverrideCountBadgeNotVisible('mobile_access', 'force_enabled', { page }, 8_000);

  // Confirm removal via the REST API.
  await loginAsAdmin(restClient);
  const overrides = await listUserOverrides(restClient, 'mobile_access');
  const remaining = overrides.filter((o) => o.user_id === rep.userId);
  expect(remaining).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// F-FF17 — Force-enabled user sees a globally-disabled flag as enabled (MINCRM-492)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF17: a force_enabled override lets a rep see a globally-disabled flag as enabled via /me', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);

  // Disable the flag globally.
  await loginAsAdmin(restClient);
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false });

  // Rep sees it as disabled before the override.
  await loginAs(restClient, rep.email, rep.password);
  const flagsBefore = await getMyFeatureFlags(restClient);
  expect(flagsBefore['mobile_access']).toBe(false);

  // Add a force_enabled override.
  await loginAsAdmin(restClient);
  await upsertUserOverride(restClient, 'mobile_access', rep.userId, 'force_enabled', null);

  // Rep now sees the flag as enabled despite global disable.
  await loginAs(restClient, rep.email, rep.password);
  const flagsAfter = await getMyFeatureFlags(restClient);
  expect(flagsAfter['mobile_access']).toBe(true);

  // Verify the override is recorded via REST.
  await loginAsAdmin(restClient);
  const overrides = await listUserOverrides(restClient, 'mobile_access');
  const entry = overrides.find((o) => o.user_id === rep.userId);
  expect(entry?.override).toBe('force_enabled');

  // Cleanup: remove override.
  await deleteUserOverride(restClient, 'mobile_access', rep.userId).catch(() => {});
});

// ---------------------------------------------------------------------------
// F-FF18 — Admin creates a flag group and sees it in the groups section (MINCRM-491)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF18: admin can create a flag group and it appears in the groups section', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  const groupKey = `e2e-ff18-group-${Date.now()}`;

  // Create the group via REST so it exists before the admin views the page.
  await loginAsAdmin(restClient);
  await createFlagGroup(restClient, { group_key: groupKey, label: 'E2E FF18 Group' });

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettings({ page }, 'flags');
  await expectFeatureFlagsListVisible({ page }, 10_000);
  await expectFlagGroupsSectionVisible({ page }, 8_000);
  await expectFlagGroupRowVisible(groupKey, { page }, 8_000);

  // Cleanup.
  await loginAsAdmin(restClient);
  await deleteFlagGroup(restClient, groupKey).catch(() => {});
});

// ---------------------------------------------------------------------------
// F-FF19 — Disabling a group gate blocks member flags for non-beta users via /me (MINCRM-491)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF19: disabling a group gate makes member flags return false via /me for non-beta users', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);
  const groupKey = `e2e-ff19-group-${Date.now()}`;

  await loginAsAdmin(restClient);

  // Create group and assign mobile_access to it; enable the flag.
  await createFlagGroup(restClient, { group_key: groupKey, label: 'E2E FF19 Group' });
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: true });

  // Assign mobile_access to the new group (group enabled by default — flag is visible).
  // The REST patch for group_key reuses the existing PATCH endpoint.
  await restClient.patch(`/api/v1/admin/feature-flags/mobile_access`, {
    enabled: true,
    group_key: groupKey,
  });

  // Confirm rep sees the flag as enabled while group is enabled.
  await loginAs(restClient, rep.email, rep.password);
  const before = await getMyFeatureFlags(restClient);
  expect(before['mobile_access']).toBe(true);

  // Disable the group.
  await loginAsAdmin(restClient);
  await updateFlagGroup(restClient, groupKey, { enabled: false });

  // Rep now sees the flag as disabled (group gate blocks it).
  await loginAs(restClient, rep.email, rep.password);
  const after = await getMyFeatureFlags(restClient);
  expect(after['mobile_access']).toBe(false);

  // Cleanup.
  await loginAsAdmin(restClient);
  await restClient
    .patch(`/api/v1/admin/feature-flags/mobile_access`, { enabled: false, group_key: null })
    .catch(() => {});
  await deleteFlagGroup(restClient, groupKey).catch(() => {});
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false }).catch(() => {});
});

// ---------------------------------------------------------------------------
// F-FF20 — Re-enabling a group gate restores member flag visibility (MINCRM-491)
// ---------------------------------------------------------------------------

test('@functional @serial F-FF20: re-enabling a disabled group gate restores member flag visibility via /me', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);
  const groupKey = `e2e-ff20-group-${Date.now()}`;

  await loginAsAdmin(restClient);

  // Create group (disabled), enable mobile_access, assign to group.
  await createFlagGroup(restClient, { group_key: groupKey, label: 'E2E FF20 Group' });
  await updateFlagGroup(restClient, groupKey, { enabled: false });
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: true });
  await restClient.patch(`/api/v1/admin/feature-flags/mobile_access`, {
    enabled: true,
    group_key: groupKey,
  });

  // Rep should see false (group disabled).
  await loginAs(restClient, rep.email, rep.password);
  const blocked = await getMyFeatureFlags(restClient);
  expect(blocked['mobile_access']).toBe(false);

  // Re-enable the group.
  await loginAsAdmin(restClient);
  await updateFlagGroup(restClient, groupKey, { enabled: true });

  // Rep now sees the flag as enabled again.
  await loginAs(restClient, rep.email, rep.password);
  const restored = await getMyFeatureFlags(restClient);
  expect(restored['mobile_access']).toBe(true);

  // Cleanup.
  await loginAsAdmin(restClient);
  await restClient
    .patch(`/api/v1/admin/feature-flags/mobile_access`, { enabled: false, group_key: null })
    .catch(() => {});
  await deleteFlagGroup(restClient, groupKey).catch(() => {});
  await updateFeatureFlag(restClient, 'mobile_access', { enabled: false }).catch(() => {});
});
