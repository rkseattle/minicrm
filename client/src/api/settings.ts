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
import type {
  VisibilityConfig,
  UpdateVisibilityConfigInput,
} from '@shared/schemas/visibilitySchema.js';

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

/** React Query cache key for the nav layout setting */
export const NAV_LAYOUT_QUERY_KEY = ['settings', 'navLayout'] as const;

/**
 * Returns the current workspace-wide navigation layout.
 * The endpoint is public, but the only caller now sits below the auth boundary.
 */
export async function getNavLayout(): Promise<NavLayoutResponse> {
  const response = await apiClient.get<NavLayoutResponse>('/settings/nav-layout');
  return response.data;
}

/**
 * Updates the system-wide navigation layout. Admin only.
 *
 * @param layout - One of the supported nav layout values.
 */
export async function setNavLayout(layout: NavLayout): Promise<NavLayoutResponse> {
  const response = await apiClient.patch<NavLayoutResponse>('/settings/nav-layout', { layout });
  return response.data;
}

// ── Email notifications global toggle ───────────────────────────

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

// ── Default currency ─────────────────────────────────────────────

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
 * Updates the system-wide default currency. Admin only.
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

// ── Exchange rate configuration ──────────────────────────────────

/** React Query cache key for the currencies configuration */
export const CURRENCIES_CONFIG_QUERY_KEY = ['settings', 'currenciesConfig'] as const;

/** Shape of a single currency row returned from the currencies API */
export interface CurrencyConfigRow {
  code: string;
  name: string;
  symbol: string;
  rate_to_home: number;
  is_home: boolean;
  updated_at: string;
}

/** Shape of the full currencies configuration response */
export interface CurrenciesConfigResponse {
  home_currency: string;
  currencies: CurrencyConfigRow[];
}

/**
 * Returns the full exchange rate configuration from the server.
 */
export async function getCurrenciesConfig(): Promise<CurrenciesConfigResponse> {
  const response = await apiClient.get<CurrenciesConfigResponse>('/settings/currencies');
  return response.data;
}

/**
 * Replaces the full exchange rate configuration. Admin only.
 *
 * @param payload - Home currency code and array of non-home currencies with rates.
 */
export async function updateCurrenciesConfig(payload: {
  home_currency: string;
  currencies: Array<{ code: string; name: string; symbol: string; rate_to_home: number }>;
}): Promise<CurrenciesConfigResponse> {
  const response = await apiClient.put<CurrenciesConfigResponse>('/settings/currencies', payload);
  return response.data;
}

// ── Tag creation restriction ─────────────────────────────────────

/** Shape returned by the tags-restrict-creation endpoints */
export interface TagsRestrictCreationResponse {
  restricted: boolean;
}

/** React Query cache key for the tags restrict creation setting */
export const TAGS_RESTRICT_CREATION_QUERY_KEY = ['settings', 'tagsRestrictCreation'] as const;

/**
 * Returns whether tag creation is restricted to the Tag Management page.
 * Requires authentication — reps need this to know whether to show the "create" option.
 */
export async function getTagsRestrictCreation(): Promise<TagsRestrictCreationResponse> {
  const response = await apiClient.get<TagsRestrictCreationResponse>(
    '/settings/tags-restrict-creation',
  );
  return response.data;
}

/**
 * Sets whether tag creation is restricted. Admin only.
 *
 * @param restricted - Whether to restrict inline tag creation to admins only.
 */
export async function setTagsRestrictCreation(
  restricted: boolean,
): Promise<TagsRestrictCreationResponse> {
  const response = await apiClient.patch<TagsRestrictCreationResponse>(
    '/settings/tags-restrict-creation',
    { restricted },
  );
  return response.data;
}

// ── SMTP configuration ───────────────────────────────────────────

/** Shape returned by GET /api/v1/settings/smtp */
export interface SmtpConfigResponse {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass_set: boolean;
  smtp_enabled: boolean;
}

/** React Query cache key for the SMTP configuration */
export const SMTP_CONFIG_QUERY_KEY = ['settings', 'smtp'] as const;

/**
 * Returns the current SMTP configuration.
 * smtp_pass is never included; smtp_pass_set indicates whether one is stored.
 */
export async function getSmtpConfig(): Promise<SmtpConfigResponse> {
  const response = await apiClient.get<SmtpConfigResponse>('/settings/smtp');
  return response.data;
}

/**
 * Updates the SMTP configuration. Admin only.
 * Omit smtp_pass to preserve the stored password.
 *
 * @param payload - SMTP settings to save.
 */
export async function setSmtpConfig(payload: {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass?: string;
  smtp_enabled: boolean;
}): Promise<SmtpConfigResponse> {
  const response = await apiClient.put<SmtpConfigResponse>('/settings/smtp', payload);
  return response.data;
}

/** Shape returned by POST /api/v1/settings/smtp/test */
export interface SmtpTestResult {
  success: boolean;
  error?: string;
}

/**
 * Sends a test email using the current saved SMTP configuration. Admin only.
 *
 * @param to - Recipient email address.
 */
export async function testSmtpConfig(to: string): Promise<SmtpTestResult> {
  const response = await apiClient.post<SmtpTestResult>('/settings/smtp/test', { to });
  return response.data;
}

// ── Data visibility policies ─────────────────────────────────────

/** Shape returned by GET/PUT /api/v1/settings/visibility */
export interface VisibilityConfigResponse {
  visibility: VisibilityConfig;
}

/** React Query cache key for the visibility config */
export const VISIBILITY_CONFIG_QUERY_KEY = ['settings', 'visibility'] as const;

/**
 * Returns the current per-object-type visibility policies.
 * Accessible to admin and manager roles.
 */
export async function getVisibilityConfig(): Promise<VisibilityConfigResponse> {
  const response = await apiClient.get<VisibilityConfigResponse>('/settings/visibility');
  return response.data;
}

/**
 * Updates one or more per-object-type visibility policies. Admin only.
 *
 * @param updates - Partial config; only provided keys are updated.
 */
export async function putVisibilityConfig(
  updates: UpdateVisibilityConfigInput,
): Promise<VisibilityConfigResponse> {
  const response = await apiClient.put<VisibilityConfigResponse>('/settings/visibility', updates);
  return response.data;
}
