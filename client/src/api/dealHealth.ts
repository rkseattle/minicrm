/**
 * Deal health check API module. (MINCRM-442)
 * Wraps the on-demand AI health-check endpoint. Requires authentication and the
 * ai_deal_health_check feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { DealHealthCheckResponse } from '@shared/schemas/dealHealthSchema.js';

export function dealHealthQueryKey(dealId: string): readonly [string, string] {
  return ['deal_health', dealId] as const;
}

export async function runDealHealthCheck(dealId: string): Promise<DealHealthCheckResponse> {
  const response = await apiClient.post<DealHealthCheckResponse>(`/deals/${dealId}/health-check`);
  return response.data;
}
