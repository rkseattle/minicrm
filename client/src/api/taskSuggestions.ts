/**
 * Task suggestions API module.
 * Wraps the on-demand AI follow-up task suggestion endpoint. Requires authentication and
 * the ai_task_suggestions feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { TaskSuggestionResponse } from '@shared/schemas/taskSuggestionSchema.js';

export async function generateTaskSuggestions(activityId: string): Promise<TaskSuggestionResponse> {
  const response = await apiClient.post<TaskSuggestionResponse>(
    `/activities/${activityId}/task-suggestions`,
  );
  return response.data;
}
