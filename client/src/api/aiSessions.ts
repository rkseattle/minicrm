/**
 * AI sessions API module.
 * Wraps the multi-session conversation endpoints. All endpoints require authentication
 * and the ai_nli_page feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type {
  AiSessionResponse,
  AiMessageResponse,
  AiSessionWithMessagesResponse,
} from '@shared/schemas/aiSessionSchema.js';

export const AI_SESSIONS_QUERY_KEY = ['ai_sessions'] as const;

export function aiMessagesQueryKey(sessionId: string): readonly [string, string] {
  return ['ai_session_messages', sessionId] as const;
}

interface ListSessionsResponse {
  sessions: AiSessionResponse[];
}

export async function listAiSessions(): Promise<AiSessionResponse[]> {
  const response = await apiClient.get<ListSessionsResponse>('/ai/sessions');
  return response.data.sessions;
}

export async function createAiSession(): Promise<AiSessionResponse> {
  const response = await apiClient.post<AiSessionResponse>('/ai/sessions', {});
  return response.data;
}

export async function getAiSession(sessionId: string): Promise<AiSessionWithMessagesResponse> {
  const response = await apiClient.get<AiSessionWithMessagesResponse>(`/ai/sessions/${sessionId}`);
  return response.data;
}

export async function deleteAiSession(sessionId: string): Promise<void> {
  await apiClient.delete(`/ai/sessions/${sessionId}`);
}

export async function sendAiMessage(
  sessionId: string,
  content: string,
): Promise<AiMessageResponse> {
  const response = await apiClient.post<AiMessageResponse>(`/ai/sessions/${sessionId}/messages`, {
    content,
  });
  return response.data;
}
