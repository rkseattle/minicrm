/**
 * Shared types for the AI lead score narrative feature. (MINCRM-441)
 * Used by both client and server.
 */

export interface LeadScoreNarrativeResponse {
  /** 3-5 sentence plain-English narrative, or a clear "not enough data" message. */
  narrative: string;
  /** True when scoring data is too sparse to explain meaningfully. */
  insufficient_data: boolean;
  generated_at: string;
}
