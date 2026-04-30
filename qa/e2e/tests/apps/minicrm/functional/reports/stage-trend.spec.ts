/**
 * Stage trend report functional tests (MINCRM-284).
 *
 * Tests that an authenticated user can view the stage trend report page,
 * interact with the date range filter, and see the expected UI elements.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - data-testid selectors only
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[stage-trend-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Setup — log in as admin once before all tests
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Stage trend report page — presence and basic interaction
// ---------------------------------------------------------------------------

test('stage trend report page renders heading and filter @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  const heading = await page
    .locate([{ type: 'testId', value: 'stage-trend-report-heading' }])
    .resolve();
  await expect(heading).toBeVisible({ timeout: 10_000 });

  const daysSelect = await page.locate([{ type: 'testId', value: 'days-select' }]).resolve();
  await expect(daysSelect).toBeVisible();
});

test('stage trend report shows table or empty state after load @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  // Wait for the loading indicator to disappear
  await page
    .locate([{ type: 'testId', value: 'report-loading' }])
    .resolve()
    .catch(() => null);

  // Either a table or the empty state must be visible
  const tableVisible = await page
    .locate([{ type: 'testId', value: 'stage-trend-table' }])
    .resolve()
    .then((el) => el.isVisible())
    .catch(() => false);

  const emptyVisible = await page
    .locate([{ type: 'testId', value: 'stage-trend-empty' }])
    .resolve()
    .then((el) => el.isVisible())
    .catch(() => false);

  expect(tableVisible || emptyVisible).toBe(true);
});

test('changing date range to 60 days updates the select @functional', async ({ page }) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/reports/stage-trend', { waitUntil: 'networkidle' });

  const daysSelect = await page.locate([{ type: 'testId', value: 'days-select' }]).resolve();
  await expect(daysSelect).toBeVisible({ timeout: 10_000 });
  await daysSelect.selectOption('60');
  await expect(daysSelect).toHaveValue('60');
});
