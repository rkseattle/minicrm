/**
 * Shared types for the AI deal health check feature. (MINCRM-442)
 * Used by both client and server.
 */

export const DEAL_HEALTH_STATUSES = ['on_track', 'at_risk', 'stalled'] as const;
export type DealHealthStatus = (typeof DEAL_HEALTH_STATUSES)[number];

export interface DealHealthCheckResponse {
  status: DealHealthStatus;
  /** 2-4 sentence narrative identifying specific risk signals. */
  narrative: string;
  /** 1-2 recommended next actions. */
  next_actions: string[];
  generated_at: string;
}
