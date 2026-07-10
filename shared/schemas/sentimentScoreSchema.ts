/**
 * Shared types for the AI sentiment tracking feature. (MINCRM-472)
 * Used by both client and server.
 */

export const SENTIMENT_VALUES = ['positive', 'neutral', 'negative'] as const;
export type SentimentValue = (typeof SENTIMENT_VALUES)[number];

export const SENTIMENT_TREND_STATES = ['warming', 'stable', 'cooling'] as const;
export type SentimentTrendState = (typeof SENTIMENT_TREND_STATES)[number];

export interface SentimentScorePoint {
  activity_id: string;
  sentiment: SentimentValue;
  /** True when a rep has flagged this score as inaccurate — excluded from trend calculations. */
  flagged_inaccurate: boolean;
  created_at: string;
}

/** Sentiment trend for a single contact — sparkline over the last 10 interactions. */
export interface ContactSentimentTrendResponse {
  contact_id: string;
  trend: SentimentTrendState | null;
  /** Insufficient data (fewer than 2 non-flagged scores) — trend and points may be empty. */
  has_sufficient_data: boolean;
  points: SentimentScorePoint[];
}

/** Aggregate sentiment trend for an account — across all contacts, last 90 days. */
export interface AccountSentimentTrendResponse {
  account_id: string;
  trend: SentimentTrendState | null;
  has_sufficient_data: boolean;
  points: SentimentScorePoint[];
}
