/**
 * F7-OB — AI objection pattern matching from won deals (MINCRM-471)
 *
 * Functional regression tests for the objection category badge on the
 * activity timeline (embedded in the deal detail page).
 *
 * Test groups:
 *   F7-OB1 — No objection badge appears for an activity with no notes
 *   F7-OB2 — No objection badge appears when the flag is off
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so classifyActivityObjection's
 *   IS_E2E branch always returns no classification — the badge never
 *   renders in E2E regardless of note content. The badge-rendering and
 *   precedent-panel paths for a real classification are covered by the
 *   client component test suite (ObjectionInsights.test.tsx), which mocks
 *   the HTTP response directly — E2E cannot exercise it without real AI
 *   output. (MINCRM-471)
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Behaviours imported from @behaviors/* only — never @pages/*
 *   - Feature flag UI state controlled via withFlags() route interception only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestAccount,
  createTestDeal,
  createTestActivity,
  createTestRep,
  navigateToDeal,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  isObjectionCategoryBadgeVisible,
  waitForActivityItem,
} from '@behaviors/minicrm/deals.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-OB1 — No badge for an activity with note text (E2E stub always classifies null)
// ---------------------------------------------------------------------------

test(
  'F7-OB1: no objection badge appears on an activity in the E2E stub environment',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `OB1-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `OB1-Deal ${Date.now()}`,
      account_id: account.id,
    });
    const activity = await createTestActivity(testData, restClient, {
      type: 'Call',
      subject: 'Pricing discussion',
      notes: 'Too expensive for our budget.',
      deal_id: deal.id,
    });

    await navigateToDeal(page, deal.id);
    await waitForActivityItem({ page }, activity.id);

    expect(await isObjectionCategoryBadgeVisible({ page }, activity.id)).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-OB2 — No badge when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-OB2: no objection badge appears when ai_objection_pattern_matching is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `OB2-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `OB2-Deal ${Date.now()}`,
      account_id: account.id,
    });
    const activity = await createTestActivity(testData, restClient, {
      type: 'Call',
      subject: 'Pricing discussion',
      notes: 'Too expensive for our budget.',
      deal_id: deal.id,
    });

    await withFlags(page, { ai_objection_pattern_matching: false });
    await navigateToDeal(page, deal.id);
    await waitForActivityItem({ page }, activity.id);

    expect(await isObjectionCategoryBadgeVisible({ page }, activity.id)).toBe(false);
  },
);
