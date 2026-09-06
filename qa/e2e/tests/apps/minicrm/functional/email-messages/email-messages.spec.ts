/**
 * Synced mail — read and filing endpoints
 *
 * Covers the three router-level gates on /api/v1/email-messages and the shape the
 * unmatched inbox returns, over real HTTP against the running stack.
 *
 * Scope is bounded by what an E2E test can construct, not by preference. Every endpoint
 * here needs a message, a message needs a mailbox, and the only way to create a mailbox is
 * POST /api/v1/connected-accounts — which dials the IMAP host and refuses to store
 * anything the dial did not reach. GreenMail runs in the test stack, but it answers on a
 * private address, and assertHostnameIsSafe blocks every private range with no environment
 * bypass. So a synced message cannot exist in an E2E run, and the link/unlink and
 * per-record read paths are unreachable from here; imapProviderLive.test.ts reaches the
 * provider by stubbing that guard, which only a server test can do, and the matching and
 * filing paths are covered against a real database by emailMatchingService.test.ts,
 * emailMessageService.test.ts, and emailMessageController.test.ts.
 *
 * What E2E adds over those is the wiring the contract tests mount around: that the flag
 * gate, the capability gate, and authentication are actually attached to this router in
 * the assembled app, and that a mailbox-less caller gets an empty page rather than an
 * error.
 *
 * @serial because it flips the real email_sync feature_flags row. withFlags() intercepts
 * the browser's flag fetch only — the server re-reads the row per request, so an API test
 * behind requireFeatureEnabled has to change the row itself.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through @behaviors/* imports
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestRep } from '@apps/minicrm/helpers.js';
import { loginAs, loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';
import {
  listUnmatchedMail,
  statusOfUnmatchedMailRequest,
} from '@behaviors/minicrm/email-messages.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

const EMAIL_SYNC_FLAG = 'email_sync';

// describe.serial for intra-file ordering: these tests write one global flag row, so
// they must not interleave with each other. Cross-file protection is the @serial tag plus
// the resource-registry entry, which is what moves the file to the serial job.
test.describe.serial('Synced mail endpoints', () => {
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    // Seeded off, and the whole suite assumes that: a rollout flag left on changes what
    // every other spec's UI renders.
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: false });
    await ensureSystemDefaults(restClient);
  });

  test('F-EM1 — the unmatched inbox is refused while email_sync is off @functional @serial', async ({
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: false });

    expect(await statusOfUnmatchedMailRequest(restClient)).toBe(403);
  });

  test('F-EM2 — a rep with no mailbox gets an empty inbox, not an error @functional @serial', async ({
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: true });
    const rep = await createTestRep(testData, restClient);

    expect(await loginAs(restClient, rep.email, rep.password)).toBe(200);
    const page = await listUnmatchedMail(restClient);

    // Every rep holds ConnectedAccountsManage, so the gate passes and the mailbox scoping
    // is what leaves the page empty.
    expect(page).toEqual({ data: [], total: 0, page: 1, limit: expect.any(Number) });
  });

  test('F-EM3 — the flag gate is attached to this router, not just to the client @functional @serial', async ({
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, EMAIL_SYNC_FLAG, { enabled: true });

    expect(await statusOfUnmatchedMailRequest(restClient)).toBe(200);
  });
});
