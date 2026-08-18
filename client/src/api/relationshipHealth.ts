/**
 * Relationship health scoring API module.
 * Wraps the account health score/history endpoints and the admin-editable
 * scoring config. Requires authentication and the ai_relationship_health_score
 * feature flag (config endpoints additionally require the admin role).
 */

import apiClient from './axiosInstance.js';
import type {
  AccountHealthScoreResponse,
  AccountHealthHistoryResponse,
  AccountHealthScoringConfig,
  SetAccountHealthScoringConfigInput,
} from '@shared/schemas/accountHealthScoreSchema.js';

export function accountHealthScoreQueryKey(accountId: string): readonly [string, string, string] {
  return ['accounts', accountId, 'healthScore'] as const;
}

export function accountHealthHistoryQueryKey(accountId: string): readonly [string, string, string] {
  return ['accounts', accountId, 'healthScoreHistory'] as const;
}

export const RELATIONSHIP_HEALTH_CONFIG_QUERY_KEY = [
  'settings',
  'relationshipHealthConfig',
] as const;

export async function getAccountHealthScore(
  accountId: string,
): Promise<{ score: AccountHealthScoreResponse | null }> {
  const response = await apiClient.get<{ score: AccountHealthScoreResponse | null }>(
    `/accounts/${accountId}/health-score`,
  );
  return response.data;
}

export async function getAccountHealthHistory(
  accountId: string,
): Promise<AccountHealthHistoryResponse> {
  const response = await apiClient.get<AccountHealthHistoryResponse>(
    `/accounts/${accountId}/health-score/history`,
  );
  return response.data;
}

export async function getRelationshipHealthConfig(): Promise<AccountHealthScoringConfig> {
  const response = await apiClient.get<AccountHealthScoringConfig>(
    '/settings/relationship-health-config',
  );
  return response.data;
}

export async function updateRelationshipHealthConfig(
  input: SetAccountHealthScoringConfigInput,
): Promise<AccountHealthScoringConfig> {
  const response = await apiClient.patch<AccountHealthScoringConfig>(
    '/settings/relationship-health-config',
    input,
  );
  return response.data;
}
