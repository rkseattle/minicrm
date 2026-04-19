/**
 * healPage fixture — exposes HealingLocator through Playwright's fixture system.
 *
 * Provides zero-boilerplate access to self-healing interactions from any test
 * spec or behavior file. The fixture teardown always flushes HealingRegistry,
 * even when the test throws.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '@framework/fixtures';
 *
 * test('example', async ({ healPage }) => {
 *   await healPage.click(
 *     [{ type: 'testId', value: 'submit-btn' }],
 *   );
 * });
 * ```
 *
 * MINCRM-126, MINCRM-209
 */

import { test as base } from '@playwright/test';
import { HealingRegistry } from '../healing/index.js';
import type { PageFacade } from '../types/page-facade.js';
import { createPageFacade } from '../types/page-facade.js';
import { buildHealPage } from './heal-methods.js';

export type { LocateOptions, HealMethods, HealPage } from './heal-methods.js';
export { buildHealPage } from './heal-methods.js';
import type { HealMethods } from './heal-methods.js';

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

/** Fixtures added by this module. */
interface HealPageFixtures {
  healPage: HealMethods;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

/**
 * Playwright test extended with the `healPage` and `pageFacade` fixtures.
 *
 * Import `test` and `expect` from `@framework/fixtures` rather than
 * `@playwright/test` in all application spec and behavior files.
 */
export const test = base.extend<HealPageFixtures & { pageFacade: PageFacade }>({
  healPage: async ({ page }, use, testInfo) => {
    const healPage = buildHealPage(page, testInfo.title);

    try {
      await use(healPage);
    } finally {
      // Always flush the registry, even on test failure or unhandled throw.
      HealingRegistry.instance.flush();
      HealingRegistry.instance._reset();
    }
  },

  pageFacade: async ({ page }, use, testInfo) => {
    const facade = createPageFacade(page, testInfo.title);
    try {
      await use(facade);
    } finally {
      HealingRegistry.instance.flush();
      HealingRegistry.instance._reset();
    }
  },
});
