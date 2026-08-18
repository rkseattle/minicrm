/**
 * Shared types for the AI win/loss pattern analysis feature.
 * Used by both client and server.
 */

export interface WinLossInsight {
  id: string;
  signal_type: string;
  /** Plain-language observation with supporting statistics. */
  observation: string;
  win_rate_with: number;
  win_rate_without: number;
  sample_size: number;
  is_win_pattern: boolean;
  generated_at: string;
}

export interface LossReasonTrend {
  /** Plain-language trend observation, e.g. "Competitor losses have increased 40% in the last 90 days." */
  observation: string;
  generated_at: string;
}

export interface WinLossInsightsResponse {
  insights: WinLossInsight[];
  loss_reason_trends: LossReasonTrend[];
  /** True once at least min_closed_deals closed deals exist and analysis has run. */
  has_sufficient_data: boolean;
  min_closed_deals_required: number;
  closed_deals_count: number;
}
