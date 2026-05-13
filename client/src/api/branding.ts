/**
 * Branding API module. (MINCRM-356)
 * Wraps the custom branding settings endpoints.
 * GET is unauthenticated (public); PUT/DELETE require admin auth.
 */

import apiClient from './axiosInstance.js';
import type {
  BrandingConfig,
  BrandingResponse,
  SetBrandingInput,
} from '@shared/schemas/brandingSchema.js';

export type { BrandingConfig };

/** React Query cache key for the branding configuration (1-hour staleTime). */
export const BRANDING_QUERY_KEY = ['settings', 'branding'] as const;

/**
 * Returns the current branding configuration, or null when none is configured.
 * Called at app init before auth resolves so the login page reflects branding.
 */
export async function getBranding(): Promise<BrandingResponse> {
  const response = await apiClient.get<BrandingResponse>('/settings/branding');
  return response.data;
}

/**
 * Merges and persists a branding configuration. Admin only.
 *
 * @param input - Branding fields to save (partial update).
 */
export async function putBranding(input: SetBrandingInput): Promise<BrandingResponse> {
  const response = await apiClient.put<BrandingResponse>('/settings/branding', input);
  return response.data;
}

/**
 * Resets all branding to defaults. Admin only.
 */
export async function deleteBranding(): Promise<BrandingResponse> {
  const response = await apiClient.delete<BrandingResponse>('/settings/branding');
  return response.data;
}
