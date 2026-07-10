/**
 * Shared types for the AI pre-meeting brief generation feature. (MINCRM-465)
 * Used by both client and server.
 */

export interface MeetingBriefOpenOpportunity {
  deal_id: string;
  name: string;
  stage: string;
  value: string | null;
  currency: string;
  days_in_current_stage: number;
  next_step: string | null;
}

export interface MeetingBriefNewsItem {
  title: string;
  url: string;
  source: string;
  published_at: string | null;
}

export interface MeetingBriefContent {
  contact_snapshot: {
    name: string;
    title: string | null;
    company: string | null;
    contact_since: string | null;
    last_interaction_at: string | null;
  };
  account_summary: string | null;
  open_opportunities: MeetingBriefOpenOpportunity[];
  /** Last 3 interactions summarized in plain language. */
  recent_activity_summary: string[];
  /** 3-5 points derived from opportunity stage, recent activity, and open tasks. */
  suggested_talking_points: string[];
  /** Any objections logged in notes, with context. */
  known_objections: string[];
  /** Omitted (not empty) when no relevant news was found or web search is disabled. */
  news_hook?: MeetingBriefNewsItem[];
}

export interface MeetingBriefResponse {
  activity_id: string;
  brief: MeetingBriefContent;
  generated_by: string;
  generated_at: string;
}
