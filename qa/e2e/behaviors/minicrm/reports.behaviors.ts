/**
 * Reports behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// API data types (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape of the win-loss report API response. */
export interface WinLossReport {
  wonCount: number;
  wonValue: string;
  lostCount: number;
  lostValue: string;
  winRate: number | null;
  lossReasonBreakdown: Array<{ reason: string; count: number }>;
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/**
 * Fetches the win-loss report from the API for the given date range.
 *
 * @param restClient - Authenticated RestClient.
 * @param start - Start date in YYYY-MM-DD format.
 * @param end - End date in YYYY-MM-DD format.
 * @returns The win-loss report.
 */
export async function getWinLossReport(
  restClient: RestClient,
  start: string,
  end: string,
): Promise<WinLossReport> {
  const res = await restClient.get<WinLossReport>(
    `/api/v1/reports/win-loss?start=${start}&end=${end}`,
  );
  return res.body;
}
