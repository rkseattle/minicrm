/**
 * Stage exit requirements functional tests (MINCRM-499, MINCRM-527)
 *
 * Covers:
 *   SEQ-1: Moving a deal to "Closed Won" without close_date → API returns 400
 *           STAGE_EXIT_REQUIREMENTS_NOT_MET with severity 'error'
 *   SEQ-2: Moving a deal to "Closed Won" WITH close_date → succeeds
 *   SEQ-3: Admin can view and update stage_exit_requirements in Customisation settings
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *   - No raw locators — all through page.locate() healing locators
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { createTestAccount, createTestDeal, createTestAdmin } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { patchDeal } from '@behaviors/minicrm/deals.behaviors.js';
import {
  navigateToAdminSettings,
  clickPipelineStageEditButton,
  clickPipelineStageSaveButton,
  fillPipelineStageExitRequiredInput,
  waitForStageExitRequirementsUpdated,
} from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// Allow 60 s for admin settings tests which involve page navigation and saves.
test.setTimeout(60_000);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineStage {
  id: string;
  name: string;
  sort_order: number;
  stage_exit_requirements: {
    required_fields: string[];
    warning_fields: string[];
  };
}

interface StageListResponse {
  stages: PipelineStage[];
}

interface ExitRequirementsErrorBody {
  error: {
    code: string;
    message: string;
    missing_fields: string[];
    warning_fields: string[];
    severity: 'error' | 'warning';
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchStages(restClient: RestClient): Promise<PipelineStage[]> {
  const res = await restClient.get<StageListResponse>('/api/v1/settings/pipeline-stages');
  return res.body.stages;
}

async function createStage(restClient: RestClient, name: string): Promise<PipelineStage> {
  const res = await restClient.post<PipelineStage>('/api/v1/settings/pipeline-stages', {
    name,
    probability: 0,
  });
  return res.body;
}

async function deleteStage(restClient: RestClient, stageId: string): Promise<void> {
  await restClient.delete(`/api/v1/settings/pipeline-stages/${stageId}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@functional SEQ-1: PATCH deal to Closed Won without close_date returns 400 STAGE_EXIT_REQUIREMENTS_NOT_MET', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: 'SEQ-1 Account',
  });
  const deal = await createTestDeal(testData, restClient, {
    name: 'SEQ-1 Deal — No Close Date',
    stage: 'Prospecting',
    account_id: account.id,
  });

  let caughtError: RestClientError | undefined;
  try {
    await patchDeal(restClient, deal.id, {
      stage: 'Closed Won',
      version: deal.version,
    });
  } catch (err) {
    if (err instanceof RestClientError) {
      caughtError = err;
    } else {
      throw err;
    }
  }

  expect(caughtError).toBeDefined();
  expect(caughtError?.status).toBe(400);

  const errorBody = caughtError?.body as ExitRequirementsErrorBody;
  expect(errorBody.error.code).toBe('STAGE_EXIT_REQUIREMENTS_NOT_MET');
  expect(errorBody.error.severity).toBe('error');
  expect(errorBody.error.missing_fields).toContain('close_date');
});

test('@functional SEQ-2: PATCH deal to Closed Won with close_date succeeds', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  const account = await createTestAccount(testData, restClient, {
    name: 'SEQ-2 Account',
  });
  const deal = await createTestDeal(testData, restClient, {
    name: 'SEQ-2 Deal — Has Close Date',
    stage: 'Prospecting',
    account_id: account.id,
  });

  const today = new Date().toISOString().split('T')[0];
  const updated = await patchDeal(restClient, deal.id, {
    stage: 'Closed Won',
    close_date: today,
    version: deal.version,
  });

  expect(updated.stage).toBe('Closed Won');
  expect(updated.close_date).toBe(today);
});

test('@functional SEQ-3: Admin can update stage_exit_requirements in Customisation settings', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Create a unique temporary stage to avoid racing with the parallel mobile-web worker.
  // Both desktop and mobile-web run this test concurrently; editing a shared stage
  // (e.g. Prospecting) causes non-deterministic failures. The UUID suffix ensures
  // each worker gets a distinct stage name even when Date.now() collides.
  const stageName = `SEQ3-Stage-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tempStage = await createStage(restClient, stageName);
  const stageId = tempStage.id;

  try {
    await navigateToAdminSettings({ page }, 'pipelines');

    // Open the edit panel for the temp stage
    await clickPipelineStageEditButton(stageId, { page });

    // Fill in required fields via behavior
    await fillPipelineStageExitRequiredInput(stageId, 'value', { page });

    // Save via behavior
    await clickPipelineStageSaveButton(stageId, { page });

    // Wait for the save to land: poll the API from the browser context.
    await waitForStageExitRequirementsUpdated(stageId, 'value', { page });

    // Secondary verification via the REST client.
    await loginAsAdmin(restClient);
    const updatedStages = await fetchStages(restClient);
    const updatedStage = updatedStages.find((s) => s.id === stageId);
    expect(updatedStage?.stage_exit_requirements.required_fields).toContain('value');
  } finally {
    // Always delete the temp stage to restore state for other tests.
    await deleteStage(restClient, stageId);
  }
});
