/**
 * Shared types for the multi-signal duplicate-match scoring engine. (MINCRM-440 prerequisite)
 * Used by both client and server. Pure data-comparison — no AI call.
 */

export const DUPLICATE_MATCH_SIGNALS = [
  'exact_email',
  'email_domain',
  'similar_name',
  'phone_match',
  'company_match',
] as const;
export type DuplicateMatchSignal = (typeof DUPLICATE_MATCH_SIGNALS)[number];

export interface DuplicateMatchResult {
  /** 0-100 composite match score. */
  score: number;
  /** Which signals contributed to the score, in descending weight order. */
  matched_signals: DuplicateMatchSignal[];
}
