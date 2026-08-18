/**
 * Lead score narrative API module.
 * Wraps the on-demand AI lead-score-narrative endpoint. Requires authentication and
 * the ai_lead_score_narrative feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { LeadScoreNarrativeResponse } from '@shared/schemas/leadScoreNarrativeSchema.js';

export async function getLeadScoreNarrative(leadId: string): Promise<LeadScoreNarrativeResponse> {
  const response = await apiClient.post<LeadScoreNarrativeResponse>(
    `/leads/${leadId}/score-narrative`,
  );
  return response.data;
}
