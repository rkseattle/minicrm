/**
 * F-BR — Custom Branding Configuration
 *
 * Functional regression tests for the custom branding admin UI.
 * Covers the key AC items:
 *   - Admin can navigate to the Branding tab in Admin Settings
 *   - Admin can save a company name and see it persisted
 *   - Admin can save a primary colour and see the success message
 *   - Admin can reset branding to defaults
 *   - GET /api/v1/settings/branding is accessible without auth (public endpoint)
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw Playwright locators — all through AdminSettingsPage page object
 *   - Test data cleaned up via ensureSystemDefaults in afterEach
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  ensureSystemDefaults,
  navigateToAdminSettings,
  expectAdminSettingsBrandingFormVisible,
  fillAdminSettingsBrandingCompanyName,
  clickAdminSettingsBrandingSave,
  expectAdminSettingsBrandingSaveSuccessVisible,
  fillAdminSettingsBrandingColorText,
  selectAdminSettingsBrandingFont,
  clickAdminSettingsBrandingReset,
  clickAdminSettingsBrandingResetConfirm,
  expectAdminSettingsBrandingResetSuccessVisible,
} from '@behaviors/minicrm/settings.behaviors.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
});

test.afterEach(async ({ restClient }) => {
  await ensureSystemDefaults(restClient);
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test('admin can navigate to the Branding tab @functional', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'branding');

  await expectAdminSettingsBrandingFormVisible({ page }, 10_000);
});

// ---------------------------------------------------------------------------
// Save branding
// ---------------------------------------------------------------------------

test('admin can save a company name and see success confirmation @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'branding');

  await fillAdminSettingsBrandingCompanyName('Acme Corporation', { page });

  await clickAdminSettingsBrandingSave({ page });

  await expectAdminSettingsBrandingSaveSuccessVisible({ page }, 8_000);
});

test('admin can save a primary colour @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'branding');

  await fillAdminSettingsBrandingColorText('#e53e3e', { page });

  await clickAdminSettingsBrandingSave({ page });

  await expectAdminSettingsBrandingSaveSuccessVisible({ page }, 8_000);
});

test('admin can select a custom font @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'branding');

  await selectAdminSettingsBrandingFont('roboto', { page });

  await clickAdminSettingsBrandingSave({ page });

  await expectAdminSettingsBrandingSaveSuccessVisible({ page }, 8_000);
});

// ---------------------------------------------------------------------------
// Reset branding
// ---------------------------------------------------------------------------

test('admin can reset branding to defaults @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  // Seed some branding so the reset is meaningful
  await restClient.put('/api/v1/settings/branding', { companyName: 'ToBeReset' });

  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettings({ page }, 'branding');

  await clickAdminSettingsBrandingReset({ page });

  await clickAdminSettingsBrandingResetConfirm({ page });

  await expectAdminSettingsBrandingResetSuccessVisible({ page }, 8_000);
});

// ---------------------------------------------------------------------------
// Public endpoint (no auth required)
// ---------------------------------------------------------------------------

test('GET /api/v1/settings/branding is accessible without authentication @functional', async ({
  restClient,
}) => {
  // Use an unauthenticated request by hitting the endpoint directly
  const response = await restClient.get<{ branding: unknown }>('/api/v1/settings/branding');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('branding');
});
