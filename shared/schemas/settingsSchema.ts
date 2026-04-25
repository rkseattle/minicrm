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
 * Rich list of all currencies supported for deal values with display metadata. (MINCRM-251)
 * Used to populate currency pickers and seed the currencies table.
 */
export const SUPPORTED_CURRENCY_LIST = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
] as const;

/**
 * Plain array of ISO 4217 currency codes supported for deal values. (MINCRM-189)
 * Kept for backward compatibility with SupportedCurrency type and setDefaultCurrencySchema.
 */
export const SUPPORTED_CURRENCIES = SUPPORTED_CURRENCY_LIST.map(
  (c) => c.code,
) as unknown as readonly [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
  'CHF',
  'CNY',
  'INR',
  'BRL',
  'MXN',
  'SGD',
  'HKD',
  'NOK',
  'SEK',
  'DKK',
  'NZD',
  'ZAR',
  'AED',
  'SAR',
  'KRW',
  'TRY',
  'PLN',
  'THB',
  'IDR',
];

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
 * Schema for the PATCH /api/settings/default-currency request body. (MINCRM-189)
 */
export const setDefaultCurrencySchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES, {
    errorMap: (issue) =>
      issue.code === 'invalid_type' && issue.received === 'undefined'
        ? { message: 'Currency is required' }
        : { message: `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}` },
  }),
});

/** The shape returned by GET /api/settings/default-currency */
export const defaultCurrencyResponseSchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
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
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
export type SetDefaultLanguageInput = z.infer<typeof setDefaultLanguageSchema>;
export type DefaultLanguageResponse = z.infer<typeof defaultLanguageResponseSchema>;
export type SetDefaultCurrencyInput = z.infer<typeof setDefaultCurrencySchema>;
export type DefaultCurrencyResponse = z.infer<typeof defaultCurrencyResponseSchema>;
export type SetNavLayoutInput = z.infer<typeof setNavLayoutSchema>;
export type NavLayoutResponse = z.infer<typeof navLayoutResponseSchema>;

// ── Exchange rate schemas (MINCRM-251) ─────────────────────────────────────────

/**
 * Shape of a single row in the currencies table as returned by the API.
 */
export const currencyRowSchema = z.object({
  code: z.string().min(1).max(3),
  name: z.string().min(1).max(64),
  symbol: z.string().min(1).max(8),
  rate_to_home: z.number().positive(),
});

/**
 * Schema for the PUT /api/settings/currencies request body.
 * home_currency must not appear in the currencies array (it is always rate 1.0).
 * Codes in the currencies array must be distinct.
 */
export const updateCurrenciesSchema = z
  .object({
    home_currency: z.string().min(1).max(3),
    currencies: z.array(currencyRowSchema).max(20),
  })
  .superRefine((val, ctx) => {
    const codes = val.currencies.map((c) => c.code);
    const uniqueCodes = new Set(codes);
    if (uniqueCodes.size !== codes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Currency codes must be distinct',
        path: ['currencies'],
      });
    }
    if (codes.includes(val.home_currency)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Home currency must not appear in the currencies array',
        path: ['currencies'],
      });
    }
  });

export type CurrencyRow = z.infer<typeof currencyRowSchema>;
export type UpdateCurrenciesInput = z.infer<typeof updateCurrenciesSchema>;

/** Shape of the full currency configuration returned by GET /api/settings/currencies */
export interface CurrencyConfig {
  home_currency: string;
  currencies: Array<{
    code: string;
    name: string;
    symbol: string;
    rate_to_home: number;
    is_home: boolean;
    updated_at: string;
  }>;
}
