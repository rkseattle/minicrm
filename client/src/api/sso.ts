/**
 * SSO API module. (MINCRM-399)
 * Wraps the SSO configuration and status endpoints.
 */

import apiClient from './axiosInstance.js';
import type {
  SsoConfigPublic,
  SsoStatusResponse,
  SetSsoConfigInput,
} from '@shared/schemas/settingsSchema.js';

// ── Query keys ────────────────────────────────────────────────────────────────

/** React Query cache key for the admin SSO configuration */
export const SSO_CONFIG_QUERY_KEY = ['settings', 'sso'] as const;

/** React Query cache key for the public SSO status (login page) */
export const SSO_STATUS_QUERY_KEY = ['settings', 'sso', 'status'] as const;

// ── Response types ────────────────────────────────────────────────────────────

export interface GetSsoConfigResponse {
  sso: SsoConfigPublic | null;
}

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * Returns the current SSO configuration. Admin only.
 * Returns { sso: null } when SSO is not configured.
 */
export async function getSsoConfig(): Promise<GetSsoConfigResponse> {
  const response = await apiClient.get<GetSsoConfigResponse>('/settings/sso');
  return response.data;
}

/**
 * Returns whether SSO is enabled and which protocol is configured.
 * Used by the login page — authenticated but not admin-only.
 */
export async function getSsoStatus(): Promise<SsoStatusResponse> {
  const response = await apiClient.get<SsoStatusResponse>('/settings/sso/status');
  return response.data;
}

/**
 * Saves SSO configuration and enables SSO. Admin only.
 */
export async function putSsoConfig(config: SetSsoConfigInput): Promise<GetSsoConfigResponse> {
  const response = await apiClient.put<GetSsoConfigResponse>('/settings/sso', config);
  return response.data;
}

/**
 * Clears SSO configuration and disables SSO. Admin only.
 */
export async function deleteSsoConfig(): Promise<void> {
  await apiClient.delete('/settings/sso');
}
