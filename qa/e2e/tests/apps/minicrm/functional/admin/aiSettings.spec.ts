/**
 * F-AI — AI Provider and Model Configuration (MINCRM-457)
 *
 * Functional regression tests for the admin AI settings page, covering the
 * master toggle confirmation dialog, DPA acknowledgment lifecycle, and access
 * control enforcement.
 *
 * Test groups:
 *   F-AI1  — Admin navigates to the AI settings tab and sees the panel
 *   F-AI2  — Master toggle shows a confirmation dialog and can be cancelled
 *   F-AI3  — Master toggle can be enabled via the confirmation dialog
 *   F-AI4  — DPA warning banner is visible when not acknowledged
 *   F-AI5  — DPA warning banner disappears after acknowledgment via REST
 *   F-AI6  — Data posture badge is visible
 *   F-AI7  — Model selector is present and populated
 *   F-AI8  — Test Connection button is visible and returns a result
 *   F-AI9  — Rep cannot access the AI settings API endpoints
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional @serial — resetAiSettings() mutates the
 *     shared ai_features master toggle via the real admin API, which would
 *     otherwise leak a disabled state into any other spec sharing this
 *     worker (see MINCRM-473 CI investigation).
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviors imported from @behaviors/* only — never @pages/*
 *   - AI settings state reset via resetAiSettings() in afterEach
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, createTestRep } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  expectAiSettingsPanelVisible,
  expectAiMasterToggleVisible,
  clickAiMasterToggle,
  expectAiMasterToggleUnchecked,
  expectAiMasterToggleChecked,
  expectAiToggleConfirmDialogVisible,
  expectAiToggleConfirmDialogNotVisible,
  clickAiToggleConfirmAndWait,
  clickAiToggleCancelButton,
  expectAiDpaCheckboxVisible,
  expectAiDpaCheckboxNotVisible,
  acknowledgeAiDpa,
  expectAiDpaWarningBannerVisible,
  expectAiDpaWarningBannerNotVisible,
  expectAiDataPostureBadgeVisible,
  expectAiModelSelectVisible,
  getAiModelOptionCount,
  expectAiTestConnectionButtonVisible,
  clickAiTestConnectionButton,
  expectAiTestConnectionResultVisible,
  resetAiSettings,
  setAiEnabled,
} from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await resetAiSettings(restClient);
});

test.afterEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await resetAiSettings(restClient);
});

// ---------------------------------------------------------------------------
// F-AI1 — Admin navigates to the AI settings tab and sees the panel
// ---------------------------------------------------------------------------

test('@functional @serial F-AI1: admin can navigate to the AI tab and see the AI settings panel', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'ai');

  await expectAiSettingsPanelVisible({ page }, 10_000);
  await expectAiMasterToggleVisible({ page });
});

// ---------------------------------------------------------------------------
// F-AI2 — Master toggle shows a confirmation dialog and can be cancelled
// ---------------------------------------------------------------------------

test('@functional @serial F-AI2: clicking the master toggle shows a confirmation dialog that can be cancelled', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  await clickAiMasterToggle({ page });

  await expectAiToggleConfirmDialogVisible({ page }, 5_000);

  // Cancel dismisses the dialog without changing the toggle state.
  await clickAiToggleCancelButton({ page });

  await expectAiToggleConfirmDialogNotVisible({ page }, 5_000);

  // Toggle should still show disabled (aria-checked=false) after cancel.
  await expectAiMasterToggleUnchecked({ page });
});

// ---------------------------------------------------------------------------
// F-AI3 — Master toggle can be enabled via the confirmation dialog
// ---------------------------------------------------------------------------

test('@functional @serial F-AI3: confirming the toggle dialog enables AI and updates toggle state', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  await expectAiMasterToggleUnchecked({ page });
  await clickAiMasterToggle({ page });

  await expectAiToggleConfirmDialogVisible({ page }, 5_000);

  // Wait for the PATCH response before asserting — prevents a race where the
  // stale cache briefly shows enabled:false while the background refetch runs.
  await clickAiToggleConfirmAndWait({ page });

  // Dialog closes after confirmation.
  await expectAiToggleConfirmDialogNotVisible({ page }, 5_000);

  // Toggle should now reflect enabled state.
  await expectAiMasterToggleChecked({ page }, 8_000);
});

// ---------------------------------------------------------------------------
// F-AI4 — DPA warning banner is visible when not acknowledged
// ---------------------------------------------------------------------------

test('@functional @serial F-AI4: DPA warning banner is visible when DPA has not been acknowledged', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  await expectAiDpaWarningBannerVisible({ page }, 5_000);
});

// ---------------------------------------------------------------------------
// F-AI5 — DPA warning banner disappears after acknowledgment via UI
// ---------------------------------------------------------------------------

test('@functional @serial F-AI5: DPA warning banner disappears after DPA is acknowledged', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // The DPA checkbox lives inside the panel region that AiSettings disables
  // whenever ai_features is off (everything except the master toggle itself
  // — see AiSettings.tsx's `disabled` prop doc comment) — enable AI first so
  // the checkbox is actually interactive.
  await setAiEnabled(restClient, true);

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  // acknowledgeAiDpa clicks the checkbox and awaits the server POST response
  // before returning — ensuring fresh data (dpa_acknowledged: true) is in the
  // React Query cache before we assert on element visibility.
  await expectAiDpaCheckboxVisible({ page }, 5_000);
  await acknowledgeAiDpa({ page });

  // Fresh data confirmed by the server — checkbox should now be absent from the DOM.
  await expectAiDpaCheckboxNotVisible({ page }, 10_000);

  // Warning banner should not be visible when DPA is acknowledged.
  await expectAiDpaWarningBannerNotVisible({ page }, 5_000);
});

// ---------------------------------------------------------------------------
// F-AI6 — Data posture badge is visible
// ---------------------------------------------------------------------------

test('@functional @serial F-AI6: data posture badge is visible on the AI settings page', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  await expectAiDataPostureBadgeVisible({ page });
});

// ---------------------------------------------------------------------------
// F-AI7 — Model selector is present and populated
// ---------------------------------------------------------------------------

test('@functional @serial F-AI7: model selector is present and lists available models', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  await expectAiModelSelectVisible({ page }, 5_000);

  // The select should have at least one option.
  const optionCount = await getAiModelOptionCount({ page });
  expect(optionCount).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// F-AI8 — Test Connection button is visible and returns a result
// ---------------------------------------------------------------------------

test('@functional @serial F-AI8: Test Connection button is visible and shows a result on click', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // The Test Connection button lives inside the panel region that AiSettings
  // disables whenever ai_features is off (everything except the master
  // toggle itself — see AiSettings.tsx's `disabled` prop doc comment).
  await setAiEnabled(restClient, true);

  await navigateToAdminSettings({ page }, 'ai');
  await expectAiSettingsPanelVisible({ page }, 10_000);

  await expectAiTestConnectionButtonVisible({ page }, 5_000);
  await clickAiTestConnectionButton({ page });

  // After clicking, a result message should appear (success or failure — we do
  // not have a valid API key in the E2E environment, so it will report failure).
  await expectAiTestConnectionResultVisible({ page });
});

// ---------------------------------------------------------------------------
// F-AI9 — Rep cannot access the AI settings API endpoints
// ---------------------------------------------------------------------------

test('@functional @serial F-AI9: rep receives 403 when accessing the AI config endpoint', async ({
  restClient,
  testData,
}) => {
  const rep = await createTestRep(testData, restClient);

  // Log in as the rep (no admin rights).
  await restClient.post('/api/v1/auth/login', {
    email: rep.email,
    password: rep.password,
  });

  // Reps must receive 403 on all admin AI endpoints.
  try {
    await restClient.get('/api/v1/admin/ai/config');
    // If we reach here, the auth gate was not enforced — fail the test.
    expect(true).toBe(false);
  } catch (err: unknown) {
    const status =
      (err as { status?: number }).status ??
      (err as { response?: { status?: number } }).response?.status;
    expect(status).toBe(403);
  }
});
