/**
 * F-COACH — AI rep coaching insights
 *
 * Functional regression tests for the manager/admin coaching insights page
 * (/insights/coaching) and the rep-facing "My Performance" dashboard section.
 *
 * Test groups:
 *   F-COACH1 — Admin sees at least one computed insight for a rep who meets
 *              the minimum closed-deal threshold, after a manual "run now"
 *   F-COACH2 — Rep with insufficient closed-deal history sees the
 *              insufficient-data message instead of insights
 *   F-COACH3 — Rep can see their own coaching insights via /insights/coaching/me
 *              (no manager/admin access required for their own data)
 *
 * Notes:
 *   - Does not mutate rep_coaching_scoring_config — the default
 *     min_closed_deals (10) is met by seeding 10 real closed deals via the
 *     REST API instead, so this file needs no @serial tag or config restore.
 *   - The manual "run now" endpoint (POST /api/v1/admin/ai/coaching/run)
 *     returns 202 and computes fire-and-forget — tests poll
 *     GET /api/v1/insights/coaching/:repId via expect(...).toPass() until the
 *     recomputation is reflected, rather than waiting a fixed duration.
 *   - Coaching insights are deterministic/SQL-driven (no Anthropic SDK call
 *     anywhere in this feature — see repCoachingService.ts's doc comment),
 *     so no AI stub/mock is needed.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, createTestRep } from '@apps/minicrm/helpers.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToCoachingInsights,
  waitForCoachingInsightsHeading,
  selectCoachingRep,
  waitForCoachingListOrEmptyState,
  waitForCoachingInsufficientData,
} from '@behaviors/minicrm/coaching.behaviors.js';
import {
  navigateToDashboardAndWait,
  waitForDashboardHeading,
} from '@behaviors/minicrm/setup.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

/** Rep coaching insight response shape — only the fields this spec asserts on. */
interface RepCoachingInsightsResponseShape {
  has_sufficient_data: boolean;
  closed_deal_count: number;
  insights: unknown[];
}

/**
 * Creates `count` closed deals owned by the given rep. createDealHandler
 * always sets owner_id from the authenticated actor (req.user.id) and
 * ignores any owner_id in the request body (same pattern as contact
 * creation — see project_contact_owner_creation memory note), so restClient
 * must already be authenticated as the rep before this is called; it is left
 * authenticated as the rep on return.
 */
async function createClosedDealsForRep(
  testData: TestDataManager,
  restClient: RestClient,
  rep: { email: string; password: string; userId: string },
  accountId: string,
  count: number,
): Promise<void> {
  await loginAs(restClient, rep.email, rep.password);
  for (let i = 0; i < count; i++) {
    const stage = i % 2 === 0 ? 'Closed Won' : 'Closed Lost';
    const response = await restClient.post<{ deal: { id: string } }>('/api/v1/deals', {
      name: `F-COACH Deal ${rep.userId}-${i}`,
      stage,
      value: 25_000 + i * 1_000,
      account_id: accountId,
    });
    testData.register('deal', response.body.deal.id, `/api/v1/deals/${response.body.deal.id}`);
  }
}

/** Triggers the manual rep coaching run and polls until the target rep's insights reflect it. */
async function triggerManualRunAndWaitForRep(
  restClient: RestClient,
  repId: string,
  expectSufficientData: boolean,
): Promise<void> {
  const runResponse = await restClient.post<{ accepted: boolean }>('/api/v1/admin/ai/coaching/run');
  expect(runResponse.status).toBe(202);

  await expect(async () => {
    const result = await restClient.get<RepCoachingInsightsResponseShape>(
      `/api/v1/insights/coaching/${repId}`,
    );
    expect(result.body.has_sufficient_data).toBe(expectSufficientData);
  }).toPass({ timeout: 20_000 });
}

// This file relies on the ai_rep_coaching_insights flag's seeded default
// (enabled: true, migration 153) rather than intercepting it via withFlags() —
// the feature must be reachable via direct REST polling
// (triggerManualRunAndWaitForRep) as well as the browser, and withFlags() only
// intercepts a single Page/BrowserContext's client-side flag fetch.

