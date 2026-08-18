/**
 * Win/loss pattern insights API module.
 * Wraps the cached AI win/loss analysis endpoints. Requires authentication and
 * the ai_win_loss_insights feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import { triggerCsvDownload } from '@/utils/csvDownload.js';
import type { WinLossInsightsResponse } from '@shared/schemas/winLossInsightSchema.js';

export const WIN_LOSS_INSIGHTS_QUERY_KEY = ['win_loss_insights'] as const;

export async function getWinLossInsights(): Promise<WinLossInsightsResponse> {
  const response = await apiClient.get<WinLossInsightsResponse>('/insights/win-loss');
  return response.data;
}

export async function exportWinLossInsightsCsv(): Promise<void> {
  const response = await apiClient.get<Blob>('/insights/win-loss/export.csv', {
    responseType: 'blob',
  });
  const date = new Date().toISOString().split('T')[0];
  triggerCsvDownload(response.data, `minicrm-win-loss-insights-${date}.csv`);
}

export async function exportWinLossInsightsPdf(): Promise<void> {
  const response = await apiClient.get<Blob>('/insights/win-loss/export.pdf', {
    responseType: 'blob',
  });
  const date = new Date().toISOString().split('T')[0];
  triggerCsvDownload(response.data, `minicrm-win-loss-insights-${date}.pdf`);
}
