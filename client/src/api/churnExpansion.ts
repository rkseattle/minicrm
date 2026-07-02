/**
 * Churn/expansion detection API module. (MINCRM-469)
 * Wraps the account signal and org-wide signals list endpoints. Requires
 * authentication and the ai_churn_expansion_detection feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  AccountChurnExpansionResponse,
  ChurnExpansionListResponse,
} from '@shared/schemas/churnExpansionSchema.js';

export function accountChurnExpansionQueryKey(
  accountId: string,
): readonly [string, string, string] {
  return ['accounts', accountId, 'churnExpansionSignal'] as const;
}

export const CHURN_EXPANSION_LIST_QUERY_KEY = ['churn_expansion_signals'] as const;

export async function getAccountChurnExpansionSignal(
  accountId: string,
): Promise<AccountChurnExpansionResponse> {
  const response = await apiClient.get<AccountChurnExpansionResponse>(
    `/accounts/${accountId}/churn-expansion-signal`,
  );
  return response.data;
}

export async function listChurnExpansionSignals(): Promise<ChurnExpansionListResponse> {
  const response = await apiClient.get<ChurnExpansionListResponse>('/insights/churn-expansion');
  return response.data;
}
