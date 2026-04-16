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
import { createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F13-automation] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

const MAX_POLL_MS = 8_000;
const INITIAL_BACKOFF_MS = 200;

interface ActivityListResponse {
  data: Array<{
    id: string;
    type: string;
    subject: string;
    owner_id: string;
    due_date: string | null;
    deal_id: string | null;
  }>;
  total: number;
}

/**
 * Polls GET /api/activities until a task matching the given subject appears,
 * using exponential backoff. Throws a descriptive error if the timeout is exceeded.
 *
 * @param restClient - Authenticated REST client.
 * @param subject - The task subject to look for.
 * @param dealId - Optional deal ID to narrow the search.
 * @returns The matching activity row.
 */
async function pollForTask(
  restClient: RestClient,
  subject: string,
  dealId?: string,
): Promise<ActivityListResponse['data'][0]> {
  const deadline = Date.now() + MAX_POLL_MS;
  let backoff = INITIAL_BACKOFF_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 2_000);

    const query = dealId ? `/api/activities?deal=${dealId}` : `/api/activities`;

    const response = await restClient.get<ActivityListResponse>(query);
    const match = response.body.data.find((a) => a.subject === subject && a.type === 'Task');
    if (match) return match;
  }

  throw new Error(
    `[pollForTask] Task with subject "${subject}" not found after ${attempt} attempts ` +
      `(${MAX_POLL_MS}ms). Automation trigger may not have fired.`,
  );
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface AutomationRuleRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: string;
  action_type: string;
}

interface AutomationRuleResponse {
  rule: AutomationRuleRow;
}

// ---------------------------------------------------------------------------
// deal_created → create_task (F13-DC)
// ---------------------------------------------------------------------------

test('@functional F13-DC1: deal_created trigger fires create_task action — task appears linked to deal', async ({
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DC1 Follow Up ${suffix}`;

  // Create the automation rule
  const ruleResp = await restClient.post<AutomationRuleResponse>('/api/automation/rules', {
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
  const ruleId = ruleResp.body.rule.id;
  testData.register('automation_rule', ruleId, `/api/automation/rules/${ruleId}`);

  // Create a deal to fire the trigger
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DC1 Deal ${suffix}`,
  });

  // Poll until the task appears
  const task = await pollForTask(restClient, taskSubject, deal.id);

  expect(task.subject, 'task subject should match automation action config').toBe(taskSubject);
  expect(task.type, 'created activity should be a Task').toBe('Task');
  expect(task.owner_id, 'task should be assigned to the deal owner').toBe(deal.owner_id);

  // Verify due date is set (offset = 1 day from now)
  expect(task.due_date, 'task should have a due date').not.toBeNull();

  // Register task for teardown
  testData.register('activity', task.id, `/api/activities/${task.id}`);
});

test('@functional F13-DC2: deal_created trigger — disabled rule does not fire', async ({
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DC2 Should Not Appear ${suffix}`;

  // Create a disabled rule
  const ruleResp = await restClient.post<AutomationRuleResponse>('/api/automation/rules', {
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
  const ruleId = ruleResp.body.rule.id;
  testData.register('automation_rule', ruleId, `/api/automation/rules/${ruleId}`);

  // Create a deal
  const account = await createTestAccount(testData, restClient);
  await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DC2 Deal ${suffix}`,
  });

  // Wait a reasonable window and confirm no task was created
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const response = await restClient.get<ActivityListResponse>('/api/activities');
  const spuriousTask = response.body.data.find(
    (a) => a.subject === taskSubject && a.type === 'Task',
  );
  expect(spuriousTask, 'disabled rule should not create a task').toBeUndefined();
});

// ---------------------------------------------------------------------------
// deal_stage_changed → create_task (F13-DS)
// ---------------------------------------------------------------------------

test('@functional F13-DS1: deal_stage_changed trigger fires create_task when deal moves to target stage', async ({
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DS1 Proposal Follow Up ${suffix}`;

  // Create rule: fire when deal moves to Proposal
  const ruleResp = await restClient.post<AutomationRuleResponse>('/api/automation/rules', {
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
  const ruleId = ruleResp.body.rule.id;
  testData.register('automation_rule', ruleId, `/api/automation/rules/${ruleId}`);

  // Create deal in Prospecting
  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DS1 Deal ${suffix}`,
    stage: 'Prospecting',
  });

  // Advance to Proposal — this fires the trigger
  await restClient.patch(`/api/deals/${deal.id}`, { stage: 'Proposal' });

  // Poll until the task appears
  const task = await pollForTask(restClient, taskSubject, deal.id);

  expect(task.subject, 'task subject should match automation action config').toBe(taskSubject);
  expect(task.type, 'created activity should be a Task').toBe('Task');
  expect(task.deal_id, 'task should be linked to the triggering deal').toBe(deal.id);

  // Register for teardown
  testData.register('activity', task.id, `/api/activities/${task.id}`);
});

test('@functional F13-DS2: deal_stage_changed trigger does not fire when deal moves to a different stage', async ({
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const taskSubject = `F13DS2 Wrong Stage Task ${suffix}`;

  // Rule configured for Proposal, but we will move deal to Qualification only
  const ruleResp = await restClient.post<AutomationRuleResponse>('/api/automation/rules', {
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
  const ruleId = ruleResp.body.rule.id;
  testData.register('automation_rule', ruleId, `/api/automation/rules/${ruleId}`);

  const account = await createTestAccount(testData, restClient);
  const deal = await createTestDeal(testData, restClient, {
    account_id: account.id,
    name: `F13DS2 Deal ${suffix}`,
    stage: 'Prospecting',
  });

  // Move to Qualification — not the trigger stage
  await restClient.patch(`/api/deals/${deal.id}`, { stage: 'Qualification' });

  // Wait briefly and confirm no task was created
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  const response = await restClient.get<ActivityListResponse>(`/api/activities?deal=${deal.id}`);
  const spuriousTask = response.body.data.find(
    (a) => a.subject === taskSubject && a.type === 'Task',
  );
  expect(
    spuriousTask,
    'rule should not fire when deal moves to a non-matching stage',
  ).toBeUndefined();
});
