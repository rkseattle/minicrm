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
  DefaultCurrencyResponse,
  SupportedCurrency,
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

// ── Email notifications global toggle (MINCRM-163) ───────────────────────────

/** Shape returned by the email notifications toggle endpoints */
export interface EmailNotificationsResponse {
  enabled: boolean;
}

/** React Query cache key for the email notifications enabled setting */
export const EMAIL_NOTIFICATIONS_QUERY_KEY = ['settings', 'emailNotifications'] as const;

/**
 * Returns whether the system-wide email notifications are enabled.
 * Requires authentication.
 */
export async function getEmailNotificationsEnabled(): Promise<EmailNotificationsResponse> {
  const response = await apiClient.get<EmailNotificationsResponse>('/settings/email-notifications');
  return response.data;
}

/**
 * Sets whether the system-wide email notifications are enabled. Admin only.
 *
 * @param enabled - Whether to enable or disable email notifications globally.
 */
export async function setEmailNotificationsEnabled(
  enabled: boolean,
): Promise<EmailNotificationsResponse> {
  const response = await apiClient.patch<EmailNotificationsResponse>(
    '/settings/email-notifications',
    { enabled },
  );
  return response.data;
}

// ── Default currency (MINCRM-189) ─────────────────────────────────────────────

/** React Query cache key for the default currency setting */
export const DEFAULT_CURRENCY_QUERY_KEY = ['settings', 'defaultCurrency'] as const;

/**
 * Returns the current system-wide default currency.
 * Called before auth resolves so the deal form can pre-select the right currency.
 */
export async function getDefaultCurrency(): Promise<DefaultCurrencyResponse> {
  const response = await apiClient.get<DefaultCurrencyResponse>('/settings/default-currency');
  return response.data;
}

/**
 * Updates the system-wide default currency. Admin only. (MINCRM-189)
 *
 * @param currency - One of the supported ISO 4217 currency codes.
 */
export async function setDefaultCurrency(
  currency: SupportedCurrency,
): Promise<DefaultCurrencyResponse> {
  const response = await apiClient.patch<DefaultCurrencyResponse>('/settings/default-currency', {
    currency,
  });
  return response.data;
}
