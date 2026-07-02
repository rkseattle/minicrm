/**
 * F7-SA — AI stage advancement suggestion (MINCRM-443)
 *
 * Functional regression tests for the passive "Ready to advance?" indicator
 * on the deal detail page.
 *
 * Test groups:
 *   F7-SA1 — No indicator is shown for a newly created deal (E2E stub always
 *            reports not-ready, so this also covers the default/steady state)
 *   F7-SA2 — The indicator is hidden when the ai_stage_advancement flag is off
 *   F7-SA3 — No indicator is shown for a deal in a terminal stage
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so checkStageAdvancement bypasses the
 *   Anthropic SDK and always returns { ready: false }. The "ready: true"
 *   rendering path (indicator visible, pre-set stage on click) is covered by
 *   the client component test suite (DealDetailPage.test.tsx), which mocks
 *   the HTTP response directly — E2E cannot exercise it without real AI
 *   output. (MINCRM-443)
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
  createTestRep,
  navigateToDeal,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  waitForDealNameHeading,
  isStageAdvancementIndicatorVisible,
} from '@behaviors/minicrm/deals.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-SA1 — No indicator for the E2E stub's default not-ready response
// ---------------------------------------------------------------------------

test(
  'F7-SA1: no indicator is shown when the AI check reports not ready (E2E stub default)',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `SA1-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `SA1-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await navigateToDeal(page, deal.id);

    await waitForDealNameHeading({ page });
    expect(await isStageAdvancementIndicatorVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-SA2 — Indicator hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-SA2: the indicator is hidden when ai_stage_advancement is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `SA2-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `SA2-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await withFlags(page, { ai_stage_advancement: false });
    await navigateToDeal(page, deal.id);

    await waitForDealNameHeading({ page });
    expect(await isStageAdvancementIndicatorVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-SA3 — No indicator for a deal already in a terminal stage
// ---------------------------------------------------------------------------

test(
  'F7-SA3: no indicator is shown for a deal in a terminal (Closed Won) stage',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `SA3-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `SA3-Deal ${Date.now()}`,
      account_id: account.id,
      stage: 'Closed Won',
      close_date: new Date().toISOString().split('T')[0],
    });

    await navigateToDeal(page, deal.id);

    await waitForDealNameHeading({ page });
    expect(await isStageAdvancementIndicatorVisible({ page })).toBe(false);
  },
);
