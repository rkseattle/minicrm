/**
 * Shared Zod schemas for system settings validation.
 * Imported by both the server (validation middleware) and the client (form validation).
 */

import { z } from 'zod';

/** All language codes supported by the application */
export const SUPPORTED_LOCALES = ['en', 'zh-Hans', 'es', 'fr', 'de'] as const;

/** All navigation layout options supported by the application (MINCRM-133) */
export const NAV_LAYOUTS = ['top', 'left', 'hamburger'] as const;

/**
 * Schema for the PATCH /api/settings/default-language request body.
 */
export const setDefaultLanguageSchema = z.object({
  language: z.enum(SUPPORTED_LOCALES, {
    errorMap: (issue) =>
      issue.code === 'invalid_type' && issue.received === 'undefined'
        ? { message: 'Language is required' }
        : { message: `Language must be one of: ${SUPPORTED_LOCALES.join(', ')}` },
  }),
});

/** The shape returned by GET /api/settings/default-language */
export const defaultLanguageResponseSchema = z.object({
  language: z.enum(SUPPORTED_LOCALES),
});

/**
 * Schema for the PATCH /api/settings/nav-layout request body.
 */
export const setNavLayoutSchema = z.object({
  layout: z.enum(NAV_LAYOUTS, {
    errorMap: (issue) =>
      issue.code === 'invalid_type' && issue.received === 'undefined'
        ? { message: 'Layout is required' }
        : { message: `Layout must be one of: ${NAV_LAYOUTS.join(', ')}` },
  }),
});

/** The shape returned by GET /api/settings/nav-layout */
export const navLayoutResponseSchema = z.object({
  layout: z.enum(NAV_LAYOUTS),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type NavLayout = (typeof NAV_LAYOUTS)[number];
export type SetDefaultLanguageInput = z.infer<typeof setDefaultLanguageSchema>;
export type DefaultLanguageResponse = z.infer<typeof defaultLanguageResponseSchema>;
export type SetNavLayoutInput = z.infer<typeof setNavLayoutSchema>;
export type NavLayoutResponse = z.infer<typeof navLayoutResponseSchema>;
