/**
 * Pipeline stages API module (MINCRM-180).
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

/** React Query cache key for the pipeline stages list */
export const PIPELINE_STAGES_QUERY_KEY = ['settings', 'pipelineStages'] as const;

/** Shape returned by GET /api/settings/pipeline-stages */
export interface PipelineStagesListResponse {
  stages: PipelineStageResponse[];
}

/**
 * Returns all pipeline stages in sort_order order.
 * Called at app startup to populate stage selectors.
 */
export async function listPipelineStages(): Promise<PipelineStagesListResponse> {
  const response = await apiClient.get<PipelineStagesListResponse>('/settings/pipeline-stages');
  return response.data;
}

/**
 * Creates a new pipeline stage. Admin only.
 *
 * @param params - Stage fields
 */
export async function createPipelineStage(
  params: CreatePipelineStageInput,
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
 * Atomically reorders all pipeline stages. Admin only (MINCRM-381).
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
