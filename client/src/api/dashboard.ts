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
  stageBreakdown: StageBreakdown[];
}

/**
 * Returns the dashboard summary metrics for the current user.
 * Admins receive team-wide data; reps receive their own data only.
 */
export async function getDashboardSummary(): Promise<DashboardSummaryResponse> {
  const response = await apiClient.get<DashboardSummaryResponse>('/dashboard/summary');
  return response.data;
}
