/**
 * Lead score API module.
 * Wraps the on-demand rule-based lead scoring endpoint. Requires authentication and
 * the ai_lead_scoring feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { LeadScoreResult } from '@shared/schemas/leadScoreSchema.js';

export function leadScoreQueryKey(leadId: string): readonly [string, string] {
  return ['lead_score', leadId] as const;
}

export async function getLeadScore(leadId: string): Promise<LeadScoreResult> {
  const response = await apiClient.get<LeadScoreResult>(`/leads/${leadId}/score`);
  return response.data;
}
