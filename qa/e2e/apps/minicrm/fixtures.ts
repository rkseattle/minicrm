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

import path from 'node:path';
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
import { loginAsAdmin, refreshAdminBrowserSession } from '@behaviors/minicrm/auth.behaviors.js';
import './locale.js';

/**
 * Per-test frontend coverage granularity (MINCRM-605, MINCRM-607).
 * 'per-run' is handled by coverage-reporter.ts instead — pulling and
 * submitting per test there would double-count against the reporter's
 * single end-of-run dump.
 */
const E2E_COVERAGE_PER_TEST = process.env['E2E_COVERAGE_GRANULARITY'] !== 'per-run';

// Repo root for normalizing testInfo.file to the same repo-root-relative
// convention timing-reporter.ts uses for test-timing-baseline.json's keys
// (path.relative(REPO_ROOT, ...)) — so a selected testId's testFile can feed
// gen-shards.ts with no further path translation. __dirname is this file:
// qa/e2e/apps/minicrm/. (MINCRM-660 groundwork)
const REPO_ROOT = path.resolve(__dirname, '../../../..');

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

/**
 * Fraction of a token's remaining life below which it is refreshed.
 *
 * The session JWT has a 30-minute sliding idle expiry, so a third of its life is
 * a 10-minute floor — comfortably longer than any single test, and short enough
 * that the refresh almost never fires in a normal-length run.
 */
const TOKEN_REFRESH_THRESHOLD = 1 / 3;

/**
 * Returns true when a JWT is inside the last third of its lifetime, or when its
 * expiry cannot be read.
 *
 * Unreadable is treated as nearing expiry deliberately: a token this cannot
 * parse is one it cannot vouch for, and a needless refresh is far cheaper than a
 * test that silently runs against the login page. (MINCRM-697)
 *
 * @param token - The raw JWT from the auth cookie.
 * @returns Whether the token should be refreshed before the test runs.
 */
function isTokenNearingExpiry(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iat?: number;
      exp?: number;
    };
    if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') return true;
    const lifetimeSeconds = claims.exp - claims.iat;
    if (lifetimeSeconds <= 0) return true;
    const remainingSeconds = claims.exp - Math.floor(Date.now() / 1000);
    return remainingSeconds < lifetimeSeconds * TOKEN_REFRESH_THRESHOLD;
  } catch {
    return true;
  }
}

const testWithPage = baseTest.extend<{ page: PageFacade }>({
  // Override the framework's `page` fixture to wire in page-object path
  // segments for automatic heal-event attribution. Without this, every
  // heal event produced by page objects in pages/minicrm/ is attributed
  // to "Unknown.unknown" because the framework layer has no knowledge of
  // where the app's page objects live.
  page: async ({ page: rawPage }: { page: Page }, use, testInfo) => {
    const facade = createPageFacade(rawPage, testInfo.title, PAGE_OBJECT_PATH_SEGMENTS);

    // Refresh the shared admin cookie before the test body runs.
    //
    // The project-level storageState (.auth/admin.json, playwright.config.ts) is
    // minted ONCE by globalSetup at suite start, and its JWT carries a 30-minute
    // SLIDING IDLE expiry (JWT_IDLE_EXPIRY_SECONDS, authController.ts) — the "8
    // hours" in the docs is the absolute cap enforced via the login_at claim, not
    // the token's lifetime. Idle refresh only happens on a context that is
    // actually making requests, so any spec whose first navigation lands more
    // than 30 minutes into a run loads a dead cookie and renders /login. Every
    // locator for app content then fails as "all strategies exhausted", which
    // reads as selector drift rather than an expired session.
    //
    // MINCRM-697: in tia-record-mode.yml (~1300 tests, unsharded, two projects)
    // the mobile-web AI specs first navigated ~1 hour in and did exactly that.
    // ci.yml's e2e-serial job never saw it — it is --project=desktop only and
    // finishes inside the 30-minute window.
    //
    // Fixed HERE rather than per-spec so it covers the class: every spec that
    // inherits the project storageState is protected, including ones added
    // later, and the guarantee does not depend on each author remembering. Specs
    // that opt out via test.use({ storageState: { cookies: [], origins: [] } })
    // are unaffected — they have no shared cookie to refresh and authenticate
    // themselves.
    //
    // Runs BEFORE the coverage session opens below, deliberately: under record
    // mode a login inside the session would attribute the auth endpoint to
    // whichever test is running and pollute the coverage map this refresh exists
    // to make obtainable. Best-effort — a spec that manages its own auth must not
    // fail because this could not reach the server.
    //
    // Gated on the context ALREADY carrying the auth cookie. The ~88 specs using
    // test.use({ storageState: { cookies: [], origins: [] } }) start with an empty
    // jar precisely because they need an unauthenticated browser (auth.spec.ts,
    // password-reset.spec.ts, invite.spec.ts …); injecting an admin cookie into
    // those would silently defeat what they assert. Refreshing a cookie that is
    // already present cannot change which user a test runs as — it only replaces
    // an aging token for the same admin.
    // Only when the existing token is actually close to expiring. Logging in on
    // EVERY test would add a bcrypt hash per test to a single-threaded server —
    // ~20s across a 300-test run at idle, and worse under load, where a bcrypt
    // stall is already the documented cause of the ECONNRESET that loginAsAdmin
    // retries for. Refreshing only inside the last third of the token's life
    // keeps the cost near zero for normal runs while still guaranteeing no test
    // ever starts with a cookie about to die.
    const cookieName = process.env['AUTH_COOKIE_NAME'] ?? 'minicrm_token';
    const existingCookies = await facade
      .context()
      .cookies()
      .catch(() => []);
    const authCookie = existingCookies.find((c) => c.name === cookieName);
    if (authCookie && isTokenNearingExpiry(authCookie.value)) {
      await refreshAdminBrowserSession({ page: facade }).catch(() => undefined);
    }

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
              testFile: path.relative(REPO_ROOT, testInfo.file),
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
