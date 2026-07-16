/**
 * Rep coaching insights API module. (MINCRM-474)
 * Wraps the my/team/rep-specific coaching insight endpoints. Requires
 * authentication and the ai_rep_coaching_insights feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  RepCoachingInsightsResponse,
  CoachingTeamOverviewResponse,
} from '@shared/schemas/repCoachingSchema.js';
import type {
  RepCoachingConfigResponse,
  SetRepCoachingConfigInput,
} from '@shared/schemas/settingsSchema.js';

export const MY_COACHING_INSIGHTS_QUERY_KEY = ['coaching_insights', 'me'] as const;
export const COACHING_TEAM_OVERVIEW_QUERY_KEY = ['coaching_insights', 'team'] as const;
export const REP_COACHING_CONFIG_QUERY_KEY = ['admin', 'ai', 'coaching-config'] as const;

export function repCoachingInsightsQueryKey(repId: string): readonly [string, string, string] {
  return ['coaching_insights', 'rep', repId] as const;
}

export async function getMyCoachingInsights(): Promise<RepCoachingInsightsResponse> {
  const response = await apiClient.get<RepCoachingInsightsResponse>('/insights/coaching/me');
  return response.data;
}

export async function getCoachingTeamOverview(): Promise<CoachingTeamOverviewResponse> {
  const response = await apiClient.get<CoachingTeamOverviewResponse>('/insights/coaching/team');
  return response.data;
}

export async function getRepCoachingInsights(repId: string): Promise<RepCoachingInsightsResponse> {
  const response = await apiClient.get<RepCoachingInsightsResponse>(`/insights/coaching/${repId}`);
  return response.data;
}

/** Returns the current admin-configured coaching insight thresholds. Admin only. */
export async function getRepCoachingConfig(): Promise<RepCoachingConfigResponse> {
  const response = await apiClient.get<RepCoachingConfigResponse>('/admin/ai/coaching-config');
  return response.data;
}

/** Updates the admin-configured coaching insight thresholds. Admin only. */
export async function setRepCoachingConfig(
  patch: SetRepCoachingConfigInput,
): Promise<RepCoachingConfigResponse> {
  const response = await apiClient.patch<RepCoachingConfigResponse>(
    '/admin/ai/coaching-config',
    patch,
  );
  return response.data;
}

/**
 * Triggers an immediate rep coaching insight recomputation outside the
 * nightly schedule. Returns immediately (202) — the run happens
 * asynchronously. Admin only.
 */
export async function triggerManualRepCoachingRun(): Promise<{
  accepted: boolean;
  message: string;
}> {
  const response = await apiClient.post<{ accepted: boolean; message: string }>(
    '/admin/ai/coaching/run',
  );
  return response.data;
}
