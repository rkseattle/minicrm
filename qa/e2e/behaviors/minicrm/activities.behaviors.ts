/**
 * Activities behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 *
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { MyTasksPage } from '@pages/minicrm/MyTasksPage.js';
import { ActivityTimelinePage } from '@pages/minicrm/ActivityTimelinePage.js';
import { FIRST_INTERACTION_TIMEOUT_MS } from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// API data types
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/v1/activities/:id. */
export interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  status: 'open' | 'complete';
  direction: string | null;
  outcome: string | null;
  due_date: string | null;
  contact_id: string | null;
  account_id: string | null;
  deal_id: string | null;
  owner_id: string;
  is_overdue: boolean;
  /** Optimistic lock version. */
  version: number;
}

/** Shape of a paginated activity list row. */
export interface ActivityListRow {
  id: string;
  type: string;
  subject: string;
  status: 'open' | 'complete';
  due_date: string | null;
  is_overdue: boolean;
  contact_id: string | null;
  account_id: string | null;
  deal_id: string | null;
}

/** Parameters for creating an activity via the API. */
export interface CreateActivityParams {
  type: string;
  subject: string;
  direction?: string;
  contact_id?: string;
  account_id?: string;
  deal_id?: string;
  due_date?: string;
  owner_id?: string;
}

// ---------------------------------------------------------------------------
// API data-fetch helpers
// ---------------------------------------------------------------------------

/**
 * Fetches a single activity by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param activityId - Activity UUID.
 * @returns The activity record.
 */
export async function getActivityById(
  restClient: RestClient,
  activityId: string,
): Promise<ActivityRow> {
  const res = await restClient.get<{ activity: ActivityRow }>(`/api/v1/activities/${activityId}`);
  return res.body.activity;
}

/**
 * Fetches a list of activities, optionally filtered.
 *
 * @param restClient - Authenticated RestClient.
 * @param options - Optional query parameters.
 * @returns Array of activity list rows.
 */
export async function getActivities(
  restClient: RestClient,
  options: { contact?: string; account?: string; deal?: string; type?: string } = {},
): Promise<ActivityListRow[]> {
  const params = new URLSearchParams();
  if (options.contact) params.set('contact', options.contact);
  if (options.account) params.set('account', options.account);
  if (options.deal) params.set('deal', options.deal);
  if (options.type) params.set('type', options.type);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await restClient.get<{ data: ActivityListRow[] }>(`/api/v1/activities${query}`);
  return res.body.data;
}

/**
 * Fetches the current user's task list from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @returns Array of activity rows representing open tasks.
 */
export async function getMyTasks(restClient: RestClient): Promise<ActivityListRow[]> {
  const res = await restClient.get<{ tasks: ActivityListRow[] }>('/api/v1/activities/my-tasks');
  return res.body.tasks;
}

/**
 * Creates an activity via the API and returns the created record.
 *
 * @param restClient - Authenticated RestClient.
 * @param params - Activity fields.
 * @returns The created activity record.
 */
export async function createActivityViaApi(
  restClient: RestClient,
  params: CreateActivityParams,
): Promise<ActivityRow> {
  const res = await restClient.post<{ activity: ActivityRow }>('/api/v1/activities', params);
  return res.body.activity;
}

/**
 * Patches an activity's fields via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param activityId - Activity UUID.
 * @param patch - Fields to update (e.g. { status: 'complete', version }).
 * @returns The updated activity record.
 */
export async function patchActivity(
  restClient: RestClient,
  activityId: string,
  patch: Partial<ActivityRow> & { version: number },
): Promise<ActivityRow> {
  const res = await restClient.patch<{ activity: ActivityRow }>(
    `/api/v1/activities/${activityId}`,
    patch,
  );
  return res.body.activity;
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap MyTasksPage locators
// so spec files never import @pages/* directly.
// ---------------------------------------------------------------------------

/** Fixture context accepted by activity locator behaviors. */
export interface ActivitiesBehaviorContext {
  page: PageFacade;
}

/**
 * Waits for the task row for the given ID to become visible.
 * The row may be absent if the task is not on screen yet; this waits up to `timeout` ms.
 */
export async function waitForMyTaskRow(
  taskId: string,
  context: ActivitiesBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const locator = await new MyTasksPage(context).taskRowLocator(taskId);
  await locator?.waitFor({ state: 'visible', timeout });
}

/** Asserts the overdue badge on the given task row is visible. */
export async function expectOverdueTaskBadgeVisible(
  taskId: string,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new MyTasksPage(context).overdueTaskBadgeLocator(taskId);
  await expect(locator).toBeVisible();
}

// ---------------------------------------------------------------------------
// Visibility check helpers — keep page.isNotVisible() out of spec files.
// ---------------------------------------------------------------------------

/**
 * Returns true when the overdue badge for a task is absent or hidden.
 */
export async function isOverdueTaskBadgeHidden(
  taskId: string,
  context: ActivitiesBehaviorContext,
): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: `task-overdue-badge-${taskId}` }]);
}

// ---------------------------------------------------------------------------
// AI call/note summarizer
// ---------------------------------------------------------------------------

/** Result returned by summarizeActivityNotes. */
export interface SummarizeActivityNotesResult {
  /** HTTP status code returned by POST /activities/summarize. */
  status: number;
}

