/**
 * PagedListLayout — Empty-state viewport fill (MINCRM-404)
 *
 * Verifies that when a list page has zero records the list container fills
 * the available viewport height, the empty-state element is visible inside
 * it, and the pagination footer is anchored below the container rather than
 * floating in the middle of the page.
 *
 * Each page under test (Contacts, Accounts, Leads, My Tasks) uses the shared
 * PagedListLayout component introduced in MINCRM-404. Tests do NOT seed any
 * records, relying on the ephemeral test database being clean per-test.
 *
 * Tests run at desktop (1280 × 720) and mobile (393 × 851) viewports to
 * exercise the responsive flex chain at multiple breakpoints.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through @behaviors/* imports
 *
 * MINCRM-404
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import { navigateToContactsOwnedByMe } from '@behaviors/minicrm/contacts.behaviors.js';
import { navigateToAccountsOwnedByMe } from '@behaviors/minicrm/accounts.behaviors.js';
import { navigateToLeadsOwnedByMe } from '@behaviors/minicrm/leads.behaviors.js';
import { navigateToMyTasks } from '@behaviors/minicrm/tasks.behaviors.js';
import { assertEmptyStateContainerFills } from '@behaviors/minicrm/layout.behaviors.js';

// Each test uses its own ephemeral admin — no shared storageState.
test.use({ storageState: { cookies: [], origins: [] } });

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const MOBILE_VIEWPORT = { width: 393, height: 851 };

// The list container must render taller than this after the fix.
// 200 px is well below any realistic viewport-filling height and well above
// the collapsed content-only height that the original bug produced.
const MIN_FILL_PX = 200;

test.beforeEach(async ({ restClient, page }) => {
  await loginAsAdmin(restClient);
  await withFlags(page, { tasks: true });
});

// ===========================================================================
// Contacts — empty-state viewport fill
// ===========================================================================

test.describe('Contacts page — empty-state viewport fill', () => {
  test(
    '@functional F-PLL-C1: contacts empty state fills the list container at desktop viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToContactsOwnedByMe({ page });
      const result = await assertEmptyStateContainerFills('contacts-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );

  test(
    '@functional F-PLL-C2: contacts empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await navigateToContactsOwnedByMe({ page });
      const result = await assertEmptyStateContainerFills('contacts-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );
});

// ===========================================================================
// Accounts — empty-state viewport fill
// ===========================================================================

test.describe('Accounts page — empty-state viewport fill', () => {
  test(
    '@functional F-PLL-A1: accounts empty state fills the list container at desktop viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToAccountsOwnedByMe({ page });
      const result = await assertEmptyStateContainerFills('accounts-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );

  test(
    '@functional F-PLL-A2: accounts empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await navigateToAccountsOwnedByMe({ page });
      const result = await assertEmptyStateContainerFills('accounts-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );
});

// ===========================================================================
// Leads — empty-state viewport fill
// ===========================================================================

test.describe('Leads page — empty-state viewport fill', () => {
  test(
    '@functional F-PLL-L1: leads empty state fills the list container at desktop viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToLeadsOwnedByMe({ page });
      const result = await assertEmptyStateContainerFills('leads-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );

  test(
    '@functional F-PLL-L2: leads empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await navigateToLeadsOwnedByMe({ page });
      const result = await assertEmptyStateContainerFills('leads-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );
});

// ===========================================================================
// My Tasks — empty-state viewport fill
// ===========================================================================

test.describe('My Tasks page — empty-state viewport fill', () => {
  test(
    '@functional F-PLL-T1: my tasks empty state fills the list container at desktop viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToMyTasks({ page });
      const result = await assertEmptyStateContainerFills('my-tasks-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );

  test(
    '@functional F-PLL-T2: my tasks empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await navigateToMyTasks({ page });
      const result = await assertEmptyStateContainerFills('my-tasks-empty-state', { page });
      expect(
        result.containerHeight,
        `list container must be at least ${MIN_FILL_PX}px tall — got ${result.containerHeight}px (MINCRM-404 regression)`,
      ).toBeGreaterThan(MIN_FILL_PX);
      expect(result.emptyStateVisible, 'empty-state element must be visible').toBe(true);
    },
  );
});
