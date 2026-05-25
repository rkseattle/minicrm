/**
 * Pipelines API module (MINCRM-397).
 * Wraps the /api/v1/pipelines endpoints.
 * GET requires authentication; POST/PATCH/DELETE require admin auth.
 */

import apiClient from './axiosInstance.js';
import type {
  PipelineResponse,
  CreatePipelineInput,
  UpdatePipelineInput,
} from '@shared/schemas/pipelineSchema.js';

/** React Query cache key for the pipelines list */
export const PIPELINES_QUERY_KEY = ['pipelines'] as const;

/** Shape returned by GET /api/v1/pipelines */
export interface PipelinesListResponse {
  pipelines: PipelineResponse[];
}

/**
 * Returns all pipelines, default-first then alphabetical.
 */
export async function listPipelines(): Promise<PipelinesListResponse> {
  const response = await apiClient.get<PipelinesListResponse>('/pipelines');
  return response.data;
}

/**
 * Creates a new pipeline. Admin only.
 */
export async function createPipeline(params: CreatePipelineInput): Promise<PipelineResponse> {
  const response = await apiClient.post<PipelineResponse>('/pipelines', params);
  return response.data;
}

/**
 * Renames a pipeline. Admin only.
 */
export async function updatePipeline(
  id: string,
  params: UpdatePipelineInput,
): Promise<PipelineResponse> {
  const response = await apiClient.patch<PipelineResponse>(`/pipelines/${id}`, params);
  return response.data;
}

/**
 * Deletes a non-default pipeline. Admin only.
 * Returns the deleted pipeline's id on success.
 */
export async function deletePipeline(id: string): Promise<{ id: string }> {
  const response = await apiClient.delete<{ id: string }>(`/pipelines/${id}`);
  return response.data;
}
