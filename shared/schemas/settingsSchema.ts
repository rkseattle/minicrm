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

// ── SSO schemas (MINCRM-399) ──────────────────────────────────────────────────

/** Supported SSO protocols */
export const SSO_PROTOCOLS = ['saml', 'oidc'] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

/**
 * Schema for PUT /api/v1/settings/sso request body.
 * The SAML IdP certificate is optional — when the IdP metadata URL is set the
 * certificate can be fetched from the metadata document instead of configured manually.
 */
export const setSsoConfigSchema = z.object({
  protocol: z.enum(SSO_PROTOCOLS, {
    errorMap: () => ({ message: `Protocol must be one of: ${SSO_PROTOCOLS.join(', ')}` }),
  }),
  idp_metadata_url: z
    .string()
    .url({ message: 'IdP metadata URL must be a valid URL' })
    .max(2048, { message: 'IdP metadata URL must be 2048 characters or fewer' }),
  entity_id: z
    .string()
    .min(1, { message: 'Entity ID is required' })
    .max(512, { message: 'Entity ID must be 512 characters or fewer' }),
  /** PEM-encoded X.509 certificate — required for SAML, ignored for OIDC */
  idp_certificate: z
    .string()
    .max(8192, { message: 'IdP certificate must be 8192 characters or fewer' })
    .optional(),
});

export type SetSsoConfigInput = z.infer<typeof setSsoConfigSchema>;

/** Public shape returned by GET /api/v1/settings/sso (certificate never returned) */
export interface SsoConfigPublic {
  protocol: SsoProtocol;
  idp_metadata_url: string;
  entity_id: string;
  /** True when a certificate has been stored; the value is never returned */
  idp_certificate_set: boolean;
}

/** Shape returned by GET /api/v1/settings/sso/status (unauthenticated-safe) */
export interface SsoStatusResponse {
  enabled: boolean;
  protocol: SsoProtocol | null;
}

// ── AI configuration schemas (MINCRM-457) ─────────────────────────────────────

/** Supported AI providers. Extend this list when adding new providers. */
export const AI_PROVIDERS = ['anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Deployment modes that control where AI inference traffic is routed. */
export const AI_DEPLOYMENT_MODES = ['cloud_api', 'private_endpoint', 'self_hosted'] as const;
export type AiDeploymentMode = (typeof AI_DEPLOYMENT_MODES)[number];

/**
 * DPA compliance status derived from the combination of acknowledgment state
 * and whether the provider has changed since the last acknowledgment.
 */
export type AiDpaStatus = 'acknowledged' | 'not_acknowledged' | 'provider_changed';

/**
 * Composite data-posture indicator shown in the /admin/ai header.
 * Combines deployment mode and DPA status per the AC matrix.
 */
export type AiDataPosture = 'green' | 'amber' | 'red';

/** A single model entry returned in the available_models list. */
export interface AiModelOption {
  id: string;
  display_name: string;
  provider: AiProvider;
}

/**
 * Public shape returned by GET /api/v1/admin/ai/config.
 * The raw API key is never returned — only the boolean indicator.
 */
export interface AiConfigResponse {
  enabled: boolean;
  enabled_updated_at: string | null;
  provider: AiProvider;
  model: string;
  /** True when an encrypted API key is stored; the plaintext is never returned. */
  api_key_set: boolean;
  deployment_mode: AiDeploymentMode;
  /** Required and non-empty for private_endpoint and self_hosted modes. */
  base_url: string;
  dpa_acknowledged: boolean;
  dpa_acknowledged_by: string;
  dpa_acknowledged_at: string | null;
  /** The provider that was active when the DPA was last acknowledged. */
  dpa_acknowledged_for_provider: string;
  custom_dpa_url: string;
  /** Derived compliance status for UI badge rendering. */
  dpa_status: AiDpaStatus;
  /** Composite data posture indicator for the /admin/ai header. */
  data_posture: AiDataPosture;
  /** Server-managed list of available models for the selected provider. */
  available_models: AiModelOption[];
  /** Standard DPA URL for the selected provider. */
  provider_dpa_url: string;
}

/**
 * Schema for PATCH /api/v1/admin/ai/config request body.
 * api_key is optional — omitting it leaves the stored key unchanged.
 * base_url is required when deployment_mode is private_endpoint or self_hosted.
 */
export const setAiConfigSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS, {
      errorMap: () => ({ message: `Provider must be one of: ${AI_PROVIDERS.join(', ')}` }),
    }),
    model: z.string().min(1, { message: 'Model is required' }).max(100),
    api_key: z.string().max(512, { message: 'API key must be 512 characters or fewer' }).optional(),
    deployment_mode: z.enum(AI_DEPLOYMENT_MODES, {
      errorMap: () => ({
        message: `Deployment mode must be one of: ${AI_DEPLOYMENT_MODES.join(', ')}`,
      }),
    }),
    base_url: z
      .string()
      .max(2048, { message: 'Base URL must be 2048 characters or fewer' })
      .optional()
      .default(''),
    custom_dpa_url: z
      .string()
      .max(2048, { message: 'Custom DPA URL must be 2048 characters or fewer' })
      .optional()
      .default(''),
  })
  .superRefine((val, ctx) => {
    const requiresBaseUrl =
      val.deployment_mode === 'private_endpoint' || val.deployment_mode === 'self_hosted';
    if (requiresBaseUrl && (!val.base_url || val.base_url.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Base URL is required for Private Endpoint and Self-Hosted deployment modes',
        path: ['base_url'],
      });
    }
    if (val.base_url && val.base_url.trim() !== '') {
      const urlResult = z.string().url().safeParse(val.base_url);
      if (!urlResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Base URL must be a valid URL',
          path: ['base_url'],
        });
      }
    }
    if (val.custom_dpa_url && val.custom_dpa_url.trim() !== '') {
      const urlResult = z.string().url().safeParse(val.custom_dpa_url);
      if (!urlResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom DPA URL must be a valid URL',
          path: ['custom_dpa_url'],
        });
      }
    }
  });

