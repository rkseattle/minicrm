/**
 * Shared types for the AI rep coaching insights feature. (MINCRM-474)
 * Used by both client and server.
 */

export const REP_COACHING_METRIC_TYPES = [
  'avg_stage_days',
  'stage_conversion_rate',
  'activity_frequency',
  'deal_size_distribution',
  'win_rate_by_industry',
  'win_rate_by_lead_source',
  'response_time_after_activity',
  'objection_frequency',
] as const;
export type RepCoachingMetricType = (typeof REP_COACHING_METRIC_TYPES)[number];

/**
 * A single scored insight row. Most metric types produce exactly one row per
 * rep (segment is null). Breakdown metrics — stage_conversion_rate (segment =
 * stage name), deal_size_distribution (segment = size bucket label),
 * win_rate_by_industry (segment = industry), win_rate_by_lead_source (segment
 * = lead source) — produce one row per segment, so a rep can have several
 * insight rows sharing the same metric_type. is_outlier is evaluated
 * independently per segment against that segment's own team average, since a
 * rep can be an outlier in one industry/stage without being one overall.
 */
export interface RepCoachingInsight {
  id: string;
  metric_type: RepCoachingMetricType;
  /** Breakdown bucket label (stage name, industry, lead source, size bucket), or null for whole-rep metrics. */
  segment: string | null;
  observation: string;
  recommended_action: string;
  rep_value: number;
  team_average_value: number;
  is_outlier: boolean;
  closed_deal_count: number;
  computed_at: string;
}

export interface RepCoachingInsightsResponse {
  rep_id: string;
  rep_name: string;
  insights: RepCoachingInsight[];
  /** True once the rep has at least min_closed_deals closed deals; insights are withheld until then. */
  has_sufficient_data: boolean;
  min_closed_deals_required: number;
  closed_deal_count: number;
}

export interface CoachableRepSummary {
  rep_id: string;
  rep_name: string;
  has_sufficient_data: boolean;
  closed_deal_count: number;
  outlier_metric_count: number;
}

export interface CoachingTeamOverviewResponse {
  reps: CoachableRepSummary[];
  min_closed_deals_required: number;
}