/**
 * Opens the activity create form, opens the AI summarizer, pastes the given
 * text, and submits it for summarization. Waits for the summarize POST to
 * resolve before returning. Does not assert — callers branch on `status`
 * per the network-response-first pattern.
 */
export async function summarizeActivityNotes(
  rawText: string,
  context: ActivitiesBehaviorContext,
): Promise<SummarizeActivityNotesResult> {
  const timeline = new ActivityTimelinePage(context);
  await timeline.clickAddActivity(FIRST_INTERACTION_TIMEOUT_MS);
  await timeline.clickSummarize(FIRST_INTERACTION_TIMEOUT_MS);
  await timeline.fillSummaryInput(rawText);

  const responseReceived = context.page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/activities/summarize'),
    { timeout: 30_000 },
  );
  await timeline.clickSummarySubmit(FIRST_INTERACTION_TIMEOUT_MS);
  const response = await responseReceived;

  return { status: response.status() };
}

/**
 * Dismisses the AI-suggested follow-up task at the given index in the
 * summarizer preview.
 */
export async function dismissSuggestedTask(
  index: number,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  const timeline = new ActivityTimelinePage(context);
  await timeline.dismissSuggestedTask(index);
}

/**
 * Applies the AI-generated summary to the activity form (populates notes,
 * accepts any non-dismissed suggested tasks) and closes the summarizer modal.
 */
export async function applyActivitySummary(context: ActivitiesBehaviorContext): Promise<void> {
  const timeline = new ActivityTimelinePage(context);
  await timeline.clickApplySummary(FIRST_INTERACTION_TIMEOUT_MS);
}

/**
 * Saves the activity form (after applying or editing the summary).
 */
export async function saveActivityForm(context: ActivitiesBehaviorContext): Promise<void> {
  const timeline = new ActivityTimelinePage(context);
  await timeline.clickFormSubmit(FIRST_INTERACTION_TIMEOUT_MS);
}

/**
 * Fills the activity form's subject field. The summarizer only populates
 * notes/action items — subject is a separate required field the user fills
 * themselves, so this must be called before saveActivityForm.
 */
export async function fillActivitySubject(
  subject: string,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  const timeline = new ActivityTimelinePage(context);
  const locator = await timeline.subjectInputLocator();
  await locator.fill(subject);
}

/**
 * Waits for the activity notes field to contain the given text.
 */
export async function expectActivityNotesToContain(
  text: string,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const timeline = new ActivityTimelinePage(context);
  const locator = await timeline.notesFieldLocator();
  await expect(locator).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

/**
 * Returns true when the "Summarize" action is visible in the activity form.
 * Used to assert the action is hidden when the ai_activity_summarizer flag is off.
 */
export async function isSummarizeButtonVisible(
  context: ActivitiesBehaviorContext,
): Promise<boolean> {
  return new ActivityTimelinePage(context).isSummarizeButtonVisible();
}

/**
 * Opens the activity create form and sets its type via the type select.
 * Used to exercise Summarize-visibility rules for non-summarizable types (e.g. Email).
 */
export async function openActivityFormWithType(
  activityType: string,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  const timeline = new ActivityTimelinePage(context);
  await timeline.clickAddActivity(FIRST_INTERACTION_TIMEOUT_MS);
  await timeline.selectType(activityType);
}

// ---------------------------------------------------------------------------
// AI follow-up task suggestions
// ---------------------------------------------------------------------------

/** Returns true when the task-suggestion panel is currently visible. */
export async function isTaskSuggestionPanelVisible(
  context: ActivitiesBehaviorContext,
): Promise<boolean> {
  return new ActivityTimelinePage(context).isTaskSuggestionPanelVisible();
}

/** Accepts the task suggestion at the given index. */
export async function acceptTaskSuggestion(
  index: number,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  await new ActivityTimelinePage(context).acceptTaskSuggestion(index);
}

/**
 * Logs an activity via the create form (opens it, sets type/direction/subject,
 * and submits). Used to trigger the post-save AI task-suggestion flow.
 */
export async function logActivity(
  params: { type: string; direction?: string; subject: string },
  context: ActivitiesBehaviorContext,
): Promise<void> {
  await new ActivityTimelinePage(context).logActivity(params);
}

// ---------------------------------------------------------------------------
// AI pre-meeting brief generation
// ---------------------------------------------------------------------------

/** Returns true when the "Generate Brief" button is currently visible for an activity. */
export async function isGenerateBriefButtonVisible(
  activityId: string,
  context: ActivitiesBehaviorContext,
): Promise<boolean> {
  return new ActivityTimelinePage(context).isGenerateBriefButtonVisible(activityId);
}

/** Clicks the "Generate Brief" button for an activity. */
export async function clickGenerateBrief(
  activityId: string,
  context: ActivitiesBehaviorContext,
): Promise<void> {
  await new ActivityTimelinePage(context).clickGenerateBrief(activityId);
}

/** Returns true when the meeting brief panel is currently visible. */
export async function isMeetingBriefPanelVisible(
  context: ActivitiesBehaviorContext,
): Promise<boolean> {
  return new ActivityTimelinePage(context).isMeetingBriefPanelVisible();
}
