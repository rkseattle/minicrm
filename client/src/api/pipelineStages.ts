/**
 * Pipeline stages API module.
 * Wraps the /api/settings/pipeline-stages endpoints.
 * GET is public; POST/PATCH/DELETE require admin auth.
 */

import apiClient from './axiosInstance.js';
import type {
  PipelineStageResponse,
  CreatePipelineStageInput,
  UpdatePipelineStageInput,
  ReorderPipelineStagesInput,
} from '@shared/schemas/pipelineStageSchema.js';

/**
 * Returns a React Query cache key scoped to a specific pipeline.
 * When pipelineId is undefined the key represents the default pipeline's stages.
 */
export function pipelineStagesQueryKey(pipelineId?: string) {
  return pipelineId
    ? (['settings', 'pipelineStages', pipelineId] as const)
    : (['settings', 'pipelineStages'] as const);
}

/** React Query cache key for the default pipeline stages list (backward compat) */
export const PIPELINE_STAGES_QUERY_KEY = ['settings', 'pipelineStages'] as const;

/** Shape returned by GET /api/settings/pipeline-stages */
export interface PipelineStagesListResponse {
  stages: PipelineStageResponse[];
}

/**
 * Returns all pipeline stages for the specified pipeline in sort_order order.
 * When pipelineId is omitted the default pipeline's stages are returned.
 */
export async function listPipelineStages(pipelineId?: string): Promise<PipelineStagesListResponse> {
  const params = pipelineId ? { pipelineId } : undefined;
  const response = await apiClient.get<PipelineStagesListResponse>('/settings/pipeline-stages', {
    params,
  });
  return response.data;
}

/**
 * Creates a new pipeline stage. Admin only.
 *
 * @param params - Stage fields
 */
export async function createPipelineStage(
  params: CreatePipelineStageInput & { pipeline_id?: string },
): Promise<PipelineStageResponse> {
  const response = await apiClient.post<PipelineStageResponse>('/settings/pipeline-stages', params);
  return response.data;
}

/**
 * Updates a pipeline stage. Admin only.
 *
 * @param id - Stage UUID
 * @param params - Fields to update
 */
export async function updatePipelineStage(
  id: string,
  params: UpdatePipelineStageInput,
): Promise<PipelineStageResponse> {
  const response = await apiClient.patch<PipelineStageResponse>(
    `/settings/pipeline-stages/${id}`,
    params,
  );
  return response.data;
}

/**
 * Deletes a pipeline stage. Admin only.
 * Returns the deleted stage's id on success.
 *
 * @param id - Stage UUID
 */
export async function deletePipelineStage(id: string): Promise<{ id: string }> {
  const response = await apiClient.delete<{ id: string }>(`/settings/pipeline-stages/${id}`);
  return response.data;
}

/**
 * Atomically reorders all pipeline stages. Admin only.
 * Sends the full ordered array of stage IDs; the server assigns sort_order 1..N
 * in a single transaction, eliminating transient unique-constraint conflicts.
 *
 * @param params - Ordered array of stage UUIDs
 */
export async function reorderPipelineStages(
  params: ReorderPipelineStagesInput,
): Promise<PipelineStagesListResponse> {
  const response = await apiClient.put<PipelineStagesListResponse>(
    '/settings/pipeline-stages/reorder',
    params,
  );
  return response.data;
}
