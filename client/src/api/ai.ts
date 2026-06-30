/**
 * AI configuration and token budget API module.
 * Wraps admin AI configuration and token budget endpoints.
 * (MINCRM-457, MINCRM-458)
 */

import apiClient from './axiosInstance.js';
import type {
  AiConfigResponse,
  SetAiConfigInput,
  SetAiEnabledInput,
  SetAiDpaAcknowledgmentInput,
  SetAiSessionRetentionInput,
  TestAiConnectionInput,
  TestAiConnectionResponse,
  AiTokenBudgetsResponse,
  AiTokenBudgetStatusResponse,
  SetOrgTokenBudgetInput,
  SetUserTokenBudgetInput,
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

/**
 * Updates the AI session retention window (days). Minimum 30, maximum 3650.
 */
export async function setAiSessionRetention(
  patch: SetAiSessionRetentionInput,
): Promise<AiConfigResponse> {
  const response = await apiClient.patch<AiConfigResponse>('/admin/ai/session-retention', patch);
  return response.data;
}

// ── Token budget API (MINCRM-458) ─────────────────────────────────────────────

/** React Query cache key for the admin AI token budgets summary */
export const AI_TOKEN_BUDGETS_QUERY_KEY = ['admin', 'ai', 'token-budgets'] as const;

/** React Query cache key for the current user's budget status */
export const MY_TOKEN_BUDGET_QUERY_KEY = ['ai', 'token-budget', 'me'] as const;

/**
 * Returns the org token budget, per-user overrides, and current-month consumption.
 * Admin only.
 */
export async function getAiTokenBudgets(): Promise<AiTokenBudgetsResponse> {
  const response = await apiClient.get<AiTokenBudgetsResponse>('/admin/ai/token-budgets');
  return response.data;
}

/**
 * Sets the org-wide monthly token limit.
 * 0 means unlimited (no enforcement). Admin only.
 */
export async function setOrgTokenBudget(
  input: SetOrgTokenBudgetInput,
): Promise<{ monthly_limit: number }> {
  const response = await apiClient.patch<{ monthly_limit: number }>(
    '/admin/ai/token-budgets/org',
    input,
  );
  return response.data;
}

/**
 * Sets or removes a per-user monthly token limit override.
 * Pass monthly_limit: null to remove the override (user inherits org default). Admin only.
 */
export async function setUserTokenBudget(
  userId: string,
  input: SetUserTokenBudgetInput,
): Promise<{ user_id: string; monthly_limit: number | null }> {
  const response = await apiClient.patch<{ user_id: string; monthly_limit: number | null }>(
    `/admin/ai/token-budgets/users/${userId}`,
    input,
  );
  return response.data;
}

/**
 * Returns the calling user's token budget status for the current calendar month.
 * Admins always receive status='ok' with limit=null.
 */
export async function getMyTokenBudgetStatus(): Promise<AiTokenBudgetStatusResponse> {
  const response = await apiClient.get<AiTokenBudgetStatusResponse>('/ai/token-budget/me');
  return response.data;
}
