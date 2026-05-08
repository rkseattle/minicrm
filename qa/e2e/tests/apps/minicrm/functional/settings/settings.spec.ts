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
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { AdminSettingsPage } from '@pages/minicrm/AdminSettingsPage.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[settings-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Setup — log in as admin once before all tests
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Exchange rate configuration
// ---------------------------------------------------------------------------

test('admin can configure exchange rates and reload to confirm persistence @functional', async ({
  page,
  restClient,
}) => {
  // Reset currencies to just USD home so test state is predictable
  await restClient.put('/api/v1/settings/currencies', {
    home_currency: 'USD',
    currencies: [],
  });

  // Log in via the UI
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  const adminSettings = new AdminSettingsPage({ page });

  // Navigate to Admin Settings — currency tab required for exchange-rates-section
  await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });

  // Wait for the exchange rates section to be visible
  const section = await adminSettings.exchangeRatesSectionLocator();
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Set home currency to GBP
  const homeSelect = await adminSettings.homeCurrencySelectLocator();
  await homeSelect.selectOption('GBP');

  // Click Add Currency to open the form
  await adminSettings.clickAddCurrency();
  const addForm = await adminSettings.addCurrencyFormLocator();
  await expect(addForm).toBeVisible();

  // Add USD with rate 1.27
  const codeSelect = await adminSettings.addCurrencyCodeSelectLocator();
  await codeSelect.selectOption('USD');
  const rateInput = await adminSettings.addCurrencyRateInputLocator();
  await rateInput.fill('1.27');
  await adminSettings.confirmAddCurrency();

  // Add EUR with rate 1.16
  await adminSettings.clickAddCurrency();
  const addForm2 = await adminSettings.addCurrencyFormLocator();
  await expect(addForm2).toBeVisible();
  const codeSelect2 = await adminSettings.addCurrencyCodeSelectLocator();
  await codeSelect2.selectOption('EUR');
  const rateInput2 = await adminSettings.addCurrencyRateInputLocator();
  await rateInput2.fill('1.16');
  await adminSettings.confirmAddCurrency();

  // Save rates
  await adminSettings.saveExchangeRates();

  // Wait for save success
  const saveSuccess = await adminSettings.exchangeRateSaveSuccessLocator();
  await expect(saveSuccess).toBeVisible({ timeout: 8_000 });

  // Reload and verify persistence — deep-link back to currency tab
  await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });
  const sectionAfterReload = await adminSettings.exchangeRatesSectionLocator();
  await expect(sectionAfterReload).toBeVisible({ timeout: 10_000 });

  // Home currency should be GBP
  const homeSelectAfterReload = await adminSettings.homeCurrencySelectLocator();
  await expect(homeSelectAfterReload).toHaveValue('GBP');

  // USD and EUR rate rows should be visible
  const usdRow = await adminSettings.exchangeRateRowLocator('USD');
  await expect(usdRow).toBeVisible();
  const eurRow = await adminSettings.exchangeRateRowLocator('EUR');
  await expect(eurRow).toBeVisible();

  // Restore to USD home for other tests
  await restClient.put('/api/v1/settings/currencies', {
    home_currency: 'USD',
    currencies: [],
  });
});
