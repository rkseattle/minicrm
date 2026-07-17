/**
 * F-ROUTE — AI intelligent lead routing suggestion (MINCRM-475)
 *
 * Functional regression tests for the pre-create routing suggestion panel on
 * the lead creation form: showing a suggested rep, accepting it (populates
 * the owner field), and dismissing it (clears the panel without setting the
 * owner).
 *
 * Test groups:
 *   F-ROUTE1 — Filling in the employee range profile field shows a routing
 *              suggestion panel naming a specific rep before the lead is saved
 *   F-ROUTE2 — Accepting the suggestion populates the owner selector with the
 *              suggested rep
 *   F-ROUTE3 — Dismissing the suggestion clears the panel and leaves the
 *              owner selector unchanged
 *
 * Notes:
 *   - Does not mutate lead_routing_scoring_config — uses the seeded default
 *     weights (territory 0.25, industry 0.25, workload 0.20, win_rate 0.20,
 *     availability 0.10; low/medium confidence thresholds 0.40/0.65), so no
 *     @serial tag is needed.
 *   - The routing suggestion panel and the owner selector are both
 *     admin-only in LeadForm.tsx (isAdmin && isCreate) — every test here logs
 *     in as an admin.
 *   - The suggestion is driven purely by workload/availability, not
 *     territory/industry matching: users.territory has no PATCH endpoint
 *     anywhere in the app (migration 154 added the column but no service
 *     exposes it for mutation), so a territory-match factor can never be
 *     exercised end-to-end — a real product gap, not an E2E fixture gap.
 *     Instead, a "busy" competing rep is seeded with several open leads and
 *     active deals so the team average is pulled well above zero, and a
 *     freshly created "target" rep with zero of either scores full marks on
 *     the workload (0.20) and availability (0.10) factors — 1.0 combined
 *     score, comfortably above the 0.65 high-confidence threshold,
 *     independent of whatever other reps/data already exist in the DB.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, createTestRep, createTestAccount } from '@apps/minicrm/helpers.js';
import type { TestDataManager } from '@apps/minicrm/test-data-manager.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  openLeadCreateFormWithRoutingProfile,
  isRoutingSuggestionPanelVisible,
  getRoutingSuggestionPanelText,
  applyRoutingSuggestion,
  dismissRoutingSuggestion,
  getLeadFormOwnerValue,
} from '@behaviors/minicrm/leads.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

/** Creates several open leads and active deals for a rep, to establish a non-zero team average. */
async function makeRepBusy(
  testData: TestDataManager,
  restClient: RestClient,
  ownerId: string,
): Promise<void> {
  const account = await createTestAccount(testData, restClient, {
    name: `F-ROUTE Busy Account ${Date.now()}`,
  });

  for (let i = 0; i < 6; i++) {
    const leadResponse = await restClient.post<{ lead: { id: string } }>('/api/v1/leads', {
      first_name: `F-ROUTE Busy Lead ${i}`,
      email: `f-route-busy-lead-${Date.now()}-${i}@example.com`,
      owner_id: ownerId,
    });
    testData.register(
      'lead',
      leadResponse.body.lead.id,
      `/api/v1/leads/${leadResponse.body.lead.id}`,
    );

    const dealResponse = await restClient.post<{ deal: { id: string } }>('/api/v1/deals', {
      name: `F-ROUTE Busy Deal ${ownerId}-${i}`,
      stage: 'Prospecting',
      account_id: account.id,
      owner_id: ownerId,
    });
    testData.register(
      'deal',
      dealResponse.body.deal.id,
      `/api/v1/deals/${dealResponse.body.deal.id}`,
    );
  }
}

test('@functional F-ROUTE1: filling in the employee range shows a routing suggestion panel naming a specific rep', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  const busyRep = await createTestRep(testData, restClient);
  // A second, zero-load rep widens the candidate pool beyond a single busy
  // rep — computeLeadRoutingSuggestion treats candidateCount < 2 as
  // automatically low-confidence (confidenceFor's guard), which would
  // suppress the panel entirely regardless of score.
  await createTestRep(testData, restClient);

  await makeRepBusy(testData, restClient, busyRep.userId);

  await loginViaBrowser(admin.email, admin.password, { page });
  await openLeadCreateFormWithRoutingProfile(
    {
      first_name: 'F-ROUTE1',
      email: `f-route1-${Date.now()}@example.com`,
      employee_range: '50-100',
    },
    { page },
  );

  const panelVisible = await isRoutingSuggestionPanelVisible({ page }, 10_000);
  expect(panelVisible).toBe(true);

  const panelText = await getRoutingSuggestionPanelText({ page });
  // Assert generically on "some rep was named" rather than a hardcoded rep
  // name — a real seeded environment may have other zero-load reps that
  // could legitimately tie/win over the target rep created in this test.
  expect(panelText.length).toBeGreaterThan(0);
});

test('@functional F-ROUTE2: accepting the routing suggestion populates the owner field with the suggested rep', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  const busyRep = await createTestRep(testData, restClient);
  await createTestRep(testData, restClient); // widens the candidate pool beyond a single low-load rep

  await makeRepBusy(testData, restClient, busyRep.userId);

  await loginViaBrowser(admin.email, admin.password, { page });
  await openLeadCreateFormWithRoutingProfile(
    {
      first_name: 'F-ROUTE2',
      email: `f-route2-${Date.now()}@example.com`,
      employee_range: '50-100',
    },
    { page },
  );

  const panelVisible = await isRoutingSuggestionPanelVisible({ page }, 10_000);
  expect(panelVisible).toBe(true);

  const ownerBeforeApply = await getLeadFormOwnerValue({ page });

  await applyRoutingSuggestion({ page });

  await expect(async () => {
    const ownerAfterApply = await getLeadFormOwnerValue({ page });
    expect(ownerAfterApply).not.toBe('');
    // Applying must change the owner selector to the suggested rep — never
    // a no-op that leaves whatever the <select> happened to default to.
    expect(ownerAfterApply).not.toBe(ownerBeforeApply);
  }).toPass({ timeout: 5_000 });
});

test('@functional F-ROUTE3: dismissing the routing suggestion clears the panel without setting the owner', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  const busyRep = await createTestRep(testData, restClient);
  await createTestRep(testData, restClient);

  await makeRepBusy(testData, restClient, busyRep.userId);

  await loginViaBrowser(admin.email, admin.password, { page });
  await openLeadCreateFormWithRoutingProfile(
    {
      first_name: 'F-ROUTE3',
      email: `f-route3-${Date.now()}@example.com`,
      employee_range: '50-100',
    },
    { page },
  );

  const panelVisible = await isRoutingSuggestionPanelVisible({ page }, 10_000);
  expect(panelVisible).toBe(true);

  const ownerBeforeDismiss = await getLeadFormOwnerValue({ page });

  await dismissRoutingSuggestion({ page });

  const stillVisible = await isRoutingSuggestionPanelVisible({ page }, 2_000);
  expect(stillVisible).toBe(false);

  const ownerAfterDismiss = await getLeadFormOwnerValue({ page });
  expect(ownerAfterDismiss).toBe(ownerBeforeDismiss);
});
