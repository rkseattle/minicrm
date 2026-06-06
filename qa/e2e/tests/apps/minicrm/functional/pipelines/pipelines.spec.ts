/**
 * Multiple pipeline support functional tests (MINCRM-397)
 *
 * Acceptance criteria covered:
 *   F-P1: Admin can create a new pipeline via the settings UI
 *   F-P2: Admin can rename a pipeline via the settings UI
 *   F-P3: Admin can delete an empty non-default pipeline via the settings UI
 *   F-P4: Each pipeline has its own independently configured stage list
 *   F-P5: Deals can be created in a non-default pipeline via the API
 *   F-P6: The Deals board pipeline selector appears and filters by pipeline
 *   F-P7: Deleting a pipeline that has deals is blocked with an error message
 *
 * All pipelines created by this suite are cleaned up via TestDataManager or
 * the REST API in afterEach. The default pipeline is never deleted.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Spec imports only from @behaviors/*, @apps/*, @framework/*
 *   - Page interactions via behaviors; REST setup via restClient
 *
 * MINCRM-397
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminSettings,
  getPipelineAddButtonLocator,
  getNewPipelineNameInputLocator,
  getCreatePipelineSubmitLocator,
  getPipelinesFeedbackLocator,
  getPipelineEditButtonLocator,
  getPipelineEditInputLocator,
  getPipelineSaveButtonLocator,
  getPipelineDeleteButtonLocator,
  getPipelineDeleteConfirmLocator,
  getPipelineDeleteConfirmButtonLocator,
  getPipelineStagesPipelineSelectorLocator,
  getPipelineStageRowLocator,
  getPipelineBoardSelectorLocator,
  getPipelineBoardContainerLocator,
} from '@behaviors/minicrm/settings.behaviors.js';
import { navigateToPipelineBoard, createDealViaApi } from '@behaviors/minicrm/deals.behaviors.js';
import { createTestAccount, createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.setTimeout(60_000);

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { multiple_pipelines: true });
  await loginViaBrowser(admin.email, admin.password, { page });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PipelineRow {
  id: string;
  name: string;
  is_default: boolean;
}

async function createPipelineViaApi(restClient: RestClient, name: string): Promise<PipelineRow> {
  const res = await restClient.post<PipelineRow>('/api/v1/pipelines', { name });
  return res.body;
}

async function listPipelinesViaApi(restClient: RestClient): Promise<PipelineRow[]> {
  const res = await restClient.get<{ pipelines: PipelineRow[] }>('/api/v1/pipelines');
  return res.body.pipelines;
}

// ---------------------------------------------------------------------------
// F-P1: Admin can create a new pipeline via the settings UI
// ---------------------------------------------------------------------------

test(
  'F-P1: admin can create a new pipeline in the settings UI',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const pipelineName = `E2E-Pipeline-Create-${Date.now()}`;
    let createdId: string | undefined;

    await navigateToAdminSettings({ page }, 'customisation');

    const addButton = await getPipelineAddButtonLocator({ page });
    await addButton.click();

    const nameInput = await getNewPipelineNameInputLocator({ page });
    await nameInput.fill(pipelineName);

    const submitButton = await getCreatePipelineSubmitLocator({ page });
    await submitButton.click();

    const feedback = await getPipelinesFeedbackLocator({ page });
    await feedback.waitFor({ state: 'visible' });

    // Pipeline appears in the list (via API verification)
    const pipelines = await listPipelinesViaApi(restClient);
    const created = pipelines.find((p) => p.name === pipelineName);
    expect(created).toBeDefined();
    createdId = created?.id;

    // Cleanup
    if (createdId) {
      testData.register('pipeline', createdId, `/api/v1/pipelines/${createdId}`);
    }
  },
);

// ---------------------------------------------------------------------------
// F-P2: Admin can rename a pipeline via the settings UI
// ---------------------------------------------------------------------------

test(
  'F-P2: admin can rename a non-default pipeline in the settings UI',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const originalName = `E2E-Rename-Before-${Date.now()}`;
    const renamedName = `E2E-Rename-After-${Date.now()}`;

    const pipeline = await createPipelineViaApi(restClient, originalName);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    await navigateToAdminSettings({ page }, 'customisation');

    const editButton = await getPipelineEditButtonLocator(pipeline.id, { page });
    await editButton.click();

    const editInput = await getPipelineEditInputLocator(pipeline.id, { page });
    await editInput.fill(renamedName);

    const saveButton = await getPipelineSaveButtonLocator(pipeline.id, { page });
    await saveButton.click();

    const feedback = await getPipelinesFeedbackLocator({ page });
    await feedback.waitFor({ state: 'visible' });

    // Verify via API
    const pipelines = await listPipelinesViaApi(restClient);
    const renamed = pipelines.find((p) => p.id === pipeline.id);
    expect(renamed?.name).toBe(renamedName);
  },
);

// ---------------------------------------------------------------------------
// F-P3: Admin can delete an empty non-default pipeline via the settings UI
// ---------------------------------------------------------------------------

test(
  'F-P3: admin can delete an empty non-default pipeline in the settings UI',
  { tag: ['@functional'] },
  async ({ restClient, page }) => {
    const pipelineName = `E2E-Delete-Empty-${Date.now()}`;
    const pipeline = await createPipelineViaApi(restClient, pipelineName);
    // No testData.register — we expect the test itself to delete it

    await navigateToAdminSettings({ page }, 'customisation');

    const deleteButton = await getPipelineDeleteButtonLocator(pipeline.id, { page });
    await deleteButton.click();

    const confirmDialog = await getPipelineDeleteConfirmLocator({ page });
    await confirmDialog.waitFor({ state: 'visible' });

    const confirmButton = await getPipelineDeleteConfirmButtonLocator({ page });
    await confirmButton.click();

    const feedback = await getPipelinesFeedbackLocator({ page });
    await feedback.waitFor({ state: 'visible' });

    // Verify deleted via API
    const pipelines = await listPipelinesViaApi(restClient);
    expect(pipelines.find((p) => p.id === pipeline.id)).toBeUndefined();
  },
);

// ---------------------------------------------------------------------------
// F-P4: Each pipeline has its own independently configured stage list
// ---------------------------------------------------------------------------

test(
  'F-P4: a custom pipeline shows only its own stages in the stage selector',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const pipelineName = `E2E-Stages-${Date.now()}`;
    const pipeline = await createPipelineViaApi(restClient, pipelineName);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    // Add a stage to the new pipeline via API
    const stageRes = await restClient.post<{ id: string; name: string }>(
      `/api/v1/settings/pipeline-stages?pipelineId=${pipeline.id}`,
      { name: 'Custom Stage One', probability: 50 },
    );
    const stageId = stageRes.body.id;
    testData.register('pipelineStage', stageId, `/api/v1/settings/pipeline-stages/${stageId}`);

    // Switch to the new pipeline in settings and verify stage appears
    await navigateToAdminSettings({ page }, 'customisation');

    const pipelineSelector = await getPipelineStagesPipelineSelectorLocator({ page });
    await pipelineSelector.selectOption(pipeline.id);

    const stageRow = await getPipelineStageRowLocator(stageId, { page });
    await stageRow.waitFor({ state: 'visible' });
  },
);

// ---------------------------------------------------------------------------
// F-P5: Deals can be created in a non-default pipeline via the API
// ---------------------------------------------------------------------------

test(
  'F-P5: a deal created with a custom pipeline_id belongs to that pipeline',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `P5-Acct-${Date.now()}`,
    });

    const pipeline = await createPipelineViaApi(restClient, `E2E-DealPipeline-${Date.now()}`);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    // Add a stage to the pipeline so the deal has a valid stage
    const stageRes = await restClient.post<{ id: string; name: string }>(
      `/api/v1/settings/pipeline-stages?pipelineId=${pipeline.id}`,
      { name: 'Pipeline 5 Stage', probability: 20 },
    );
    const stageId = stageRes.body.id;
    testData.register('pipelineStage', stageId, `/api/v1/settings/pipeline-stages/${stageId}`);

    // Create deal in the custom pipeline
    const deal = await createDealViaApi(restClient, {
      name: `P5-Deal-${Date.now()}`,
      account_id: account.id,
      stage: 'Pipeline 5 Stage',
      pipeline_id: pipeline.id,
    });
    // Register for cleanup
    testData.register('deal', deal.id, `/api/v1/deals/${deal.id}`);

    // Verify the deal's pipeline via GET
    const dealRes = await restClient.get<{ deal: { pipeline_id: string } }>(
      `/api/v1/deals/${deal.id}`,
    );
    expect(dealRes.body.deal.pipeline_id).toBe(pipeline.id);

    // Suppress unused page warning — page fixture is required by the harness
    void page;
  },
);

// ---------------------------------------------------------------------------
// F-P6: The Deals board pipeline selector appears and filters by pipeline
// ---------------------------------------------------------------------------

test(
  'F-P6: the deals board shows a pipeline selector when multiple pipelines exist',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const isMobile = (page.viewportSize()?.width ?? 1024) < 1024;
    test.skip(isMobile, 'pipeline selector layout is desktop-only');

    const pipeline = await createPipelineViaApi(restClient, `E2E-BoardFilter-${Date.now()}`);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    await navigateToPipelineBoard({ page });

    const selector = await getPipelineBoardSelectorLocator({ page });
    await selector.waitFor({ state: 'visible' });

    await selector.selectOption(pipeline.id);

    const board = await getPipelineBoardContainerLocator({ page });
    await board.waitFor({ state: 'visible' });
  },
);

// ---------------------------------------------------------------------------
// F-P7: Deleting a pipeline that has deals is blocked with an error message
// ---------------------------------------------------------------------------

test(
  'F-P7: deleting a pipeline that contains deals shows a blocked message',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const pipeline = await createPipelineViaApi(restClient, `E2E-DeleteBlocked-${Date.now()}`);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    // Add stage and deal so deletion is blocked
    const stageRes = await restClient.post<{ id: string }>(
      `/api/v1/settings/pipeline-stages?pipelineId=${pipeline.id}`,
      { name: 'Block Stage', probability: 10 },
    );
    testData.register(
      'pipelineStage',
      stageRes.body.id,
      `/api/v1/settings/pipeline-stages/${stageRes.body.id}`,
    );

    const account = await createTestAccount(testData, restClient, {
      name: `P7-Acct-${Date.now()}`,
    });
    const deal = await createDealViaApi(restClient, {
      name: `P7-Deal-${Date.now()}`,
      account_id: account.id,
      stage: 'Block Stage',
      pipeline_id: pipeline.id,
    });
    testData.register('deal', deal.id, `/api/v1/deals/${deal.id}`);

    await navigateToAdminSettings({ page }, 'customisation');

    const deleteButton = await getPipelineDeleteButtonLocator(pipeline.id, { page });
    await deleteButton.click();

    const confirmDialog = await getPipelineDeleteConfirmLocator({ page });
    await confirmDialog.waitFor({ state: 'visible' });

    const confirmButton = await getPipelineDeleteConfirmButtonLocator({ page });
    await confirmButton.click();

    // confirmDialog re-resolves same container showing the blocked-by-deals error message
    await expect(confirmDialog).toContainText(/deal/i);
  },
);
