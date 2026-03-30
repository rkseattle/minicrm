/**
 * Shared Zod schemas for system settings validation.
 * Imported by both the server (validation middleware) and the client (form validation).
 */

import { z } from 'zod';

/** All language codes supported by the application */
export const SUPPORTED_LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;

/** Human-readable display names for each supported locale */
export const LOCALE_DISPLAY_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

/**
 * Schema for the PATCH /api/settings/default-language request body.
 */
export const setDefaultLanguageSchema = z.object({
  language: z.enum(SUPPORTED_LOCALES, {
    required_error: 'Language is required',
    invalid_type_error: `Language must be one of: ${SUPPORTED_LOCALES.join(', ')}`,
  }),
});

/** The shape returned by GET /api/settings/default-language */
export const defaultLanguageResponseSchema = z.object({
  language: z.enum(SUPPORTED_LOCALES),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type SetDefaultLanguageInput = z.infer<typeof setDefaultLanguageSchema>;
export type DefaultLanguageResponse = z.infer<typeof defaultLanguageResponseSchema>;
