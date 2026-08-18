/**
 * Lead routing suggestion API module.
 * Wraps the pre-create routing suggestion endpoint and admin config/team-override endpoints.
 */

import apiClient from './axiosInstance.js';
import type {
  LeadRoutingSuggestionRequest,
  LeadRoutingSuggestionResponse,
  LeadRoutingConfigResponse,
  SetLeadRoutingConfigInput,
  TeamRoutingOverrideResponse,
  SetTeamRoutingOverrideInput,
} from '@shared/schemas/leadRoutingSchema.js';

export const LEAD_ROUTING_CONFIG_QUERY_KEY = ['admin', 'ai', 'lead-routing-config'] as const;
export const TEAM_ROUTING_OVERRIDES_QUERY_KEY = [
  'admin',
  'ai',
  'lead-routing',
  'team-overrides',
] as const;

/**
 * Requests a routing suggestion for a draft lead. Returns null when the
 * server responds 204 (no confident suggestion available).
 */
export async function getLeadRoutingSuggestion(
  draft: LeadRoutingSuggestionRequest,
): Promise<LeadRoutingSuggestionResponse | null> {
  const response = await apiClient.post<LeadRoutingSuggestionResponse>(
    '/leads/routing-suggestion',
    draft,
  );
  if (response.status === 204) return null;
  return response.data;
}

export async function getLeadRoutingConfig(): Promise<LeadRoutingConfigResponse> {
  const response = await apiClient.get<LeadRoutingConfigResponse>('/admin/ai/lead-routing-config');
  return response.data;
}

export async function setLeadRoutingConfig(
  patch: SetLeadRoutingConfigInput,
): Promise<LeadRoutingConfigResponse> {
  const response = await apiClient.patch<LeadRoutingConfigResponse>(
    '/admin/ai/lead-routing-config',
    patch,
  );
  return response.data;
}

export async function listTeamRoutingOverrides(): Promise<TeamRoutingOverrideResponse[]> {
  const response = await apiClient.get<{ overrides: TeamRoutingOverrideResponse[] }>(
    '/admin/ai/lead-routing/team-overrides',
  );
  return response.data.overrides;
}

export async function setTeamRoutingOverride(
  teamId: string,
  patch: SetTeamRoutingOverrideInput,
): Promise<{ team_id: string; enabled: boolean | null }> {
  const response = await apiClient.put<{ team_id: string; enabled: boolean | null }>(
    `/admin/ai/lead-routing/team-overrides/${teamId}`,
    patch,
  );
  return response.data;
}
