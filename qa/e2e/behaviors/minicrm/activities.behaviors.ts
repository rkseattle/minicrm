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
 * MINCRM-110, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { MyTasksPage } from '@pages/minicrm/MyTasksPage.js';

// ---------------------------------------------------------------------------
// API data types (MINCRM-357)
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
// API data-fetch helpers (MINCRM-357)
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
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/** Fixture context accepted by activity locator behaviors. */
export interface ActivitiesBehaviorContext {
  page: PageFacade;
}

/**
 * Returns a resolved locator for a task row by task ID (null if absent).
 */
export async function getMyTaskRowLocator(taskId: string, context: ActivitiesBehaviorContext) {
  const tasksPage = new MyTasksPage(context);
  return tasksPage.taskRowLocator(taskId);
}

/**
 * Returns a resolved locator for the overdue badge on a task row.
 */
export async function getOverdueTaskBadgeLocator(
  taskId: string,
  context: ActivitiesBehaviorContext,
) {
  const tasksPage = new MyTasksPage(context);
  return tasksPage.overdueTaskBadgeLocator(taskId);
}
