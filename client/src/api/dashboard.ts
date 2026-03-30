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
}

/** Shape of the dashboard summary response from the API */
export interface DashboardSummaryResponse {
  overdueTasks: number;
  tasksDueToday: number;
  openDealCount: number;
  openPipelineValue: string;
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
