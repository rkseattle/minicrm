/**
 * F7-DH — AI deal health check (MINCRM-442)
 *
 * Functional regression tests for the on-demand "Check health" panel on the
 * deal detail page.
 *
 * Test groups:
 *   F7-DH1 — Running a health check renders the status badge, narrative, and next actions
 *   F7-DH2 — The panel shows an empty state before any check has been run
 *   F7-DH3 — The panel is hidden when the ai_deal_health_check flag is off
 *   F7-DH4 — A rep cannot run a health check on a deal they do not own
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so generateDealHealthCheck bypasses the
 *   Anthropic SDK and returns a deterministic stub assessment. No real tokens
 *   are consumed. (MINCRM-442)
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
  runDealHealthCheck,
  waitForDealHealthResult,
  waitForDealHealthError,
  waitForDealHealthEmptyState,
  waitForDealNameHeading,
  isDealHealthResultVisible,
  isDealHealthHeadingVisible,
} from '@behaviors/minicrm/deals.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F7-DH1 — Running a health check renders status, narrative, and next actions
// ---------------------------------------------------------------------------

test(
  'F7-DH1: running a health check renders the status badge, narrative, and next actions',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DH1-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `DH1-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await navigateToDeal(page, deal.id);

    const result = await runDealHealthCheck({ page });
    expect(result.status).toBe(200);

    await waitForDealHealthResult({ page });
  },
);

// ---------------------------------------------------------------------------
// F7-DH2 — Empty state before any check has been run
// ---------------------------------------------------------------------------

test(
  'F7-DH2: the panel shows an empty state before any check has been run',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DH2-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `DH2-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await navigateToDeal(page, deal.id);

    await waitForDealHealthEmptyState({ page });
    expect(await isDealHealthResultVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-DH3 — Panel hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F7-DH3: the deal health panel is hidden when ai_deal_health_check is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DH3-Acct ${test.info().title}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `DH3-Deal ${Date.now()}`,
      account_id: account.id,
    });

    await withFlags(page, { ai_deal_health_check: false });
    await navigateToDeal(page, deal.id);

    await waitForDealNameHeading({ page });
    expect(await isDealHealthHeadingVisible({ page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F7-DH4 — Ownership enforced on the health-check endpoint
// ---------------------------------------------------------------------------

test(
  'F7-DH4: a rep cannot run a health check on a deal they do not own',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `DH4-Acct ${test.info().title}`,
    });
    // Deal owned by the admin actor (restClient is currently authenticated as admin
    // from beforeEach, before the subsequent loginAs(rep) call below rebinds it).
    await loginAsAdmin(restClient);
    const adminOwnedDeal = await createTestDeal(testData, restClient, {
      name: `DH4-Deal ${Date.now()}`,
      account_id: account.id,
    });

    const rep = await createTestRep(testData, restClient);
    await loginViaBrowser(rep.email, rep.password, { page });
    await loginAs(restClient, rep.email, rep.password);

    await navigateToDeal(page, adminOwnedDeal.id);

    const result = await runDealHealthCheck({ page });
    expect(result.status).toBe(403);

    await waitForDealHealthError({ page });
  },
);
