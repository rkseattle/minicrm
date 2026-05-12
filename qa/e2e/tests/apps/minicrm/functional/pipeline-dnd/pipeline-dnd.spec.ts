/**
 * F5 — Pipeline Board Drag-and-Drop Stage Transitions
 *
 * Functional regression tests covering the HTML5 drag-and-drop interaction on
 * the desktop pipeline board (Kanban view at /deals). The existing pipeline board
 * tests in leads-opportunities.spec.ts cover the accessible stage-selector
 * dropdown; these tests exercise the drag path specifically.
 *
 * Test groups:
 *   DnD Stage Transitions  — open-to-open drag, drag to terminal stages (F5-DND)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls in this file — all through behaviors
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * MINCRM-300
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { openDeal, dragDealToStage, getDealById } from '@behaviors/minicrm/deals.behaviors.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// DnD Stage Transition tests
//
// Drag-and-drop is a desktop-only interaction. The mobile-web project renders a
// single-stage carousel where cards use the `mobile-deal-card-{id}` testId prefix
// and there are no adjacent columns to drag between. All three tests skip on
// mobile-web to avoid false failures.
// ---------------------------------------------------------------------------

test('@smoke @functional F5-DND1: drag deal card from Prospecting to Qualification → card moves in DOM and stage persists via API', async ({
  page,
  restClient,
  testData,
}) => {
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  test.skip(
    isMobile,
    'F5-DND1: drag-and-drop is desktop-only; mobile uses stage-selector dropdown',
  );

  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F5DND1-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F5DND1-Deal-${Date.now()}`,
    stage: 'Prospecting',
    account_id: account.id,
  });

  // Navigate to board and confirm deal starts in Prospecting.
  const openResult = await openDeal(deal.id, { page });
  expect(openResult.loaded, 'pipeline board should load').toBe(true);
  expect(openResult.columnSlug, 'deal should start in Prospecting column').toBe('prospecting');

  // Drag from Prospecting to Qualification.
  const dragResult = await dragDealToStage(deal.id, 'Qualification', { page });
  expect(dragResult.closeDealModalOpened, 'close deal modal should not open for open stage').toBe(
    false,
  );
  expect(dragResult.columnSlug, 'deal card should appear in Qualification column after drag').toBe(
    'qualification',
  );

  // Confirm stage change persisted via API.
  const detail = await getDealById(restClient, deal.id);
  expect(detail.stage, 'deal stage should be Qualification via API').toBe('Qualification');
});

test('@functional F5-DND2: drag deal card to Closed Won → CloseDealModal opens, confirm closes deal as Won', async ({
  page,
  restClient,
  testData,
}) => {
  // Terminal-drag path includes modal interaction + React Query refetch — needs more than 30s on CI.
  test.setTimeout(60_000);
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  test.skip(
    isMobile,
    'F5-DND2: drag-and-drop is desktop-only; mobile uses stage-selector dropdown',
  );

  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F5DND2-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F5DND2-Deal-${Date.now()}`,
    stage: 'Negotiation',
    account_id: account.id,
  });

  await openDeal(deal.id, { page });

  // Drag to terminal stage — CloseDealModal must open.
  const dragResult = await dragDealToStage(deal.id, 'Closed Won', { page });
  expect(
    dragResult.closeDealModalOpened,
    'CloseDealModal should open when dragging to Closed Won',
  ).toBe(true);
  expect(
    dragResult.columnSlug,
    'deal card should appear in closed-won column after confirmation',
  ).toBe('closed-won');

  // Confirm stage change persisted via API.
  const detail = await getDealById(restClient, deal.id);
  expect(detail.stage, 'deal stage should be Closed Won via API').toBe('Closed Won');
});

test('@functional F5-DND3: drag deal card to Closed Lost → CloseDealModal opens, confirm closes deal as Lost', async ({
  page,
  restClient,
  testData,
}) => {
  // Terminal-drag path includes modal interaction + React Query refetch — needs more than 30s on CI.
  test.setTimeout(60_000);
  const isMobile = (page.viewportSize()?.width ?? 1280) < 768;
  test.skip(
    isMobile,
    'F5-DND3: drag-and-drop is desktop-only; mobile uses stage-selector dropdown',
  );

  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: `F5DND3-Account-${Date.now()}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F5DND3-Deal-${Date.now()}`,
    stage: 'Proposal',
    account_id: account.id,
  });

  await openDeal(deal.id, { page });

  // Drag to terminal stage — CloseDealModal must open.
  const dragResult = await dragDealToStage(deal.id, 'Closed Lost', { page });
  expect(
    dragResult.closeDealModalOpened,
    'CloseDealModal should open when dragging to Closed Lost',
  ).toBe(true);
  expect(
    dragResult.columnSlug,
    'deal card should appear in closed-lost column after confirmation',
  ).toBe('closed-lost');

  // Confirm stage change persisted via API.
  const detail = await getDealById(restClient, deal.id);
  expect(detail.stage, 'deal stage should be Closed Lost via API').toBe('Closed Lost');
});
