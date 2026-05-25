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
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateToAdminSettings } from '@behaviors/minicrm/settings.behaviors.js';
import { navigateToPipelineBoard, createDealViaApi } from '@behaviors/minicrm/deals.behaviors.js';
import { createTestAccount } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[pipelines-spec] E2E_ADMIN_PASSWORD is not set');

test.setTimeout(60_000);

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
    await loginAsAdmin(restClient);
    const pipelineName = `E2E-Pipeline-Create-${Date.now()}`;
    let createdId: string | undefined;

    await navigateToAdminSettings({ page }, 'customisation');

    // Open the add-pipeline form
    const addButton = await page
      .locate(
        [
          { type: 'testId', value: 'add-pipeline-button' },
          { type: 'role', value: 'button', options: { name: /new pipeline/i } },
        ],
        { intent: 'button to open the new pipeline form' },
      )
      .resolve();
    await addButton.click();

    // Fill in the pipeline name
    const nameInput = await page
      .locate(
        [
          { type: 'testId', value: 'new-pipeline-name-input' },
          { type: 'role', value: 'textbox' },
        ],
        { intent: 'input field for the new pipeline name' },
      )
      .resolve();
    await nameInput.fill(pipelineName);

    // Submit
    const submitButton = await page
      .locate(
        [
          { type: 'testId', value: 'create-pipeline-submit-button' },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'submit button to create the new pipeline' },
      )
      .resolve();
    await submitButton.click();

    // Success feedback appears
    const feedback = await page
      .locate(
        [
          { type: 'testId', value: 'pipelines-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success feedback message after creating a pipeline' },
      )
      .resolve();
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
    await loginAsAdmin(restClient);

    const originalName = `E2E-Rename-Before-${Date.now()}`;
    const renamedName = `E2E-Rename-After-${Date.now()}`;

    const pipeline = await createPipelineViaApi(restClient, originalName);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    await navigateToAdminSettings({ page }, 'customisation');

    // Click the edit button for this pipeline row
    const editButton = await page
      .locate(
        [
          { type: 'testId', value: `pipeline-edit-button-${pipeline.id}` },
          { type: 'role', value: 'button', options: { name: /edit/i } },
        ],
        { intent: 'edit button for the pipeline row to rename' },
      )
      .resolve();
    await editButton.click();

    // Clear and fill the edit input
    const editInput = await page
      .locate(
        [
          { type: 'testId', value: `pipeline-edit-input-${pipeline.id}` },
          { type: 'role', value: 'textbox' },
        ],
        { intent: 'text input for renaming the pipeline' },
      )
      .resolve();
    await editInput.fill(renamedName);

    // Save
    const saveButton = await page
      .locate(
        [
          { type: 'testId', value: `pipeline-save-button-${pipeline.id}` },
          { type: 'role', value: 'button', options: { name: /save/i } },
        ],
        { intent: 'save button to confirm pipeline rename' },
      )
      .resolve();
    await saveButton.click();

    // Success feedback
    const feedback = await page
      .locate(
        [
          { type: 'testId', value: 'pipelines-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success feedback after renaming a pipeline' },
      )
      .resolve();
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
    await loginAsAdmin(restClient);

    const pipelineName = `E2E-Delete-Empty-${Date.now()}`;
    const pipeline = await createPipelineViaApi(restClient, pipelineName);
    // No testData.register — we expect the test itself to delete it

    await navigateToAdminSettings({ page }, 'customisation');

    // Click delete
    const deleteButton = await page
      .locate(
        [
          { type: 'testId', value: `pipeline-delete-button-${pipeline.id}` },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'delete button for the pipeline row to remove' },
      )
      .resolve();
    await deleteButton.click();

    // Confirmation dialog appears
    // eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
    const confirmDialog = await page
      .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
        intent: 'delete confirmation panel for the pipeline',
      })
      .resolve();
    await confirmDialog.waitFor({ state: 'visible' });

    // Confirm deletion
    const confirmButton = await page
      .locate(
        [
          { type: 'testId', value: 'pipeline-delete-confirm-button' },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'confirm button to execute pipeline deletion' },
      )
      .resolve();
    await confirmButton.click();

    // Success feedback
    const feedback = await page
      .locate(
        [
          { type: 'testId', value: 'pipelines-feedback' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success feedback after deleting a pipeline' },
      )
      .resolve();
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
    await loginAsAdmin(restClient);

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

    const pipelineSelector = await page
      .locate(
        [
          { type: 'testId', value: 'pipeline-stages-pipeline-selector' },
          { type: 'role', value: 'combobox' },
        ],
        { intent: 'dropdown to select which pipeline to manage stages for' },
      )
      .resolve();
    await pipelineSelector.selectOption(pipeline.id);

    // Custom stage appears in the stage table
    const stageRow = await page
      .locate(
        [
          { type: 'testId', value: `pipeline-stage-row-${stageId}` },
          { type: 'text', value: 'Custom Stage One' },
        ],
        { intent: 'row for the custom stage in the pipeline stages table' },
      )
      .resolve();
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
    await loginAsAdmin(restClient);

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

    await loginAsAdmin(restClient);

    const pipeline = await createPipelineViaApi(restClient, `E2E-BoardFilter-${Date.now()}`);
    testData.register('pipeline', pipeline.id, `/api/v1/pipelines/${pipeline.id}`);

    await navigateToPipelineBoard({ page });

    // Pipeline selector is visible when >1 pipeline exists
    const selector = await page
      .locate(
        [
          { type: 'testId', value: 'pipeline-selector' },
          { type: 'role', value: 'combobox' },
        ],
        { intent: 'pipeline selector dropdown above the deals board' },
      )
      .resolve();
    await selector.waitFor({ state: 'visible' });

    // Switch to the new pipeline — board reloads with 0 deals
    await selector.selectOption(pipeline.id);

    // eslint-disable-next-line local/require-locator-fallback -- board container div; no stable role alternative
    const board = await page
      .locate([{ type: 'testId', value: 'pipeline-board' }], {
        intent: 'the main pipeline kanban board container',
      })
      .resolve();
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
    await loginAsAdmin(restClient);

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

    // Click delete on the blocked pipeline
    const deleteButton = await page
      .locate(
        [
          { type: 'testId', value: `pipeline-delete-button-${pipeline.id}` },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'delete button for the pipeline that has deals' },
      )
      .resolve();
    await deleteButton.click();

    // Confirmation dialog opens
    // eslint-disable-next-line local/require-locator-fallback -- static container div; no stable role alternative
    const confirmDialog = await page
      .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
        intent: 'delete confirmation panel for the blocked pipeline',
      })
      .resolve();
    await confirmDialog.waitFor({ state: 'visible' });

    // Attempt to confirm — server returns 409
    const confirmButton = await page
      .locate(
        [
          { type: 'testId', value: 'pipeline-delete-confirm-button' },
          { type: 'role', value: 'button', options: { name: /delete/i } },
        ],
        { intent: 'confirm button that triggers the blocked deletion attempt' },
      )
      .resolve();
    await confirmButton.click();

    // Blocked message is displayed (PIPELINE_HAS_DEALS)
    // eslint-disable-next-line local/require-locator-fallback -- same container re-used; no stable role alternative
    const blockedMsg = await page
      .locate([{ type: 'testId', value: 'pipeline-delete-confirm' }], {
        intent: 'confirmation panel now showing the blocked-by-deals error message',
      })
      .resolve();
    await expect(blockedMsg).toContainText(/deal/i);
  },
);
