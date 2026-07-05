/**
 * Activity summarizer API module. (MINCRM-436)
 * Wraps the on-demand AI text-summarization endpoint. Requires authentication and the
 * ai_activity_summarizer feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { ActivitySummaryResponse } from '@shared/schemas/activitySummarySchema.js';

export async function summarizeActivityText(rawText: string): Promise<ActivitySummaryResponse> {
  const response = await apiClient.post<ActivitySummaryResponse>('/activities/summarize', {
    raw_text: rawText,
  });
  return response.data;
}
