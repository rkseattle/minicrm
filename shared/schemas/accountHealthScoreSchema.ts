/**
 * Shared types for the AI relationship health scoring feature.
 * Used by both client and server.
 */

import { z } from 'zod';

export const ACCOUNT_HEALTH_STATES = [
  'strong',
  'healthy',
  'cooling',
  'at_risk',
  'dormant',
] as const;
export type AccountHealthState = (typeof ACCOUNT_HEALTH_STATES)[number];

export interface AccountHealthFactor {
  /** Plain-language description of a contributing factor, e.g. "No contact in 45 days". */
  description: string;
}

/** Current cached health score for a single account, or null when insufficient data exists. */
export interface AccountHealthScoreResponse {
  account_id: string;
  score: number;
  state: AccountHealthState;
  single_threaded_risk: boolean;
  /** Top 2-3 contributing factors, most impactful first. */
  contributing_factors: AccountHealthFactor[];
  computed_at: string;
}

export interface AccountHealthScorePoint {
  score: number;
  state: AccountHealthState;
  computed_at: string;
}

/** Up to 6 months of score history for the trend sparkline. */
export interface AccountHealthHistoryResponse {
  account_id: string;
  points: AccountHealthScorePoint[];
}

/** Query param for filtering the Account list view to At Risk / Dormant accounts. */
export const ACCOUNT_HEALTH_LIST_FILTER_STATES = ['at_risk', 'dormant'] as const;
export type AccountHealthListFilterState = (typeof ACCOUNT_HEALTH_LIST_FILTER_STATES)[number];

export const accountHealthListFilterSchema = z.object({
  health_status: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',') : []))
    .pipe(z.array(z.enum(ACCOUNT_HEALTH_LIST_FILTER_STATES))),
});

/** Admin-editable scoring weights/thresholds (account_health_scoring_config). */
export interface AccountHealthScoringConfig {
  frequency_weight: number;
  recency_weight: number;
  seniority_weight: number;
  sentiment_weight: number;
  breadth_weight: number;
  strong_threshold: number;
  healthy_threshold: number;
  cooling_threshold: number;
  at_risk_threshold: number;
  min_logged_activities: number;
  recency_window_days: number;
  single_threaded_window_days: number;
  updated_at: string;
}

export const setAccountHealthScoringConfigSchema = z
  .object({
    frequency_weight: z.number().min(0).max(1),
    recency_weight: z.number().min(0).max(1),
    seniority_weight: z.number().min(0).max(1),
    sentiment_weight: z.number().min(0).max(1),
    breadth_weight: z.number().min(0).max(1),
    strong_threshold: z.number().min(0).max(100),
    healthy_threshold: z.number().min(0).max(100),
    cooling_threshold: z.number().min(0).max(100),
    at_risk_threshold: z.number().min(0).max(100),
    min_logged_activities: z.number().int().min(1),
    recency_window_days: z.number().int().min(1),
    single_threaded_window_days: z.number().int().min(1),
  })
  .superRefine((val, ctx) => {
    const weightSum =
      val.frequency_weight +
      val.recency_weight +
      val.seniority_weight +
      val.sentiment_weight +
      val.breadth_weight;
    if (Math.abs(weightSum - 1) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Weights must sum to 1.0',
        path: ['frequency_weight'],
      });
    }
    if (!(
      val.strong_threshold > val.healthy_threshold &&
      val.healthy_threshold > val.cooling_threshold &&
      val.cooling_threshold > val.at_risk_threshold
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Thresholds must be strictly descending: strong > healthy > cooling > at_risk',
        path: ['strong_threshold'],
      });
    }
  });

export type SetAccountHealthScoringConfigInput = z.infer<
  typeof setAccountHealthScoringConfigSchema
>;
