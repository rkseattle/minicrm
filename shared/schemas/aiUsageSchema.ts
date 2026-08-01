/**
 * Shared Zod schemas and types for AI usage/cost dashboard and cost rate
 * configuration. (MINCRM-459)
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';

/**
 * Known AI feature names that record token usage. Not a DB constraint —
 * ai_token_usage_daily.feature is free text so new features can start
 * recording usage without a migration. This list is purely for dashboard
 * labels/filters; the only feature that records usage today is 'nli_chat'.
 */
export const AI_FEATURE_NAMES = ['nli_chat'] as const;
export type AiFeatureName = (typeof AI_FEATURE_NAMES)[number];

/** Request body for PATCH /api/v1/admin/ai/cost-rates. */
export const setAiCostRatesSchema = z.object({
  ai_input_cost_per_million_cents: z
    .number({ required_error: 'ai_input_cost_per_million_cents is required' })
    .int({ message: 'ai_input_cost_per_million_cents must be an integer' })
    .min(0, { message: 'Cost rate must be nonnegative' })
    .max(1_000_000, { message: 'Cost rate must be at most 1,000,000 cents per million tokens' }),
  ai_output_cost_per_million_cents: z
    .number({ required_error: 'ai_output_cost_per_million_cents is required' })
    .int({ message: 'ai_output_cost_per_million_cents must be an integer' })
    .min(0, { message: 'Cost rate must be nonnegative' })
    .max(1_000_000, { message: 'Cost rate must be at most 1,000,000 cents per million tokens' }),
});

export type SetAiCostRatesInput = z.infer<typeof setAiCostRatesSchema>;

/** Date range query for usage summary/daily-series endpoints. */
export const usageDateRangePresetSchema = z.enum(['current_month', 'last_month', 'last_3_months']);
export type UsageDateRangePreset = z.infer<typeof usageDateRangePresetSchema>;

/**
 * Accepts either a date-only `YYYY-MM-DD` (what the client's date pickers send)
 * or a full ISO 8601 timestamp (what the OpenAPI spec has always advertised as
 * `format: date-time`, and what any non-first-party consumer may be sending).
 *
 * Deliberately permissive on the date-time form rather than date-only: before
 * boundary validation existed, these params reached `new Date(value)` directly,
 * so every parseable timestamp was accepted. Narrowing to date-only here would
 * have been a silent breaking change for existing API consumers. (MINCRM-700)
 */
const usageDateParamSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/,
    'must be a YYYY-MM-DD date or an ISO 8601 timestamp',
  )
  .refine((value) => !isNaN(new Date(value).getTime()), {
    message: 'must be a valid calendar date',
  });

/**
 * Query params for the usage summary/daily/export endpoints. Validated in the
 * controller before the service is called, per the boundary-validation rule.
 *
 * Every field is optional and the shape is permissive on purpose: which
 * combinations are legal (start and end together; preset alone; neither, which
 * defaults to current_month) is calendar logic, resolved by resolveDateRange.
 * This schema's job is only to reject values that are not of the right form
 * before they reach it.
 */
export const usageDateRangeParamsSchema = z.object({
  start: usageDateParamSchema.optional(),
  end: usageDateParamSchema.optional(),
  preset: usageDateRangePresetSchema.optional(),
});
export type UsageDateRangeParams = z.infer<typeof usageDateRangeParamsSchema>;

/** A single user's usage/cost/budget row in the usage summary. */
export interface PerUserUsageRow {
  user_id: string;
  user_name: string;
  user_email: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_cents: number;
  budget_percentage: number | null;
  top_feature: string | null;
}

/** A single feature's usage/cost row in the usage summary. */
export interface PerFeatureUsageRow {
  feature: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_cents: number;
}

/** One day's token totals, for the daily consumption chart. */
export interface DailyUsagePoint {
  date: string;
  input_tokens: number;
  output_tokens: number;
}

/** Response shape for GET /api/v1/admin/ai/usage/summary. */
export interface UsageSummaryResponse {
  range_start: string;
  range_end: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_cents: number;
  /** Estimated cost for the equivalent-length prior period, for trend comparison. */
  prior_period_estimated_cost_cents: number;
  per_user: PerUserUsageRow[];
  per_feature: PerFeatureUsageRow[];
  ai_input_cost_per_million_cents: number;
  ai_output_cost_per_million_cents: number;
}

/** Response shape for GET /api/v1/admin/ai/usage/daily. */
export interface UsageDailySeriesResponse {
  range_start: string;
  range_end: string;
  points: DailyUsagePoint[];
}
