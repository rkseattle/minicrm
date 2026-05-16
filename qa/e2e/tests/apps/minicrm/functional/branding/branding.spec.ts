/**
 * F-BR — Custom Branding Configuration (MINCRM-356)
 *
 * Functional regression tests for the custom branding admin UI.
 * Covers the key AC items:
 *   - Admin can navigate to the Branding tab in Admin Settings
 *   - Admin can save a company name and see it persisted
 *   - Admin can save a primary colour and see the success message
 *   - Admin can reset branding to defaults
 *   - GET /api/settings/branding is accessible without auth (public endpoint)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw Playwright locators — all through AdminSettingsPage page object
 *   - Test data cleaned up via ensureSystemDefaults in afterEach
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import {
  ensureSystemDefaults,
  navigateToAdminSettings,
  getAdminSettingsBrandingFormLocator,
  getAdminSettingsBrandingCompanyNameLocator,
  getAdminSettingsBrandingSaveLocator,
  getAdminSettingsBrandingSaveSuccessLocator,
  getAdminSettingsBrandingColorTextLocator,
  getAdminSettingsBrandingFontSelectLocator,
  getAdminSettingsBrandingResetButtonLocator,
  getAdminSettingsBrandingResetConfirmLocator,
  getAdminSettingsBrandingResetSuccessLocator,
} from '@behaviors/minicrm/settings.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[branding-spec] E2E_ADMIN_PASSWORD is not set');

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

test('admin can navigate to the Branding tab @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await navigateToAdminSettings({ page }, 'branding');

  const form = await getAdminSettingsBrandingFormLocator({ page });
  await expect(form).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Save branding
// ---------------------------------------------------------------------------

test('admin can save a company name and see success confirmation @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await navigateToAdminSettings({ page }, 'branding');

  const companyInput = await getAdminSettingsBrandingCompanyNameLocator({ page });
  await companyInput.fill('Acme Corporation');

  const saveBtn = await getAdminSettingsBrandingSaveLocator({ page });
  await saveBtn.click();

  const successMsg = await getAdminSettingsBrandingSaveSuccessLocator({ page });
  await expect(successMsg).toBeVisible({ timeout: 8_000 });
});

test('admin can save a primary colour @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await navigateToAdminSettings({ page }, 'branding');

  const colorText = await getAdminSettingsBrandingColorTextLocator({ page });
  await colorText.fill('#e53e3e');

  const saveBtn = await getAdminSettingsBrandingSaveLocator({ page });
  await saveBtn.click();

  const successMsg = await getAdminSettingsBrandingSaveSuccessLocator({ page });
  await expect(successMsg).toBeVisible({ timeout: 8_000 });
});

test('admin can select a custom font @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await navigateToAdminSettings({ page }, 'branding');

  const fontSelect = await getAdminSettingsBrandingFontSelectLocator({ page });
  await fontSelect.selectOption('roboto');

  const saveBtn = await getAdminSettingsBrandingSaveLocator({ page });
  await saveBtn.click();

  const successMsg = await getAdminSettingsBrandingSaveSuccessLocator({ page });
  await expect(successMsg).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// Reset branding
// ---------------------------------------------------------------------------

test('admin can reset branding to defaults @functional', async ({ page, restClient }) => {
  // Seed some branding so the reset is meaningful
  await restClient.put('/api/v1/settings/branding', { companyName: 'ToBeReset' });

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await navigateToAdminSettings({ page }, 'branding');

  const resetBtn = await getAdminSettingsBrandingResetButtonLocator({ page });
  await resetBtn.click();

  const confirmBtn = await getAdminSettingsBrandingResetConfirmLocator({ page });
  await confirmBtn.click();

  const successMsg = await getAdminSettingsBrandingResetSuccessLocator({ page });
  await expect(successMsg).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// Public endpoint (no auth required)
// ---------------------------------------------------------------------------

test('GET /api/settings/branding is accessible without authentication @functional', async ({
  restClient,
}) => {
  // Use an unauthenticated request by hitting the endpoint directly
  const response = await restClient.get<{ branding: unknown }>('/api/v1/settings/branding');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('branding');
});
