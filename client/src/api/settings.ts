/**
 * Settings API module.
 * Wraps the system settings endpoints.
 * GET is unauthenticated; PATCH requires admin auth.
 */

import apiClient from './axiosInstance.js';
import type {
  DefaultLanguageResponse,
  SupportedLocale,
  NavLayoutResponse,
  NavLayout,
} from '@shared/schemas/settingsSchema.js';

/** React Query cache key for the default language setting */
export const DEFAULT_LANGUAGE_QUERY_KEY = ['settings', 'defaultLanguage'] as const;

/**
 * Returns the current system-wide default language.
 * Called on app load before auth is resolved.
 */
export async function getDefaultLanguage(): Promise<DefaultLanguageResponse> {
  const response = await apiClient.get<DefaultLanguageResponse>('/settings/default-language');
  return response.data;
}

/**
 * Updates the system-wide default language. Admin only.
 *
 * @param language - One of the supported locale codes.
 */
export async function setDefaultLanguage(
  language: SupportedLocale,
): Promise<DefaultLanguageResponse> {
  const response = await apiClient.patch<DefaultLanguageResponse>('/settings/default-language', {
    language,
  });
  return response.data;
}

/** React Query cache key for the nav layout setting (MINCRM-133) */
export const NAV_LAYOUT_QUERY_KEY = ['settings', 'navLayout'] as const;

/**
 * Returns the current system-wide navigation layout.
 * Called before auth resolves so the shell can render immediately.
 */
export async function getNavLayout(): Promise<NavLayoutResponse> {
  const response = await apiClient.get<NavLayoutResponse>('/settings/nav-layout');
  return response.data;
}

/**
 * Updates the system-wide navigation layout. Admin only. (MINCRM-133)
 *
 * @param layout - One of the supported nav layout values.
 */
export async function setNavLayout(layout: NavLayout): Promise<NavLayoutResponse> {
  const response = await apiClient.patch<NavLayoutResponse>('/settings/nav-layout', { layout });
  return response.data;
}
