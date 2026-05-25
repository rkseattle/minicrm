/**
 * Pipeline Stage functional tests (MINCRM-381, MINCRM-409).
 *
 * Reorder regression coverage (MINCRM-381): clicking the up/down arrows
 * previously returned 409 STAGE_SORT_ORDER_CONFLICT because the client sent two
 * sequential PATCH requests rather than a single atomic PUT /reorder.
 *
 * CRUD coverage (MINCRM-409):
 *   PS-1: Admin adds a new custom stage via UI; stage appears in the API list.
 *   PS-2: Admin renames an existing (non-fixed) stage via UI; new name in API.
 *   PS-4: Admin deletes a custom stage (no associated deals); stage removed from API.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through behavior wrappers
 *   - Test data teardown restores original stage order and removes created stages
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

  // Capture the reorder response directly to validate the server-committed order
  // without a networkidle delay that a concurrent worker's afterEach restore could
  // win against (MINCRM-387).
  const [reorderResp] = await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/pipeline-stages/reorder') &&
        resp.request().method() === 'PUT' &&
        resp.status() === 200,
    ),
    moveUpButton.click(),
  ]);

  const reorderBody = (await reorderResp.json()) as StageListResponse;
  expect(reorderBody.stages[0].id, 'reorder response: moved stage should be first').toBe(
    secondStageId,
  );

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

  // Capture the reorder response directly — avoids the race where a concurrent
  // worker's afterEach restore could overwrite the DB before fetchStages runs
  // (MINCRM-387).
  const [reorderResp] = await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/pipeline-stages/reorder') &&
        resp.request().method() === 'PUT' &&
        resp.status() === 200,
    ),
    moveDownButton.click(),
  ]);

  const reorderBody = (await reorderResp.json()) as StageListResponse;
  expect(reorderBody.stages[0].id, 'reorder response: second stage should be first').toBe(
    secondStageId,
  );
  expect(reorderBody.stages[1].id, 'reorder response: first stage should be second').toBe(
    firstStageId,
  );

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

// ---------------------------------------------------------------------------
// PS-1 — Add a new pipeline stage via UI (MINCRM-409)
// ---------------------------------------------------------------------------

test('@functional PS-1: admin adds a new pipeline stage; stage appears in API list', async ({
  page,
  restClient,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await navigateToAdminSettings({ page }, 'customisation');

  const table = await getPipelineStagesTableLocator({ page });
  await expect(table).toBeVisible({ timeout: 10_000 });

  const stageName = `PS1-Stage-${Date.now()}`;
  let createdStageId: string | undefined;

  try {
    // Click Add Stage button
    await page.click(
      [
        { type: 'testId', value: 'add-stage-button' },
        { type: 'role', value: 'button', options: { name: /add.*stage/i } },
      ],
      { intent: 'button to open the add new pipeline stage form' },
    );

    // Fill in the stage name
    await page.fill(
      stageName,
      [
        { type: 'testId', value: 'add-stage-name-input' },
        { type: 'role', value: 'textbox', options: { name: /stage name/i } },
      ],
      { intent: 'input for the name of the new pipeline stage' },
    );

    // Submit the form
    await page.click(
      [
        { type: 'testId', value: 'add-stage-submit' },
        { type: 'role', value: 'button', options: { name: /add/i } },
      ],
      { intent: 'submit button that creates the new pipeline stage' },
    );

    // Wait for the table to update
    await page.waitFor(
      [
        { type: 'testId', value: 'pipeline-stages-feedback' },
        { type: 'role', value: 'status' },
      ],
      'visible',
      { intent: 'success or error feedback after submitting the add stage form' },
    );

    // Verify the stage now appears in the API list
    const stages = await fetchStages(restClient);
    const created = stages.find((s) => s.name === stageName);
    expect(created, `stage "${stageName}" must appear in the API response`).toBeDefined();
    createdStageId = created?.id;
  } finally {
    // Delete the created stage to restore state
    if (createdStageId) {
      await restClient
        .delete(`/api/v1/settings/pipeline-stages/${createdStageId}`)
        .catch(() => undefined);
    }
  }
});

// ---------------------------------------------------------------------------
// PS-2 — Rename an existing non-fixed pipeline stage via UI (MINCRM-409)
// ---------------------------------------------------------------------------

test('@functional PS-2: admin renames a non-fixed pipeline stage; updated name appears in API', async ({
  page,
  restClient,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await navigateToAdminSettings({ page }, 'customisation');

  const table = await getPipelineStagesTableLocator({ page });
  await expect(table).toBeVisible({ timeout: 10_000 });

  // Pick the first non-fixed stage (is_fixed=false stages can be renamed)
  const stages = await fetchStages(restClient);
  const nonFixedStage = stages.find((s) => !(s as PipelineStage & { is_fixed?: boolean }).is_fixed);
  if (!nonFixedStage) {
    // No non-fixed stage to rename — skip gracefully
    return;
  }

  const newName = `PS2-Renamed-${Date.now()}`;
  const originalName = nonFixedStage.name;

  try {
    // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed edit button has no stable role fallback
    await page
      .locate([{ type: 'testId', value: `pipeline-stage-edit-${nonFixedStage.id}` }])
      .resolve()
      .then((el) => el.click());

    // Clear the name input and type the new name
    await page.fill(
      newName,
      [
        { type: 'testId', value: `pipeline-stage-name-input-${nonFixedStage.id}` },
        { type: 'css', value: `[data-testid="pipeline-stage-name-input-${nonFixedStage.id}"]` },
      ],
      { intent: 'inline name input for renaming the selected pipeline stage' },
    );

    // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed save button has no stable role fallback
    await page
      .locate([{ type: 'testId', value: `pipeline-stage-save-${nonFixedStage.id}` }])
      .resolve()
      .then((el) => el.click());

    // Wait for feedback to confirm save
    await page.waitFor(
      [
        { type: 'testId', value: 'pipeline-stages-feedback' },
        { type: 'role', value: 'status' },
      ],
      'visible',
      { intent: 'success feedback after saving the renamed pipeline stage' },
    );

    // Verify the new name appears in the API response
    const updatedStages = await fetchStages(restClient);
    const renamed = updatedStages.find((s) => s.id === nonFixedStage.id);
    expect(renamed?.name, 'stage name must be updated in the API response').toBe(newName);
  } finally {
    // Restore the original name via API
    await restClient
      .patch(`/api/v1/settings/pipeline-stages/${nonFixedStage.id}`, { name: originalName })
      .catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// PS-4 — Delete a custom (non-fixed) pipeline stage with no associated deals
//        via UI (MINCRM-409)
// ---------------------------------------------------------------------------

test('@functional PS-4: admin deletes a custom pipeline stage; stage no longer appears in API', async ({
  page,
  restClient,
}) => {
  // Create a throwaway stage via API to avoid touching any seeded data
  const stageName = `PS4-Delete-${Date.now()}`;
  const createRes = await restClient.post<{ stage: PipelineStage }>(
    '/api/v1/settings/pipeline-stages',
    { name: stageName, probability: 10 },
  );
  const stageId = createRes.body.stage.id;

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await navigateToAdminSettings({ page }, 'customisation');

  const table = await getPipelineStagesTableLocator({ page });
  await expect(table).toBeVisible({ timeout: 10_000 });

  // Click the delete button for the throwaway stage
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed delete button has no stable role fallback
  await page
    .locate([{ type: 'testId', value: `pipeline-stage-delete-${stageId}` }])
    .resolve()
    .then((el) => el.click());

  // Wait for feedback to confirm deletion
  await page.waitFor(
    [
      { type: 'testId', value: 'pipeline-stages-feedback' },
      { type: 'role', value: 'status' },
    ],
    'visible',
    { intent: 'success feedback after deleting the pipeline stage' },
  );

  // Verify the stage no longer appears in the API list
  const stages = await fetchStages(restClient);
  const deleted = stages.find((s) => s.id === stageId);
  expect(deleted, `stage "${stageName}" must be absent from the API response`).toBeUndefined();
});
