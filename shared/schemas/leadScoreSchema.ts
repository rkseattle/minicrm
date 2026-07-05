/**
 * Shared types for the rule-based lead scoring engine. (MINCRM-441 prerequisite)
 * Used by both client and server. Pure data comparison — no AI call.
 */

export const LEAD_SCORE_FACTORS = [
  'source_quality',
  'status_progression',
  'recency',
  'post_conversion_engagement',
] as const;
export type LeadScoreFactor = (typeof LEAD_SCORE_FACTORS)[number];

export interface LeadScoreFactorBreakdown {
  factor: LeadScoreFactor;
  /** Points this factor contributed toward the composite 0-100 score. */
  points: number;
  /** Maximum points this factor could contribute. */
  max_points: number;
  /** Short human-readable reason, e.g. "Referral source" or "No activity in 30 days". */
  reason: string;
}

export interface LeadScoreResult {
  /** 0-100 composite score. */
  score: number;
  factors: LeadScoreFactorBreakdown[];
  /** True when too little data exists to produce a meaningful score. */
  insufficient_data: boolean;
}
