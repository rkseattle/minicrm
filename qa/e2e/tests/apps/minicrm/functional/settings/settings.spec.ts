/**
 * Settings functional tests — exchange rate configuration (MINCRM-251)
 *
 * Tests that an admin can configure exchange rates via the Admin Settings page.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through page objects
 *   - Test data cleaned up via restClient after each scenario
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import { setCurrencySettings } from '@behaviors/minicrm/setup.behaviors.js';
import {
  ensureSystemDefaults,
  getAdminSettingsExchangeRatesSectionLocator,
  getAdminSettingsHomeCurrencySelectLocator,
  clickAdminSettingsAddCurrency,
  getAdminSettingsAddCurrencyFormLocator,
  getAdminSettingsAddCurrencyCodeSelectLocator,
  getAdminSettingsAddCurrencyRateInputLocator,
  confirmAdminSettingsAddCurrency,
  saveAdminSettingsExchangeRates,
  getAdminSettingsExchangeRateSaveSuccessLocator,
  getAdminSettingsExchangeRateRowLocator,
} from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Setup — known-good system state before/after each test (MINCRM-358)
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
});

test.afterEach(async ({ restClient }) => {
  await ensureSystemDefaults(restClient);
});

// ---------------------------------------------------------------------------
// Exchange rate configuration
// ---------------------------------------------------------------------------

test('admin can configure exchange rates and reload to confirm persistence @functional', async ({
  page,
  restClient,
  testData,
}) => {
  // Reset currencies to just USD home so test state is predictable
  await setCurrencySettings(restClient, { home_currency: 'USD', currencies: [] });

  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Navigate to Admin Settings — currency tab required for exchange-rates-section
  await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });

  // Wait for the exchange rates section to be visible
  const section = await getAdminSettingsExchangeRatesSectionLocator({ page });
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Set home currency to GBP
  const homeSelect = await getAdminSettingsHomeCurrencySelectLocator({ page });
  await homeSelect.selectOption('GBP');

  // Click Add Currency to open the form
  await clickAdminSettingsAddCurrency({ page });
  const addForm = await getAdminSettingsAddCurrencyFormLocator({ page });
  await expect(addForm).toBeVisible();

  // Add USD with rate 1.27
  const codeSelect = await getAdminSettingsAddCurrencyCodeSelectLocator({ page });
  await codeSelect.selectOption('USD');
  const rateInput = await getAdminSettingsAddCurrencyRateInputLocator({ page });
  await rateInput.fill('1.27');
  await confirmAdminSettingsAddCurrency({ page });

  // Add EUR with rate 1.16
  await clickAdminSettingsAddCurrency({ page });
  const addForm2 = await getAdminSettingsAddCurrencyFormLocator({ page });
  await expect(addForm2).toBeVisible();
  const codeSelect2 = await getAdminSettingsAddCurrencyCodeSelectLocator({ page });
  await codeSelect2.selectOption('EUR');
  const rateInput2 = await getAdminSettingsAddCurrencyRateInputLocator({ page });
  await rateInput2.fill('1.16');
  await confirmAdminSettingsAddCurrency({ page });

  // Save rates
  await saveAdminSettingsExchangeRates({ page });

  // Wait for save success
  const saveSuccess = await getAdminSettingsExchangeRateSaveSuccessLocator({ page });
  await expect(saveSuccess).toBeVisible({ timeout: 8_000 });

  // Reload and verify persistence — deep-link back to currency tab
  await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });
  const sectionAfterReload = await getAdminSettingsExchangeRatesSectionLocator({ page });
  await expect(sectionAfterReload).toBeVisible({ timeout: 10_000 });

  // Home currency should be GBP
  const homeSelectAfterReload = await getAdminSettingsHomeCurrencySelectLocator({ page });
  await expect(homeSelectAfterReload).toHaveValue('GBP');

  // USD and EUR rate rows should be visible
  const usdRow = await getAdminSettingsExchangeRateRowLocator('USD', { page });
  await expect(usdRow).toBeVisible();
  const eurRow = await getAdminSettingsExchangeRateRowLocator('EUR', { page });
  await expect(eurRow).toBeVisible();

  // Restore to USD home for other tests
  await setCurrencySettings(restClient, { home_currency: 'USD', currencies: [] });
});
