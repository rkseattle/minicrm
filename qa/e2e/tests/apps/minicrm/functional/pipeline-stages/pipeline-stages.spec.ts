/**
 * Pipeline Stage Reorder functional tests (MINCRM-381)
 *
 * Regression coverage for the atomic reorder bug: clicking the up/down arrows
 * previously returned 409 STAGE_SORT_ORDER_CONFLICT because the client sent two
 * sequential PATCH requests rather than a single atomic PUT /reorder.
 *
 * Acceptance criteria tested:
 *   - Clicking move-up reorders the stage successfully with no 409 error
 *   - Clicking move-down reorders the stage successfully with no 409 error
 *   - The updated sort order is reflected immediately in the UI via API check
 *   - The first-stage move-up button is disabled (boundary guard)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through behavior wrappers
 *   - Test data teardown restores original stage order after each test
 *
 * MINCRM-381
 */

import { test, expect } from '@apps/minicrm/fixtures.js';

// Pipeline stage reorder tests mutate shared global state (sort_order column).
// Serial mode ensures no two tests race on the same shared rows simultaneously.
test.describe.configure({ mode: 'serial' });

import { loginAsAdmin, login } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  getPipelineStagesTableLocator,
  getPipelineStageMoveUpLocator,
  getPipelineStageMoveDownLocator,
} from '@behaviors/minicrm/settings.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[pipeline-stages-spec] E2E_ADMIN_PASSWORD is not set');

// Admin settings page with live pipeline stage interactions is heavier than
// typical functional tests — allow 60 s per test.
test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineStage {
  id: string;
  name: string;
  sort_order: number;
}

interface StageListResponse {
  stages: PipelineStage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchStages(restClient: RestClient): Promise<PipelineStage[]> {
  const res = await restClient.get<StageListResponse>('/api/v1/settings/pipeline-stages');
  return res.body.stages;
}

// ---------------------------------------------------------------------------
// Setup/Teardown — restore original stage order to prevent bleed-through
// ---------------------------------------------------------------------------

let originalOrder: string[] = [];

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  const stages = await fetchStages(restClient);
  originalOrder = stages.map((s) => s.id);
});

test.afterEach(async ({ restClient }) => {
  if (originalOrder.length > 0) {
    await restClient
      .put('/api/v1/settings/pipeline-stages/reorder', { stages: originalOrder })
      .catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@functional MINCRM-381-1: move-up reorders stage atomically — no 409, new order persists via API', async ({
  page,
  restClient,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await navigateToAdminSettings({ page }, 'customisation');

  const table = await getPipelineStagesTableLocator({ page });
  await expect(table).toBeVisible({ timeout: 10_000 });

  const stagesBefore = await fetchStages(restClient);
  expect(stagesBefore.length).toBeGreaterThanOrEqual(2);

  const secondStageId = stagesBefore[1].id;

  const moveUpButton = await getPipelineStageMoveUpLocator({ page }, secondStageId);
  await expect(moveUpButton).toBeEnabled();
  await moveUpButton.click();

  await page.waitForLoadState('networkidle');

  const stagesAfter = await fetchStages(restClient);
  expect(stagesAfter[0].id, 'stage moved up should now be first').toBe(secondStageId);
});

test('@functional MINCRM-381-2: move-down reorders stage atomically — no 409, new order persists via API', async ({
  page,
  restClient,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await navigateToAdminSettings({ page }, 'customisation');

  const table = await getPipelineStagesTableLocator({ page });
  await expect(table).toBeVisible({ timeout: 10_000 });

  const stagesBefore = await fetchStages(restClient);
  expect(stagesBefore.length).toBeGreaterThanOrEqual(2);

  const firstStageId = stagesBefore[0].id;
  const secondStageId = stagesBefore[1].id;

  const moveDownButton = await getPipelineStageMoveDownLocator({ page }, firstStageId);
  await expect(moveDownButton).toBeEnabled();
  await moveDownButton.click();

  await page.waitForLoadState('networkidle');

  const stagesAfter = await fetchStages(restClient);
  expect(stagesAfter[0].id, 'second stage should now be first').toBe(secondStageId);
  expect(stagesAfter[1].id, 'first stage should now be second').toBe(firstStageId);
});

test('@functional MINCRM-381-3: move-up button is disabled for the first stage', async ({
  page,
  restClient,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await navigateToAdminSettings({ page }, 'customisation');

  const table = await getPipelineStagesTableLocator({ page });
  await expect(table).toBeVisible({ timeout: 10_000 });

  const stagesBefore = await fetchStages(restClient);
  const firstStageId = stagesBefore[0].id;

  const moveUpButton = await getPipelineStageMoveUpLocator({ page }, firstStageId);
  await expect(moveUpButton).toBeDisabled();
});
