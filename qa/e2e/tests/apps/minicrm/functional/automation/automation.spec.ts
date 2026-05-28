/**
 * F13 — Automation Rule Execution (Trigger fires → Action performed)
 *
 * Functional regression tests verifying the automation trigger→action pipeline
 * end-to-end. Service-layer unit tests exist for the automation logic, but no
 * test verifies the full wiring: API write → fireAutomationTrigger → rule lookup
 * → action execution → task created.
 *
 * Test groups:
 *   deal_created → create_task (F13-DC)
 *   deal_stage_changed → create_task (F13-DS)
 *
 * Polling strategy:
 *   fireAutomationTrigger is fire-and-forget (void call in service layer — MINCRM-122).
 *   Tests poll GET /api/activities with exponential backoff (200ms → 400ms → 800ms…)
 *   up to MAX_POLL_MS. A clear failure message is emitted when the timeout is exceeded.
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + TestDataManager (auto teardown)
 *   - Automation rules deleted in teardown via testData.register
 *
 * MINCRM-202
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAccount, createTestDeal, createTestAdmin } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  navigateToAutomation,
  getAutomationHeadingLocator,
  getAutomationPaginationLocator,
} from '@behaviors/minicrm/setup.behaviors.js';
import { createAutomationRule } from '@behaviors/minicrm/setup.behaviors.js';
import { getActivities, getActivityById } from '@behaviors/minicrm/activities.behaviors.js';
import type { ActivityListRow } from '@behaviors/minicrm/activities.behaviors.js';
import { patchDealStage } from '@behaviors/minicrm/deals.behaviors.js';

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

const MAX_POLL_MS = 8_000;
const INITIAL_BACKOFF_MS = 200;

/**
 * Polls GET /api/activities until a task matching the given subject appears,
 * using exponential backoff. Throws a descriptive error if the timeout is exceeded.
 *
 * @param restClient - Authenticated REST client.
 * @param subject - The task subject to look for.
 * @param dealId - Optional deal ID to narrow the search.
 * @returns The matching activity list row.
 */
async function pollForTask(
  restClient: RestClient,
  subject: string,
  dealId?: string,
): Promise<ActivityListRow> {
  const deadline = Date.now() + MAX_POLL_MS;
  let backoff = INITIAL_BACKOFF_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 2_000);

    const activities = await getActivities(restClient, dealId ? { deal: dealId } : {});
    const match = activities.find((a) => a.subject === subject && a.type === 'Task');
    if (match) return match;
  }

  throw new Error(
    `[pollForTask] Task with subject "${subject}" not found after ${attempt} attempts ` +
      `(${MAX_POLL_MS}ms). Automation trigger may not have fired.`,
  );
}

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});

// ---------------------------------------------------------------------------
// deal_created → create_task (F13-DC)
// ---------------------------------------------------------------------------

test('@functional F13-DC1: deal_created trigger fires create_task action — task appears linked to deal', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DC1 Follow Up ${suffix}`;

  // Create the automation rule
  const rule = await createAutomationRule(restClient, {
    name: `F13DC1 Rule ${suffix}`,
    enabled: true,
    trigger_type: 'deal_created',
    trigger_config: {},
    action_type: 'create_task',
    action_config: {
      subject: taskSubject,
      task_type: 'Task',
      assignee_type: 'owner',
      due_date_offset_days: 1,
    },
  });
  testData.register('automation_rule', rule.id, `/api/v1/automation/rules/${rule.id}`);

  // Create a deal to fire the trigger
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DC1 Deal ${suffix}`,
  });

  // Poll until the task appears (list row for subject/type/deal_id assertions)
  const taskRow = await pollForTask(restClient, taskSubject, deal.id);

  expect(taskRow.subject, 'task subject should match automation action config').toBe(taskSubject);
  expect(taskRow.type, 'created activity should be a Task').toBe('Task');

  // Fetch the full activity to assert owner_id (not present on list rows)
  const task = await getActivityById(restClient, taskRow.id);
  expect(task.owner_id, 'task should be assigned to the deal owner').toBe(deal.owner_id);

  // Verify due date is set (offset = 1 day from now)
  expect(task.due_date, 'task should have a due date').not.toBeNull();

  // Register task for teardown
  testData.register('activity', task.id, `/api/v1/activities/${task.id}`);
});

