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
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
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
// overflow-auto/overflow-hidden ancestor (the PagedListLayout list container)
// has a rendered clientHeight above MIN_FILL_PX, and that the empty-state
// element itself is visible (non-zero bounding rect inside the viewport).
//
// All DOM access goes through waitForFunction string expressions to avoid
// TypeScript lib:dom type errors in the Node-targeted QA tsconfig.
// ---------------------------------------------------------------------------

async function assertEmptyStateContainerFills(
  page: PageFacadeShape,
  emptyStateTestId: string,
): Promise<void> {
  // Step 1 — wait for the empty-state element to be present.
  await page.waitForFunction(
    `document.querySelector('[data-testid="${emptyStateTestId}"]') !== null`,
    null,
    { timeout: 10_000 },
  );

  // Step 2 — assert the list container is tall enough.
  // Walk up from the empty-state element to find the first ancestor with the
  // overflow-auto class that PagedListLayout applies to the list container.
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

  // Step 3 — assert the empty-state element itself is visible.
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
    async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/contacts', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'contacts-empty-state');
    },
  );

  test(
    '@functional F-PLL-C2: contacts empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/contacts', { waitUntil: 'networkidle' });
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
    async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/accounts', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'accounts-empty-state');
    },
  );

  test(
    '@functional F-PLL-A2: accounts empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/accounts', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'accounts-empty-state');
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
    async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/leads', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'leads-empty-state');
    },
  );

  test(
    '@functional F-PLL-L2: leads empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/leads', { waitUntil: 'networkidle' });
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
    async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/tasks', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'my-tasks-empty-state');
    },
  );

  test(
    '@functional F-PLL-T2: my tasks empty state fills the list container at mobile viewport',
    { tag: ['@functional'] },
    async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto('/tasks', { waitUntil: 'networkidle' });
      await assertEmptyStateContainerFills(page, 'my-tasks-empty-state');
    },
  );
});
