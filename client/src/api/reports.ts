/**
 * Reports API module.
 * Wraps report endpoints (win/loss, activity volume). Requires authentication.
 * Implements MINCRM-26 (win/loss) and MINCRM-181 (activity volume).
 */

import apiClient from './axiosInstance.js';

/** React Query cache key for win/loss report queries */
export const WIN_LOSS_REPORT_QUERY_KEY = ['reports', 'win-loss'] as const;

/** Parameters for the win/loss report request */
export interface WinLossReportParams {
  /** Start of the date range, YYYY-MM-DD (inclusive) */
  start: string;
  /** End of the date range, YYYY-MM-DD (inclusive) */
  end: string;
  /** Filter by owner UUID (admin only) */
  ownerId?: string;
}

/** A single loss-reason entry in the breakdown */
export interface LossReasonBreakdown {
  reason: string;
  count: number;
}

/** Shape of the win/loss report response from the API */
export interface WinLossReportResponse {
  wonCount: number;
  wonValue: string;
  lostCount: number;
  lostValue: string;
  /** Win rate as a decimal 0–1, or null when no closed deals exist */
  winRate: number | null;
  lossReasonBreakdown: LossReasonBreakdown[];
  /** True when closed deals span more than one currency (MINCRM-189) */
  mixedCurrencies: boolean;
  /** Currency code when all closed deals share one currency; null when mixed or no deals (MINCRM-189) */
  currency: string | null;
}

/**
 * Fetches a win/loss report for the given date range.
 * Admins can optionally filter by owner; reps always see only their own data.
 *
 * @param params - Date range and optional owner filter
 * @returns WinLossReportResponse
 */
export async function getWinLossReport(
  params: WinLossReportParams,
): Promise<WinLossReportResponse> {
  const query: Record<string, string> = {
    start: params.start,
    end: params.end,
  };
  if (params.ownerId) {
    query.owner_id = params.ownerId;
  }
  const response = await apiClient.get<WinLossReportResponse>('/reports/win-loss', {
    params: query,
  });
  return response.data;
}

// ── Activity Volume Report (MINCRM-181) ───────────────────────────────────────

/** React Query cache key for activity volume report queries */
export const ACTIVITY_VOLUME_REPORT_QUERY_KEY = ['reports', 'activity-volume'] as const;

/** Parameters for the activity volume report request */
export interface ActivityVolumeReportParams {
  /** Start of the date range, YYYY-MM-DD (inclusive) */
  start: string;
  /** End of the date range, YYYY-MM-DD (inclusive) */
  end: string;
  /** Filter by owner UUID (admin only) */
  ownerId?: string;
}

/** Count per activity type for a single rep row */
export interface ActivityTypeCounts {
  Note: number;
  Call: number;
  Email: number;
  Meeting: number;
  Task: number;
}

/** A single rep row in the activity volume report */
export interface ActivityVolumeRepRow {
  ownerId: string;
  ownerName: string;
  counts: ActivityTypeCounts;
  total: number;
}

/** Shape of the activity volume report response from the API */
export interface ActivityVolumeReportResponse {
  rows: ActivityVolumeRepRow[];
  totals: ActivityTypeCounts & { total: number };
}

/**
 * Fetches an activity volume report for the given date range.
 * Admins can optionally filter by owner; reps always see only their own data.
 *
 * @param params - Date range and optional owner filter
 * @returns ActivityVolumeReportResponse
 */
export async function getActivityVolumeReport(
  params: ActivityVolumeReportParams,
): Promise<ActivityVolumeReportResponse> {
  const query: Record<string, string> = {
    start: params.start,
    end: params.end,
  };
  if (params.ownerId) {
    query.owner_id = params.ownerId;
  }
  const response = await apiClient.get<ActivityVolumeReportResponse>('/reports/activity-volume', {
    params: query,
  });
  return response.data;
}