export type SetAiConfigInput = z.infer<typeof setAiConfigSchema>;

/** Schema for PATCH /api/v1/admin/ai/master-toggle request body. */
export const setAiEnabledSchema = z.object({
  enabled: z.boolean({ required_error: 'enabled is required' }),
});

export type SetAiEnabledInput = z.infer<typeof setAiEnabledSchema>;

/** Schema for POST /api/v1/admin/ai/dpa-acknowledgment request body. */
export const setAiDpaAcknowledgmentSchema = z.object({
  acknowledged: z.boolean({ required_error: 'acknowledged is required' }),
  custom_dpa_url: z
    .string()
    .max(2048, { message: 'Custom DPA URL must be 2048 characters or fewer' })
    .optional()
    .default(''),
});

export type SetAiDpaAcknowledgmentInput = z.infer<typeof setAiDpaAcknowledgmentSchema>;

/** Schema for POST /api/v1/admin/ai/test-connection request body. */
export const testAiConnectionSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS, {
      errorMap: () => ({ message: `Provider must be one of: ${AI_PROVIDERS.join(', ')}` }),
    }),
    model: z.string().min(1, { message: 'Model is required' }).max(100),
    /** If omitted, the stored API key is used for the test. */
    api_key: z.string().max(512).optional(),
    deployment_mode: z.enum(AI_DEPLOYMENT_MODES),
    base_url: z.string().max(2048).optional().default(''),
  })
  .superRefine((val, ctx) => {
    const requiresBaseUrl =
      val.deployment_mode === 'private_endpoint' || val.deployment_mode === 'self_hosted';
    if (requiresBaseUrl && (!val.base_url || val.base_url.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Base URL is required for Private Endpoint and Self-Hosted deployment modes',
        path: ['base_url'],
      });
    }
  });

export type TestAiConnectionInput = z.infer<typeof testAiConnectionSchema>;

/** Shape returned by POST /api/v1/admin/ai/test-connection */
export interface TestAiConnectionResponse {
  ok: boolean;
  message: string;
}

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
