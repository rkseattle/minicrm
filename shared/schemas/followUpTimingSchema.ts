/**
 * Shared types for the AI smart follow-up timing suggestions feature.
 * Used by both client and server.
 */

/** Minimum logged interactions with a contact required before a suggestion is shown. */
export const MIN_INTERACTIONS_FOR_TIMING_SUGGESTION = 5;

export interface FollowUpTimingSuggestion {
  contact_id: string;
  /** 0 = Sunday .. 6 = Saturday, ISO-ish day-of-week index matching JS Date#getDay(). */
  day_of_week: number;
  /** Suggested hour range, already projected into the requested display timezone. */
  hour_start: number;
  hour_end: number;
  /** IANA timezone identifier the hour range above is expressed in. */
  timezone: string;
  sample_size: number;
  computed_at: string;
}

/** Response for GET /api/v1/contacts/:id/followup-timing — null means insufficient data. */
export interface FollowUpTimingResponse {
  suggestion: FollowUpTimingSuggestion | null;
}
