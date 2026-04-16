/**
 * Dashboard API module.
 * Wraps the dashboard summary endpoint. Requires authentication.
 */

import apiClient from './axiosInstance.js';

/** React Query cache key for the dashboard summary */
export const DASHBOARD_QUERY_KEY = ['dashboard', 'summary'] as const;

/** A per-stage aggregate returned in the dashboard summary */
export interface StageBreakdown {
  stage: string;
  count: number;
  value: string;
  /** Sum of (value × effective_probability / 100) for deals in this stage (MINCRM-179) */
  weightedValue: string;
  /** True when deals in this stage span more than one currency (MINCRM-189) */
  mixedCurrencies: boolean;
  /** Currency code when all deals in the stage share one currency; null when mixed (MINCRM-189) */
  currency: string | null;
}

/** A single entry in the recent activity feed returned on the dashboard (MINCRM-185) */
export interface RecentActivityEntry {
  id: string;
  type: string;
  subject: string;
  /** ISO timestamp of the most recent change */
  updatedAt: string;
  /** Display name of the linked record (contact, account, or deal) */
  linkedRecordName: string | null;
  /** Client-side route path for the linked record (e.g. "/contacts/uuid") */
  linkedRecordPath: string | null;
}

/** Shape of the dashboard summary response from the API */
export interface DashboardSummaryResponse {
  overdueTasks: number;
  tasksDueToday: number;
  openDealCount: number;
  openPipelineValue: string;
  /**
   * Sum of (value × effective_probability / 100) for all open deals. (MINCRM-179)
   */
  weightedPipelineValue: string;
  /** True when open deals span more than one currency (MINCRM-189) */
  mixedCurrencies: boolean;
  /** Currency code when all open deals share one currency; null when mixed or no deals (MINCRM-189) */
  currency: string | null;
  stageBreakdown: StageBreakdown[];
  /** The 10 most recently updated activities visible to this user (MINCRM-185) */
  recentActivities: RecentActivityEntry[];
}

/**
 * Returns the dashboard summary metrics for the current user.
 * Admins receive team-wide data; reps receive their own data only.
 */
export async function getDashboardSummary(): Promise<DashboardSummaryResponse> {
  const response = await apiClient.get<DashboardSummaryResponse>('/dashboard/summary');
  return response.data;
}
