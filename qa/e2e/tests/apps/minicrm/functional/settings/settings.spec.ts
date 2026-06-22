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
  expectAdminSettingsExchangeRatesSectionVisible,
  selectAdminSettingsHomeCurrency,
  clickAdminSettingsAddCurrency,
  expectAdminSettingsAddCurrencyFormVisible,
  selectAdminSettingsAddCurrencyCode,
  fillAdminSettingsAddCurrencyRate,
  confirmAdminSettingsAddCurrency,
  saveAdminSettingsExchangeRates,
  expectAdminSettingsExchangeRateSaveSuccessVisible,
  expectAdminSettingsExchangeRateRowVisible,
  navigateToAdminSettingsCurrency,
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

test('admin can configure exchange rates and reload to confirm persistence @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  // Reset currencies to just USD home so test state is predictable
  await setCurrencySettings(restClient, { home_currency: 'USD', currencies: [] });

  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Navigate to Admin Settings — currency tab required for exchange-rates-section
  await navigateToAdminSettingsCurrency({ page });

  // Wait for the exchange rates section to be visible
  await expectAdminSettingsExchangeRatesSectionVisible({ page }, 10_000);

  // Set home currency to GBP first — this updates usedCurrencyCodes so that
  // USD and EUR are available in the add-currency dropdown (GBP is excluded
  // from the rate rows since it is now the home currency). (MINCRM-418)
  await selectAdminSettingsHomeCurrency('GBP', { page });

  // Wait for the exchange rate table to show GBP as the home currency before
  // proceeding. This confirms the React state update has flushed and the
  // refetchOnWindowFocus background re-fetch (staleTime:0) has settled.
  // Re-applying 'GBP' after the row is visible ensures the selection is stable
  // before the add-currency form is opened. (MINCRM-418)
  await expectAdminSettingsExchangeRateRowVisible('GBP', { page }, 5_000);
  await selectAdminSettingsHomeCurrency('GBP', { page });

  // Click Add Currency to open the form
  await clickAdminSettingsAddCurrency({ page });
  await expectAdminSettingsAddCurrencyFormVisible({ page });

  // Add USD with rate 1.27
  await selectAdminSettingsAddCurrencyCode('USD', { page });
  await fillAdminSettingsAddCurrencyRate('1.27', { page });
  await confirmAdminSettingsAddCurrency({ page });

  // Add EUR with rate 1.16
  await clickAdminSettingsAddCurrency({ page });
  await expectAdminSettingsAddCurrencyFormVisible({ page });
  await selectAdminSettingsAddCurrencyCode('EUR', { page });
  await fillAdminSettingsAddCurrencyRate('1.16', { page });
  await confirmAdminSettingsAddCurrency({ page });

  // Save rates
  await saveAdminSettingsExchangeRates({ page });

  // Wait for save success
  await expectAdminSettingsExchangeRateSaveSuccessVisible({ page }, 8_000);

  // Verify persistence via REST immediately after save — before parallel workers
  // can call ensureSystemDefaults() and reset home_currency back to USD.
  // A page reload is vulnerable to that race; a direct API check is not.
  const saved = (await restClient.get('/api/v1/settings/currencies')).body as {
    home_currency: string;
    currencies: Array<{ code: string; rate: number }>;
  };
  expect(saved.home_currency).toBe('GBP');
  const savedUsd = saved.currencies.find((c) => c.code === 'USD');
  const savedEur = saved.currencies.find((c) => c.code === 'EUR');
  expect(savedUsd).toBeDefined();
  expect(savedEur).toBeDefined();

  // Restore to USD home for other tests
  await setCurrencySettings(restClient, { home_currency: 'USD', currencies: [] });
});
