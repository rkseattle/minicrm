/**
 * Win/loss insights controller — request/response shaping only. (MINCRM-464)
 * No business logic here; all cached-read access goes through winLossAnalysisService.
 */

import type { Request, Response } from 'express';
import { getWinLossInsights } from '../services/winLossAnalysisService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { getBranding } from '../services/brandingService.js';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  type PdfSection,
} from '../services/pdfExportService.js';

/**
 * GET /api/insights/win-loss
 * Returns the cached results of the most recent nightly win/loss analysis run.
 */
export async function getWinLossInsightsHandler(_req: Request, res: Response): Promise<void> {
  const result = await getWinLossInsights();
  res.status(200).json(result);
}

/**
 * GET /api/insights/win-loss/export.csv
 * Exports the cached win/loss patterns and loss reason trends as CSV.
 */
export async function exportWinLossInsightsCsvHandler(_req: Request, res: Response): Promise<void> {
  const result = await getWinLossInsights();

  const headers = [
    'Type',
    'Signal',
    'Observation',
    'Win Rate With',
    'Win Rate Without',
    'Sample Size',
  ];
  const rows = [
    ...result.insights.map((i) => ({
      Type: i.is_win_pattern ? 'Win Pattern' : 'Loss Pattern',
      Signal: i.signal_type,
      Observation: i.observation,
      'Win Rate With': `${Math.round(i.win_rate_with * 100)}%`,
      'Win Rate Without': `${Math.round(i.win_rate_without * 100)}%`,
      'Sample Size': i.sample_size,
    })),
    ...result.loss_reason_trends.map((t) => ({
      Type: 'Loss Reason Trend',
      Signal: '',
      Observation: t.observation,
      'Win Rate With': '',
      'Win Rate Without': '',
      'Sample Size': '',
    })),
  ];

  const csv = serializeToCsv(headers, rows);
  const filename = csvFilename('win-loss-insights');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * GET /api/insights/win-loss/export.pdf
 * Exports the cached win/loss patterns and loss reason trends as a PDF document.
 */
export async function exportWinLossInsightsPdfHandler(_req: Request, res: Response): Promise<void> {
  const result = await getWinLossInsights();

  const winPatterns = result.insights.filter((i) => i.is_win_pattern);
  const lossPatterns = result.insights.filter((i) => !i.is_win_pattern);

  const describeInsight = (insight: (typeof result.insights)[number]): string =>
    `${insight.observation} (win rate: ${Math.round(insight.win_rate_with * 100)}% vs ${Math.round(insight.win_rate_without * 100)}%, n=${insight.sample_size})`;

  const sections: PdfSection[] = [
    {
      heading: 'Win Patterns',
      lines: winPatterns.map(describeInsight),
      emptyMessage: 'No win patterns available.',
    },
    {
      heading: 'Loss Patterns',
      lines: lossPatterns.map(describeInsight),
      emptyMessage: 'No loss patterns available.',
    },
    {
      heading: 'Loss Reason Trends',
      lines: result.loss_reason_trends.map((trend) => trend.observation),
      emptyMessage: 'No loss reason trends available.',
    },
  ];

  const branding = await getBranding();
  setPdfResponseHeaders(res, 'win-loss-insights.pdf');
  await renderPdfDocument(res, { title: 'Win/Loss Pattern Insights', sections }, branding);
}