test('@functional F-COACH1: admin sees a computed coaching insight for a rep who meets the minimum closed-deal threshold', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  const rep = await createTestRep(testData, restClient);

  // Create an account and 10 closed deals for the rep — meets the seeded
  // default min_closed_deals threshold (10) without touching admin config.
  const accountResponse = await restClient.post<{ account: { id: string } }>('/api/v1/accounts', {
    name: `F-COACH1 Account ${Date.now()}`,
  });
  const accountId = accountResponse.body.account.id;
  testData.register('account', accountId, `/api/v1/accounts/${accountId}`);

  await createClosedDealsForRep(testData, restClient, rep, accountId, 10);

  // createClosedDealsForRep leaves restClient authenticated as the rep —
  // the manual run-now endpoint is admin-only.
  await loginAsAdmin(restClient);
  await triggerManualRunAndWaitForRep(restClient, rep.userId, true);

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToCoachingInsights({ page });
  await waitForCoachingInsightsHeading({ page }, 10_000);

  await selectCoachingRep(rep.userId, { page });

  const outcome = await waitForCoachingListOrEmptyState({ page }, 10_000);
  // Ten closed deals (mixed won/lost, with distinct values) always produce at
  // least a stage_conversion_rate or deal_size_distribution row — never both
  // zero — so the list state is the only outcome expected here.
  expect(outcome).toBe('list');
});

test('@functional F-COACH2: a rep below the minimum closed-deal threshold shows the insufficient-data message', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  const rep = await createTestRep(testData, restClient);

  const accountResponse = await restClient.post<{ account: { id: string } }>('/api/v1/accounts', {
    name: `F-COACH2 Account ${Date.now()}`,
  });
  const accountId = accountResponse.body.account.id;
  testData.register('account', accountId, `/api/v1/accounts/${accountId}`);

  // Below the default min_closed_deals (10).
  await createClosedDealsForRep(testData, restClient, rep, accountId, 3);

  // createClosedDealsForRep leaves restClient authenticated as the rep —
  // the manual run-now endpoint is admin-only.
  await loginAsAdmin(restClient);
  await triggerManualRunAndWaitForRep(restClient, rep.userId, false);

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToCoachingInsights({ page });
  await waitForCoachingInsightsHeading({ page }, 10_000);

  await selectCoachingRep(rep.userId, { page });
  await waitForCoachingInsufficientData({ page }, 10_000);
});

test('@functional F-COACH3: a rep can see their own coaching insights via the My Performance dashboard section', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);

  const accountResponse = await restClient.post<{ account: { id: string } }>('/api/v1/accounts', {
    name: `F-COACH3 Account ${Date.now()}`,
  });
  const accountId = accountResponse.body.account.id;
  testData.register('account', accountId, `/api/v1/accounts/${accountId}`);

  await createClosedDealsForRep(testData, restClient, rep, accountId, 10);

  // createClosedDealsForRep leaves restClient authenticated as the rep —
  // the manual run-now endpoint is admin-only.
  await loginAsAdmin(restClient);
  await triggerManualRunAndWaitForRep(restClient, rep.userId, true);

  // Confirm the rep's own /me endpoint reflects the same data the dashboard
  // section reads from — the dashboard section silently renders nothing
  // unless there is at least one outlier insight (MyPerformanceSection's
  // doc comment), which this seeded data is not guaranteed to produce. The
  // REST assertion is the reliable, deterministic verification of the
  // rep-facing read path; the dashboard section's rendering is exercised by
  // CoachingInsightsPage.test.tsx (client unit test) for the outlier case.
  await loginAs(restClient, rep.email, rep.password);
  const meResponse = await restClient.get<RepCoachingInsightsResponseShape>(
    '/api/v1/insights/coaching/me',
  );
  expect(meResponse.status).toBe(200);
  expect(meResponse.body.has_sufficient_data).toBe(true);
  expect(meResponse.body.insights.length).toBeGreaterThan(0);

  await loginViaBrowser(rep.email, rep.password, { page });
  await navigateToDashboardAndWait({ page });
  // The dashboard renders unconditionally regardless of outlier status —
  // confirm the page itself loads for the rep without error before relying
  // on the REST assertion above for the data-shape verification.
  await waitForDashboardHeading({ page }, 10_000);

  // Restore admin auth before the test ends — testData.teardown() deletes
  // registered entities using restClient's current session, and the rep
  // cannot delete the admin-created account.
  await loginAsAdmin(restClient);
});