test('@functional F13-DC2: deal_created trigger — disabled rule does not fire', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DC2 Should Not Appear ${suffix}`;

  // Create a disabled rule
  const rule = await createAutomationRule(restClient, {
    name: `F13DC2 Disabled Rule ${suffix}`,
    enabled: false,
    trigger_type: 'deal_created',
    trigger_config: {},
    action_type: 'create_task',
    action_config: {
      subject: taskSubject,
      task_type: 'Task',
      assignee_type: 'owner',
      due_date_offset_days: 1,
    },
  });
  testData.register('automation_rule', rule.id, `/api/v1/automation/rules/${rule.id}`);

  // Create a deal
  const account = await createTestAccount(testData, restClient);
  await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DC2 Deal ${suffix}`,
  });

  // Wait a reasonable window and confirm no task was created
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const activities = await getActivities(restClient);
  const spuriousTask = activities.find((a) => a.subject === taskSubject && a.type === 'Task');
  expect(spuriousTask, 'disabled rule should not create a task').toBeUndefined();
});

// ---------------------------------------------------------------------------
// deal_stage_changed → create_task (F13-DS)
// ---------------------------------------------------------------------------

test('@functional F13-DS1: deal_stage_changed trigger fires create_task when deal moves to target stage', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DS1 Proposal Follow Up ${suffix}`;

  // Create rule: fire when deal moves to Proposal
  const rule = await createAutomationRule(restClient, {
    name: `F13DS1 Stage Rule ${suffix}`,
    enabled: true,
    trigger_type: 'deal_stage_changed',
    trigger_config: { stage: 'Proposal' },
    action_type: 'create_task',
    action_config: {
      subject: taskSubject,
      task_type: 'Task',
      assignee_type: 'owner',
      due_date_offset_days: 2,
    },
  });
  testData.register('automation_rule', rule.id, `/api/v1/automation/rules/${rule.id}`);

  // Create deal in Prospecting
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DS1 Deal ${suffix}`,
    stage: 'Prospecting',
  });

  // Advance to Proposal — this fires the trigger.
  // MINCRM-349: include version for optimistic locking.
  await patchDealStage(restClient, deal.id, 'Proposal', deal.version);

  // Poll until the task appears
  const task = await pollForTask(restClient, taskSubject, deal.id);

  expect(task.subject, 'task subject should match automation action config').toBe(taskSubject);
  expect(task.type, 'created activity should be a Task').toBe('Task');
  expect(task.deal_id, 'task should be linked to the triggering deal').toBe(deal.id);

  // Register for teardown
  testData.register('activity', task.id, `/api/v1/activities/${task.id}`);
});

test('@functional F13-DS2: deal_stage_changed trigger does not fire when deal moves to a different stage', async ({
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DS2 Wrong Stage Task ${suffix}`;

  // Rule configured for Proposal, but we will move deal to Qualification only
  const rule = await createAutomationRule(restClient, {
    name: `F13DS2 Wrong Stage Rule ${suffix}`,
    enabled: true,
    trigger_type: 'deal_stage_changed',
    trigger_config: { stage: 'Proposal' },
    action_type: 'create_task',
    action_config: {
      subject: taskSubject,
      task_type: 'Task',
      assignee_type: 'owner',
      due_date_offset_days: 1,
    },
  });
  testData.register('automation_rule', rule.id, `/api/v1/automation/rules/${rule.id}`);

  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DS2 Deal ${suffix}`,
    stage: 'Prospecting',
  });

  // Move to Qualification — not the trigger stage.
  // MINCRM-349: include version for optimistic locking.
  await patchDealStage(restClient, deal.id, 'Qualification', deal.version);

  // Wait briefly and confirm no task was created
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const activities = await getActivities(restClient, { deal: deal.id });
  const spuriousTask = activities.find((a) => a.subject === taskSubject && a.type === 'Task');
  expect(
    spuriousTask,
    'rule should not fire when deal moves to a non-matching stage',
  ).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Pagination always visible (MINCRM-345)
// ---------------------------------------------------------------------------

test('@functional F13-PAG1: Automation rules page — pagination controls always visible', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAutomation({ page });

  await expect(await getAutomationHeadingLocator({ page })).toBeVisible();
  const automationPagination = await getAutomationPaginationLocator({ page });
  await expect(automationPagination).toBeVisible({ timeout: 10_000 });
});
