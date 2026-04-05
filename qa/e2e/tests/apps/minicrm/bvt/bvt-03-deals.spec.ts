/**
 * BVT-03 — Deal Pipeline
 *
 * Smoke-tests the deal pipeline:
 *   1. Create deal + account via API (Prospecting)
 *   2. Open pipeline board → deal is in Prospecting column
 *   3. Advance stage twice: Prospecting → Qualification → Proposal
 *   4. Close deal as Won → deal in Closed Won column
 *   5. Teardown via TestDataManager (surgical — pre-existing count unchanged)
 *
 * Tagged @bvt so the suite can be run in isolation:
 *   npx playwright test --grep @bvt
 *
 * MINCRM-110
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { openDeal, advanceDealStage, closeDealAsWon } from '@behaviors/minicrm/deals.behaviors.js';
import { createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[BVT-03] E2E_ADMIN_PASSWORD is not set');

interface DealListResponse {
  data: unknown[];
  total: number;
}

test('@bvt BVT-03: deal pipeline — create, open, advance, close-won, teardown', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;

  // ── Setup: authenticate REST client ──────────────────────────────────────
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const before = await restClient.get<DealListResponse>('/api/deals');
  const countBefore = before.body.total;

  // Deal requires an account — create both and register both for teardown.
  // Account is registered first so deal (created second) is deleted first.
  const account = await createTestAccount(testData, restClient, {
    name: `BVT3 Account ${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `BVT3 Deal ${Date.now()}`,
    stage: 'Prospecting',
    account_id: account.id,
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // ── 1. Open board → deal in Prospecting ──────────────────────────────────
  const openResult = await openDeal(deal.id, { page, healPage, testName });

  expect(openResult.loaded, 'pipeline board should load').toBe(true);
  expect(openResult.columnSlug, 'deal should start in Prospecting').toBe('prospecting');

  // ── 2. Advance: Prospecting → Qualification ───────────────────────────────
  const step1 = await advanceDealStage(deal.id, 'Qualification', { page, healPage, testName });
  expect(step1.columnSlug, 'deal should be in Qualification after first advance').toBe(
    'qualification',
  );

  // ── 3. Advance: Qualification → Proposal ─────────────────────────────────
  const step2 = await advanceDealStage(deal.id, 'Proposal', { page, healPage, testName });
  expect(step2.columnSlug, 'deal should be in Proposal after second advance').toBe('proposal');

  // ── 4. Close as Won ───────────────────────────────────────────────────────
  const wonResult = await closeDealAsWon(deal.id, { page, healPage, testName });
  expect(wonResult.columnSlug, 'deal should be in Closed Won').toBe('closed-won');

  // ── Teardown + count assertion (AC6) ─────────────────────────────────────
  const teardownResults = await testData.teardown(restClient);
  expect(teardownResults.filter((r) => !r.success)).toHaveLength(0);

  const after = await restClient.get<DealListResponse>('/api/deals');
  expect(after.body.total, 'deal count should return to baseline').toBe(countBefore);
});
