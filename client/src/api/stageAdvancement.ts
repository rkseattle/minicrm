/**
 * Stage advancement suggestion API module.
 * Wraps the passive AI stage-advancement-check endpoint. Requires authentication
 * and the ai_stage_advancement feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { StageAdvancementCheckResponse } from '@shared/schemas/stageAdvancementSchema.js';

export function stageAdvancementQueryKey(dealId: string): readonly [string, string] {
  return ['stage_advancement', dealId] as const;
}

export async function getStageAdvancement(dealId: string): Promise<StageAdvancementCheckResponse> {
  const response = await apiClient.get<StageAdvancementCheckResponse>(
    `/deals/${dealId}/stage-advancement`,
  );
  return response.data;
}
