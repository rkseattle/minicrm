/**
 * Meeting brief API module.
 * Wraps the pre-meeting brief generate/fetch endpoints. Requires authentication
 * and the ai_meeting_brief feature flag.
 */

import apiClient from './axiosInstance.js';
import type { MeetingBriefResponse } from '@shared/schemas/meetingBriefSchema.js';

export function meetingBriefQueryKey(activityId: string): readonly [string, string, string] {
  return ['activities', activityId, 'brief'] as const;
}

export async function generateMeetingBrief(activityId: string): Promise<MeetingBriefResponse> {
  const response = await apiClient.post<MeetingBriefResponse>(`/activities/${activityId}/brief`);
  return response.data;
}

export async function getMeetingBrief(activityId: string): Promise<MeetingBriefResponse> {
  const response = await apiClient.get<MeetingBriefResponse>(`/activities/${activityId}/brief`);
  return response.data;
}
