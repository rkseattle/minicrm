/**
 * Activities API module.
 * Wraps the activity CRUD endpoints. All endpoints require authentication.
 */

import apiClient from './axiosInstance.js';
import type {
  ActivityResponse,
  CreateActivityInput,
  UpdateActivityInput,
} from '@shared/schemas/activitySchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';

/** React Query cache key for the activities list */
export const ACTIVITIES_QUERY_KEY = ['activities'] as const;

/** React Query cache key for the my-tasks list */
export const MY_TASKS_QUERY_KEY = ['my-tasks'] as const;

interface ActivitySingleResponse {
  activity: ActivityResponse;
}

/** An activity task row enriched with the linked record's name and type */
export interface MyTaskResponse extends ActivityResponse {
  /** Display name of the linked contact, account, or deal */
  linked_record_name: string | null;
  /** Which record type this task is linked to */
  linked_record_type: 'contact' | 'account' | 'deal' | null;
}

export interface MyTasksResponse {
  tasks: MyTaskResponse[];
  total: number;
  page: number;
  limit: number;
}

/** Filters and pagination options for the activities list endpoint */
export interface ListActivitiesFilters {
  /** Filter by associated contact UUID */
  contactId?: string;
  /** Filter by associated account UUID */
  accountId?: string;
  /** Filter by associated deal UUID */
  dealId?: string;
  /**
   * 'me' — scope to the current user.
   * A UUID string — admin only; scope to a specific user (server silently falls back to
   * current user if requester is a rep).
   */
  owner?: 'me' | string;
  /** Filter by activity type (e.g. 'Call', 'Task') */
  type?: string;
  /** Return only activities updated on or after this date (YYYY-MM-DD) */
  start?: string;
  /** Return only activities updated on or before this date (YYYY-MM-DD) */
  end?: string;
  /** 1-based page number */
  page?: number;
  /** Records per page */
  limit?: number;
}

/**
 * Returns a paginated list of activities, optionally filtered by parent record or owner.
 *
 * @param filters - Optional filters and pagination for the list query
 */
export async function listActivities(
  filters: ListActivitiesFilters = {},
): Promise<PaginatedResponse<ActivityResponse>> {
  const params: Record<string, string> = {};
  if (filters.contactId) params['contact'] = filters.contactId;
  if (filters.accountId) params['account'] = filters.accountId;
  if (filters.dealId) params['deal'] = filters.dealId;
  if (filters.owner) params['owner'] = filters.owner;
  if (filters.type) params['type'] = filters.type;
  if (filters.start) params['start'] = filters.start;
  if (filters.end) params['end'] = filters.end;
  if (filters.page !== undefined) params['page'] = String(filters.page);
  if (filters.limit !== undefined) params['limit'] = String(filters.limit);

  const response = await apiClient.get<PaginatedResponse<ActivityResponse>>('/activities', {
    params,
  });
  return response.data;
}

/**
 * Returns a single activity by UUID.
 *
 * @param id - Activity UUID
 */
export async function getActivity(id: string): Promise<ActivitySingleResponse> {
  const response = await apiClient.get<ActivitySingleResponse>(`/activities/${id}`);
  return response.data;
}

/**
 * Creates a new activity.
 *
 * @param data - Activity fields (type, subject, and at least one parent ID are required)
 */
export async function createActivity(data: CreateActivityInput): Promise<ActivitySingleResponse> {
  const response = await apiClient.post<ActivitySingleResponse>('/activities', data);
  return response.data;
}

/**
 * Updates one or more fields of an existing activity.
 *
 * @param id - Activity UUID
 * @param data - Fields to update
 */
export async function updateActivity(
  id: string,
  data: UpdateActivityInput,
): Promise<ActivitySingleResponse> {
  const response = await apiClient.patch<ActivitySingleResponse>(`/activities/${id}`, data);
  return response.data;
}

/**
 * Deletes an activity by UUID.
 *
 * @param id - Activity UUID
 */
export async function deleteActivity(id: string): Promise<void> {
  await apiClient.delete(`/activities/${id}`);
}

/**
 * Returns a paginated list of Task-type activities owned by the current user, sorted by
 * due date ascending. Each task includes the linked record name and type for display.
 *
 * @param page - 1-based page number (default 1)
 * @param limit - Records per page (default PAGINATION_DEFAULT_LIMIT)
 */
export async function listMyTasks(
  page = 1,
  limit = PAGINATION_DEFAULT_LIMIT,
): Promise<MyTasksResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const response = await apiClient.get<MyTasksResponse>(`/activities/my-tasks?${params}`);
  return response.data;
}
