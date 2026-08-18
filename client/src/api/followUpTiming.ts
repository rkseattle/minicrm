/**
 * Follow-up timing suggestions API module.
 * Wraps the contact follow-up timing endpoint. Requires authentication and
 * the ai_followup_timing_suggestions feature flag.
 */

import apiClient from './axiosInstance.js';
import type { FollowUpTimingResponse } from '@shared/schemas/followUpTimingSchema.js';

export function followUpTimingQueryKey(contactId: string): readonly [string, string, string] {
  return ['contacts', contactId, 'followUpTiming'] as const;
}

export async function getFollowUpTiming(contactId: string): Promise<FollowUpTimingResponse> {
  const response = await apiClient.get<FollowUpTimingResponse>(
    `/contacts/${contactId}/followup-timing`,
  );
  return response.data;
}
