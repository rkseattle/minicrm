/**
 * AI context API module.
 * Wraps the user context entry CRUD endpoints. All endpoints require authentication
 * and the ai_nli_page feature flag to be enabled.
 * (MINCRM-427, MINCRM-428)
 */

import apiClient from './axiosInstance.js';
import type { AiContextEntryResponse } from '@shared/schemas/aiContextSchema.js';

export const AI_CONTEXT_QUERY_KEY = ['ai_context'] as const;

interface ListContextResponse {
  entries: AiContextEntryResponse[];
}

export async function listAiContext(): Promise<AiContextEntryResponse[]> {
  const response = await apiClient.get<ListContextResponse>('/ai/context');
  return response.data.entries;
}

export async function createAiContextEntry(
  key: string,
  value: string,
): Promise<AiContextEntryResponse> {
  const response = await apiClient.post<AiContextEntryResponse>('/ai/context', { key, value });
  return response.data;
}

export async function updateAiContextEntry(
  id: string,
  patch: { key?: string; value?: string },
): Promise<AiContextEntryResponse> {
  const response = await apiClient.patch<AiContextEntryResponse>(`/ai/context/${id}`, patch);
  return response.data;
}

export async function deleteAiContextEntry(id: string): Promise<void> {
  await apiClient.delete(`/ai/context/${id}`);
}
