/**
 * Reports API module.
 * Wraps the win/loss report endpoint. Requires authentication.
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
