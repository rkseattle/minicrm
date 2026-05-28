/**
 * MiniCRM app-level Playwright fixtures.
 *
 * Extends the framework's merged test object with MiniCRM-specific fixtures:
 * - `testData` — a TestDataManager instance scoped per test, with teardown
 *   wired into a `finally` block so cleanup always runs, even on test failure.
 * - `ephemeralRep` — creates a unique rep user per test and returns credentials.
 *   Tests authenticate the browser via loginViaBrowser(). (MINCRM-415)
 * - `ephemeralAdmin` — same as ephemeralRep but with role='admin'. (MINCRM-415)
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
 *
 * // Per-test ephemeral user (MINCRM-415):
 * test('rep sees their own data', async ({ page, testData, restClient, ephemeralRep }) => {
 *   await loginViaBrowser(ephemeralRep.email, ephemeralRep.password, { page });
 *   // ... test as a unique rep, browser and restClient are isolated
 * });
 * ```
 *
 * MINCRM-129, MINCRM-415
 */

import { test as baseTest, expect } from '@framework/fixtures/index.js';
import { TestDataManager } from './test-data-manager.js';
import { createTestRep, createTestAdmin } from './helpers.js';
import type { EphemeralUserCredentials } from './helpers.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import './locale.js';

export type { TeardownResult } from './test-data-manager.js';
export type { EphemeralUserCredentials };

// ---------------------------------------------------------------------------
// Fixture types
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

  /**
   * Credentials for a unique ephemeral rep user created for this test.
   *
   * The user has onboarding suppressed and is deactivated in teardown.
   * Use loginViaBrowser(ephemeralRep.email, ephemeralRep.password, { page })
   * to authenticate the browser as this user. (MINCRM-415)
   */
  ephemeralRep: EphemeralUserCredentials;

  /**
   * Credentials for a unique ephemeral admin user created for this test.
   *
   * Identical to ephemeralRep but with role='admin'. Use for tests that
   * exercise admin-only functionality. (MINCRM-415)
   */
  ephemeralAdmin: EphemeralUserCredentials;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

const testWithData = baseTest.extend<Pick<MinicrmFixtures, 'testData'>>({
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

/**
 * Playwright test extended with all framework fixtures plus MiniCRM fixtures.
 *
 * Re-exports `expect` unchanged so callers only need one import.
 */
export const test = testWithData.extend<Omit<MinicrmFixtures, 'testData'>>({
  ephemeralRep: async ({ testData, restClient }, use) => {
    // Ensure restClient is authenticated as admin before creating the user.
    await loginAsAdmin(restClient);
    const creds = await createTestRep(testData, restClient);
    await use(creds);
  },

  ephemeralAdmin: async ({ testData, restClient }, use) => {
    await loginAsAdmin(restClient);
    const creds = await createTestAdmin(testData, restClient);
    await use(creds);
  },
});

export { expect };
