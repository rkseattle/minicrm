/**
 * AI configuration API module.
 * Wraps the admin AI configuration endpoints.
 * All calls require admin authentication.
 * (MINCRM-457)
 */

import apiClient from './axiosInstance.js';
import type {
  AiConfigResponse,
  SetAiConfigInput,
  SetAiEnabledInput,
  SetAiDpaAcknowledgmentInput,
  TestAiConnectionInput,
  TestAiConnectionResponse,
} from '@shared/schemas/settingsSchema.js';

/** React Query cache key for the AI configuration */
export const AI_CONFIG_QUERY_KEY = ['admin', 'ai', 'config'] as const;

/**
 * Returns the full AI provider/model configuration.
 * The raw API key is never returned — only the api_key_set boolean indicator.
 */
export async function getAiConfig(): Promise<AiConfigResponse> {
  const response = await apiClient.get<AiConfigResponse>('/admin/ai/config');
  return response.data;
}

/**
 * Updates the AI provider, model, API key, deployment mode, and DPA URL.
 * Omit api_key to leave the stored key unchanged.
 */
export async function setAiConfig(patch: SetAiConfigInput): Promise<AiConfigResponse> {
  const response = await apiClient.patch<AiConfigResponse>('/admin/ai/config', patch);
  return response.data;
}

/**
 * Enables or disables all AI features globally.
 * Changing this requires a confirmation dialog in the UI.
 */
export async function setAiEnabled(patch: SetAiEnabledInput): Promise<AiConfigResponse> {
  const response = await apiClient.patch<AiConfigResponse>('/admin/ai/master-toggle', patch);
  return response.data;
}

/**
 * Records or resets the DPA acknowledgment for the current provider.
 */
export async function setAiDpaAcknowledgment(
  patch: SetAiDpaAcknowledgmentInput,
): Promise<AiConfigResponse> {
  const response = await apiClient.post<AiConfigResponse>('/admin/ai/dpa-acknowledgment', patch);
  return response.data;
}

/**
 * Tests the API key and model against the provider.
 * Omit api_key to test using the currently stored key.
 */
export async function testAiConnection(
  params: TestAiConnectionInput,
): Promise<TestAiConnectionResponse> {
  const response = await apiClient.post<TestAiConnectionResponse>(
    '/admin/ai/test-connection',
    params,
  );
  return response.data;
}
