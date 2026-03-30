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

/** React Query cache key for the activities list */
export const ACTIVITIES_QUERY_KEY = ['activities'] as const;

interface ActivitiesResponse {
  activities: ActivityResponse[];
}

interface ActivitySingleResponse {
  activity: ActivityResponse;
}

/** Filters supported by the list endpoint */
export interface ListActivitiesFilters {
  /** Filter by associated contact UUID */
  contactId?: string;
  /** Filter by associated account UUID */
  accountId?: string;
  /** Filter by associated deal UUID */
  dealId?: string;
  /** When 'me', only the current user's activities are returned */
  owner?: 'me';
}

/**
 * Returns activities, optionally filtered by parent record or owner.
 *
 * @param filters - Optional filters for the list query
 */
export async function listActivities(
  filters: ListActivitiesFilters = {},
): Promise<ActivitiesResponse> {
  const params: Record<string, string> = {};
  if (filters.contactId) params['contact'] = filters.contactId;
  if (filters.accountId) params['account'] = filters.accountId;
  if (filters.dealId) params['deal'] = filters.dealId;
  if (filters.owner) params['owner'] = filters.owner;

  const response = await apiClient.get<ActivitiesResponse>('/activities', { params });
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
