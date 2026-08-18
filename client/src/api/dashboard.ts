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
  /** Sum of (value × effective_probability / 100) for deals in this stage */
  weightedValue: string;
  /** True when deals in this stage span more than one currency */
  mixedCurrencies: boolean;
  /** Currency code when all deals in the stage share one currency; null when mixed */
  currency: string | null;
}

/** A single entry in the recent activity feed returned on the dashboard */
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
   * Sum of (value × effective_probability / 100) for all open deals.
   */
  weightedPipelineValue: string;
  /** True when open deals span more than one currency */
  mixedCurrencies: boolean;
  /** Currency code when all open deals share one currency; null when mixed or no deals */
  currency: string | null;
  stageBreakdown: StageBreakdown[];
  /** The 10 most recently updated activities visible to this user */
  recentActivities: RecentActivityEntry[];
  /** Converted pipeline value in home currency; null when hasRates is false */
  convertedPipelineValue: string | null;
  /** Converted weighted pipeline value in home currency */
  convertedWeightedPipelineValue: string | null;
  /** Code of the home currency */
  homeCurrency: string | null;
  /** Symbol of the home currency */
  homeSymbol: string | null;
  /** Number of deal currencies that have no rate configured */
  unratedCount: number;
  /** Comma-separated codes of unrated currencies */
  unratedCurrencies: string | null;
  /** ISO timestamp of the most recently updated rate */
  ratesLastUpdated: string | null;
  /** True when at least one non-home rate exists in the currencies table */
  hasRates: boolean;
}

/**
 * Returns the dashboard summary metrics for the current user.
 * Admins receive team-wide data; reps receive their own data only.
 */
export async function getDashboardSummary(): Promise<DashboardSummaryResponse> {
  const response = await apiClient.get<DashboardSummaryResponse>('/dashboard/summary');
  return response.data;
}
