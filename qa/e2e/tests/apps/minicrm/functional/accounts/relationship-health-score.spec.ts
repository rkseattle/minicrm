/**
 * F16-RH — AI relationship health scoring per account (MINCRM-467)
 *
 * Functional regression tests for the passive relationship health badge on
 * the account detail page.
 *
 * Test groups:
 *   F16-RH1 — No badge is shown until the nightly scoring job has run
 *   F16-RH2 — The badge stays hidden when the flag is off
 *
 * Stub note:
 *   Scoring is deterministic/SQL-driven (no LLM call), but only runs via the
 *   nightly cron (computeAccountHealthScores), which is not test-triggerable
 *   within a request/response cycle. Every account stays unscored in E2E, so
 *   no badge renders — matching sentiment-tracking.spec.ts's convention for
 *   nightly-job-gated AI features. The scored-state rendering path is
 *   covered by the client component test suite (AccountDetailPage.test.tsx,
 *   AccountHealthBadge.test.tsx), which mock the HTTP response directly.
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
  createTestRep,
  navigateToAccount,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import { isAccountHealthBadgeVisible } from '@behaviors/minicrm/accounts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

// ---------------------------------------------------------------------------
// F16-RH1 — No badge until the nightly scoring job has run
// ---------------------------------------------------------------------------

test(
  'F16-RH1: no health badge is shown for an account with no computed score',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `RH1 Account ${Date.now()}`,
    });

    await navigateToAccount(page, account.id);

    expect(await isAccountHealthBadgeVisible(account.id, { page })).toBe(false);
  },
);

// ---------------------------------------------------------------------------
// F16-RH2 — Badge hidden when the flag is off
// ---------------------------------------------------------------------------

test(
  'F16-RH2: the relationship health badge stays hidden when ai_relationship_health_score is off',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `RH2 Account ${Date.now()}`,
    });

    await withFlags(page, { ai_relationship_health_score: false });
    await navigateToAccount(page, account.id);

    expect(await isAccountHealthBadgeVisible(account.id, { page })).toBe(false);
  },
);
