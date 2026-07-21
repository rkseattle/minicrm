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
import type { Page } from '@playwright/test';
import { HealingRegistry } from '@framework/healing/index.js';
import { createPageFacade } from '@framework/types/page-facade.js';
import type { PageFacade } from '@framework/types/page-facade.js';
import { pullAndSubmitBrowserCoverage } from '@framework/coverageAgent/browser-coverage-agent.js';
import {
  startCoverageSession,
  endCoverageSession,
  recordCoverageSessionDump,
  resolveSessionBuildSha,
  resolveSessionEnvironment,
  CORRELATION_ID_HEADER,
} from '@framework/coverageAgent/coverage-session-control-client.js';
import { RestClient } from '@framework/clients/rest-client.js';
import { request as playwrightRequest } from '@playwright/test';
import { TestDataManager } from './test-data-manager.js';
import { createTestRep, createTestAdmin } from './helpers.js';
import type { EphemeralUserCredentials } from './helpers.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import './locale.js';

/**
 * Per-test frontend coverage granularity (MINCRM-605, MINCRM-607).
 * 'per-run' is handled by coverage-reporter.ts instead — pulling and
 * submitting per test there would double-count against the reporter's
 * single end-of-run dump.
 */
const E2E_COVERAGE_PER_TEST = process.env['E2E_COVERAGE_GRANULARITY'] !== 'per-run';

// File path substrings used to identify page-object frames in the V8 stack
// when inferring heal-event attribution automatically.
const PAGE_OBJECT_PATH_SEGMENTS = ['pages/minicrm'];

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

const testWithPage = baseTest.extend<{ page: PageFacade }>({
  // Override the framework's `page` fixture to wire in page-object path
  // segments for automatic heal-event attribution. Without this, every
  // heal event produced by page objects in pages/minicrm/ is attributed
  // to "Unknown.unknown" because the framework layer has no knowledge of
  // where the app's page objects live.
  page: async ({ page: rawPage }: { page: Page }, use, testInfo) => {
    const facade = createPageFacade(rawPage, testInfo.title, PAGE_OBJECT_PATH_SEGMENTS);

    // Dedicated admin-authenticated client for coverage-session control
    // calls, on its OWN isolated APIRequestContext (its own cookie jar) —
    // deliberately separate from both the test's own `restClient` AND the
    // fixture-provided `request` context restClient wraps. A test may
    // authenticate `restClient` as a non-admin ephemeral user, log out, or
    // re-authenticate at any point during the test body; because RestClient
    // has no cookie jar of its own (it delegates every call straight to the
    // underlying APIRequestContext), a sessionClient sharing that same
    // context would silently inherit whatever auth state the test left it
    // in by the time this fixture's cleanup runs. A fresh newContext() here
    // guarantees sessionClient's own login always wins, regardless of what
    // the test did to its restClient. Session start/end must work
    // regardless (MINCRM-609's "no per-test edits" requirement). Best-effort
    // throughout: absent credentials, a disabled flag, or a down server must
    // never fail the test itself — coverage-session tracking is observability,
    // not a test dependency.
    const sessionRequestContext = E2E_COVERAGE_PER_TEST
      ? await playwrightRequest.newContext().catch(() => undefined)
      : undefined;
    const sessionClient = sessionRequestContext ? new RestClient(sessionRequestContext) : undefined;
    let session: Awaited<ReturnType<typeof startCoverageSession>> | undefined;
    if (E2E_COVERAGE_PER_TEST && sessionClient) {
      session = await loginAsAdmin(sessionClient)
        .then(() =>
          startCoverageSession(sessionClient, {
            label: testInfo.title,
            source: 'automated-e2e',
            buildSha: resolveSessionBuildSha(),
            environment: resolveSessionEnvironment(),
          }),
        )
        .catch(() => undefined);
      if (session) {
        await facade
          .context()
          .setExtraHTTPHeaders({ [CORRELATION_ID_HEADER]: session.correlationId });
      }
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (use as (v: any) => Promise<void>)(facade);
    } finally {
      await facade.unmockAllRoutes();
      HealingRegistry.instance.flush();
      HealingRegistry.instance._reset();

      // MINCRM-605/607: per-test frontend coverage pull+submit. No-ops
      // when the served bundle wasn't built with COVERAGE=true (the
      // common case) or when E2E_COVERAGE_GRANULARITY=per-run (the
      // reporter handles that mode instead — see coverage-reporter.ts).
      // Each test runs in its own fresh browser context (Playwright's
      // default; not overridden anywhere in this framework), so
      // window.__coverage__ always starts empty per test — no explicit
      // reset-at-start is needed to prevent cross-test bleed.
      if (E2E_COVERAGE_PER_TEST && sessionClient) {
        // Submitted via sessionClient (its own isolated, admin-authenticated
        // context — see above), not the test's own restClient — a test may
        // authenticate restClient as a non-admin ephemeral user, log it
        // out, or never authenticate it at all, and
        // POST /api/v1/admin/coverage/dump requires admin. Using restClient
        // here would silently swallow an auth failure (the .catch below)
        // and leave the session with no coverage dump.
        const dump = await pullAndSubmitBrowserCoverage(
          facade,
          sessionClient,
          testInfo.title,
        ).catch(() => undefined);

        // MINCRM-609/610/612: attribute the dump to this test's session (if
        // one started) and close the session out. attempt tracks Playwright
        // retries — testInfo.retry is 0 on the first run, 1+ on each retry —
        // so a flaky test's attempts are distinguishable rather than
        // overwriting one another.
        if (session) {
          if (dump) {
            await recordCoverageSessionDump(sessionClient, session.id, {
              dumpId: dump.dumpId,
              correlationId: session.correlationId,
              testId: testInfo.testId,
              testName: testInfo.title,
              attempt: testInfo.retry + 1,
            }).catch(() => {
              // Attribution must never fail the test itself.
            });
          }
          await endCoverageSession(sessionClient, session.id, session.version).catch(() => {
            // Ending the session must never fail the test itself.
          });
        }
      }

      // Always dispose the isolated request context, even if session setup
      // or teardown above failed — otherwise every test leaks one
      // long-lived connection pool for the lifetime of the worker process.
      await sessionRequestContext?.dispose().catch(() => {
        // Disposal failure must never fail the test itself.
      });
    }
  },
});

const testWithData = testWithPage.extend<Pick<MinicrmFixtures, 'testData'>>({
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
