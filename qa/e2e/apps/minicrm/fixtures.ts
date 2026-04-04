/**
 * MiniCRM app-level Playwright fixtures.
 *
 * Extends the framework's merged test object with MiniCRM-specific fixtures:
 * - `testData` — a TestDataManager instance scoped per test, with teardown
 *   wired into a `finally` block so cleanup always runs, even on test failure.
 *
 * All MiniCRM test specs and behaviors must import `test` and `expect` from
 * here rather than from `@framework/fixtures` or `@playwright/test` directly.
 *
 * Usage:
 * ```ts
 * import { test, expect } from '@apps/minicrm/fixtures.js';
 *
 * test('creates and deletes a contact', async ({ restClient, testData }) => {
 *   const contact = await createTestContact(testData, restClient);
 *   expect(contact.firstName).toBe('Test');
 *   // testData.teardown() is called automatically after the test.
 * });
 * ```
 *
 * MINCRM-129
 */

import { test as baseTest, expect } from '@framework/fixtures/index.js';
import { TestDataManager } from './test-data-manager.js';

export type { TeardownResult } from './test-data-manager.js';

// ---------------------------------------------------------------------------
// Fixture type
// ---------------------------------------------------------------------------

/**
 * MiniCRM-specific fixtures added by this module.
 */
export interface MinicrmFixtures {
  /**
   * TestDataManager instance scoped per test.
   *
   * Setup helpers register created entity IDs here; the fixture tears them
   * down automatically after the test body completes (pass or fail).
   */
  testData: TestDataManager;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

/**
 * Playwright test extended with all framework fixtures plus MiniCRM fixtures.
 *
 * Re-exports `expect` unchanged so callers only need one import.
 */
export const test = baseTest.extend<MinicrmFixtures>({
  testData: async ({ restClient }, use) => {
    const manager = new TestDataManager();
    try {
      await use(manager);
    } finally {
      // Teardown always runs — test failure does not skip cleanup.
      // Errors from individual deletes are logged inside teardown() and do
      // not propagate here, so the finally block itself never throws.
      await manager.teardown(restClient);
    }
  },
});

export { expect };
