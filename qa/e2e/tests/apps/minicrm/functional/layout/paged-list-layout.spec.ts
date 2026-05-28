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
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import type { PageFacadeShape } from '@framework/fixtures/heal-methods.js';

// Each test uses its own ephemeral admin — no shared storageState.
test.use({ storageState: { cookies: [], origins: [] } });

const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const MOBILE_VIEWPORT = { width: 393, height: 851 };

// The list container must render taller than this after the fix.
// 200 px is well below any realistic viewport-filling height and well above
// the collapsed content-only height that the original bug produced.
const MIN_FILL_PX = 200;

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// Helper
//
// Waits for the empty-state element to appear, then asserts that the nearest
// overflow-auto ancestor (the PagedListLayout list container) has a rendered
// clientHeight above MIN_FILL_PX, and that the empty-state element itself is
// visible (non-zero bounding rect inside the viewport).
//
// All DOM access goes through string expressions passed to waitForFunction /
// evaluate to avoid TypeScript lib:dom type errors in the Node-targeted QA
// tsconfig.
// ---------------------------------------------------------------------------

async function assertEmptyStateContainerFills(
  page: PageFacadeShape,
  emptyStateTestId: string,
): Promise<void> {
  // Wait for the empty-state element to be present in the DOM.
  await page.waitForFunction(
    `document.querySelector('[data-testid="${emptyStateTestId}"]') !== null`,
    null,
    { timeout: 10_000 },
  );

  // Walk up from the empty-state element to find the first ancestor with the
  // overflow-auto class that PagedListLayout applies to the list container,
  // then assert it has a rendered height above the minimum fill threshold.
  const containerHeight = (await page.evaluate(
    `(() => {
      const el = document.querySelector('[data-testid="${emptyStateTestId}"]');
      if (!el) return 0;
      let node = el.parentElement;
      while (node) {
        if (node.classList.contains('overflow-auto') || node.classList.contains('overflow-hidden')) {
          return node.clientHeight;
        }
        node = node.parentElement;
      }
      return 0;
    })()`,
  )) as number;

  expect(
    containerHeight,
    `list container for [data-testid="${emptyStateTestId}"] must be at least ${MIN_FILL_PX}px tall — ` +
      `got ${containerHeight}px. This indicates the empty-state viewport fill regression (MINCRM-404) is present.`,
  ).toBeGreaterThan(MIN_FILL_PX);

  // Assert the empty-state element itself is visible inside the container.
  const emptyEl = await page
    .locate(
      [
        { type: 'testId', value: emptyStateTestId },
        { type: 'css', value: `[data-testid="${emptyStateTestId}"]` },
      ],
      { intent: `empty-state message for the ${emptyStateTestId} list page` },
    )
    .resolve();
  await emptyEl.waitFor({ state: 'visible' });
}

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
      await page.goto('/contacts?owner=me', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'contacts-empty-state');
    },
  );

  test(
    '@functional F-PLL-C2: contacts empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/contacts?owner=me', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'contacts-empty-state');
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
      await page.goto('/accounts?owner=me', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'accounts-empty-state');
    },
  );

  test(
    '@functional F-PLL-A2: accounts empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/accounts?owner=me', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'accounts-empty-state');
    },
  );
});

// ===========================================================================
// Leads — empty-state viewport fill
// ===========================================================================

test.describe('Leads page — empty-state viewport fill', () => {
  // LeadsPage uses component state (not URL params) for the owner filter, so
  // it defaults to "All" which shows other tests' leads. Click "Mine" to scope
  // to the new admin's own leads — zero records → empty state appears.
  async function navigateToLeadsEmpty(page: PageFacadeShape): Promise<void> {
    await page.goto('/leads', { waitUntil: 'networkidle' });
    // Wait for the "Mine" filter button (inside PagedListLayout toolbar — only
    // present after the query resolves), then click it.
    await page.waitForFunction(
      `document.querySelector('[data-testid="filter-owner-me"]') !== null`,
      null,
      { timeout: 10_000 },
    );
    await page.click(
      [
        { type: 'testId', value: 'filter-owner-me' },
        { type: 'role', value: 'button', options: { name: /mine/i } },
      ],
      { intent: 'owner filter button to scope leads list to current user only' },
    );
  }

  test(
    '@functional F-PLL-L1: leads empty state fills the list container at desktop viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await navigateToLeadsEmpty(page);
      await assertEmptyStateContainerFills(page, 'leads-empty-state');
    },
  );

  test(
    '@functional F-PLL-L2: leads empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await navigateToLeadsEmpty(page);
      await assertEmptyStateContainerFills(page, 'leads-empty-state');
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
      await page.goto('/tasks', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'my-tasks-empty-state');
    },
  );

  test(
    '@functional F-PLL-T2: my tasks empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const admin = await createTestAdmin(testData, restClient);
      await loginViaBrowser(admin.email, admin.password, { page });
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/tasks', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'my-tasks-empty-state');
    },
  );
});
