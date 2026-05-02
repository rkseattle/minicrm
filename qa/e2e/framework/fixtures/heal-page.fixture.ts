/**
 * healPage fixture — exposes HealingLocator through Playwright's fixture system.
 *
 * Also provides the unified `page` fixture (PageFacade) that combines SafePage
 * with HealMethods via a Proxy, making testName implicit.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '@framework/fixtures';
 *
 * test('example', async ({ page }) => {
 *   await page.click([{ type: 'testId', value: 'submit-btn' }]);
 * });
 * ```
 *
 */

import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { HealingRegistry } from '../healing/index.js';
import type { PageFacade } from '../types/page-facade.js';
import { createPageFacade } from '../types/page-facade.js';
import { buildHealPage } from './heal-methods.js';
import type { HealMethods } from './heal-methods.js';

export type { LocateOptions, HealMethods, HealPage } from './heal-methods.js';
export { buildHealPage } from './heal-methods.js';

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

/** Legacy healPage fixture — kept for framework-level unit tests only. */
interface HealPageOnlyFixtures {
  /** @deprecated Use `page` (PageFacade) instead. */
  healPage: HealMethods;
}

// ---------------------------------------------------------------------------
// Step 1: extend base with `healPage` — receives the raw Playwright Page.
// ---------------------------------------------------------------------------

const withHealPage = base.extend<HealPageOnlyFixtures>({
  healPage: async ({ page }, use, testInfo) => {
    const hp = buildHealPage(page, testInfo.title);
    try {
      await use(hp);
    } finally {
      await hp.unmockAllRoutes();
      HealingRegistry.instance.flush();
      HealingRegistry.instance._reset();
    }
  },
});

// ---------------------------------------------------------------------------
// Step 2: extend withHealPage to override `page` with PageFacade.
//
// Playwright passes the raw built-in `page` (Page) into the override
// implementation even though it is being replaced, so rawPage is a Page here.
// The `as any` cast on `use(facade)` is required because TypeScript infers
// `use`'s parameter as `Page` from the built-in fixture definition, while our
// intent is to serve a PageFacade to callers.
// ---------------------------------------------------------------------------

export const test = withHealPage.extend<{ page: PageFacade }>({
  page: async ({ page: rawPage }: { page: Page }, use, testInfo) => {
    const facade = createPageFacade(rawPage, testInfo.title);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (use as (v: any) => Promise<void>)(facade);
    } finally {
      await facade.unmockAllRoutes();
      HealingRegistry.instance.flush();
      HealingRegistry.instance._reset();
    }
  },
});
