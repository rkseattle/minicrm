/**
 * Settings functional tests — exchange rate configuration (MINCRM-251)
 *
 * Tests that an admin can configure exchange rates via the Admin Settings page.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in spec — use page.locate / page.click / page.goto
 *   - Test data cleaned up via restClient after each scenario
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';

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
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Exchange rate configuration
// ---------------------------------------------------------------------------

test('admin can configure exchange rates and reload to confirm persistence @functional', async ({
  page,
  restClient,
}) => {
  // Reset currencies to just USD home so test state is predictable
  await restClient.put('/api/settings/currencies', {
    home_currency: 'USD',
    currencies: [],
  });

  // Log in via the UI
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  // Navigate to Admin Settings — currency tab required for exchange-rates-section
  await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });

  // Wait for the exchange rates section to be visible
  const section = await page
    .locate([{ type: 'testId', value: 'exchange-rates-section' }])
    .resolve();
  await expect(section).toBeVisible({ timeout: 10_000 });

  // Set home currency to GBP
  const homeSelect = await page
    .locate([{ type: 'testId', value: 'home-currency-select' }])
    .resolve();
  await homeSelect.selectOption('GBP');

  // Click Add Currency to open the form
  await page.click([{ type: 'testId', value: 'exchange-rate-add-button' }]);
  const addForm = await page.locate([{ type: 'testId', value: 'add-currency-form' }]).resolve();
  await expect(addForm).toBeVisible();

  // Add USD with rate 1.27
  const codeSelect = await page
    .locate([{ type: 'testId', value: 'add-currency-code-select' }])
    .resolve();
  await codeSelect.selectOption('USD');
  const rateInput = await page
    .locate([{ type: 'testId', value: 'add-currency-rate-input' }])
    .resolve();
  await rateInput.fill('1.27');
  await page.click([{ type: 'testId', value: 'add-currency-confirm' }]);

  // Add EUR with rate 1.16
  await page.click([{ type: 'testId', value: 'exchange-rate-add-button' }]);
  const addForm2 = await page.locate([{ type: 'testId', value: 'add-currency-form' }]).resolve();
  await expect(addForm2).toBeVisible();
  const codeSelect2 = await page
    .locate([{ type: 'testId', value: 'add-currency-code-select' }])
    .resolve();
  await codeSelect2.selectOption('EUR');
  const rateInput2 = await page
    .locate([{ type: 'testId', value: 'add-currency-rate-input' }])
    .resolve();
  await rateInput2.fill('1.16');
  await page.click([{ type: 'testId', value: 'add-currency-confirm' }]);

  // Save rates
  await page.click([{ type: 'testId', value: 'exchange-rate-save-button' }]);

  // Wait for save success
  const saveSuccess = await page
    .locate([{ type: 'testId', value: 'exchange-rate-save-success' }])
    .resolve();
  await expect(saveSuccess).toBeVisible({ timeout: 8_000 });

  // Reload and verify persistence — deep-link back to currency tab
  await page.goto('/admin/settings?tab=currency', { waitUntil: 'networkidle' });
  const sectionAfterReload = await page
    .locate([{ type: 'testId', value: 'exchange-rates-section' }])
    .resolve();
  await expect(sectionAfterReload).toBeVisible({ timeout: 10_000 });

  // Home currency should be GBP
  const homeSelectAfterReload = await page
    .locate([{ type: 'testId', value: 'home-currency-select' }])
    .resolve();
  await expect(homeSelectAfterReload).toHaveValue('GBP');

  // USD and EUR rate rows should be visible
  const usdRow = await page.locate([{ type: 'testId', value: 'exchange-rate-row-USD' }]).resolve();
  await expect(usdRow).toBeVisible();
  const eurRow = await page.locate([{ type: 'testId', value: 'exchange-rate-row-EUR' }]).resolve();
  await expect(eurRow).toBeVisible();

  // Restore to USD home for other tests
  await restClient.put('/api/settings/currencies', {
    home_currency: 'USD',
    currencies: [],
  });
});
