/**
 * AI usage dashboard controller — request/response shaping for
 * /api/v1/admin/ai/usage/*. No business logic or database access here —
 * delegates entirely to aiUsageDashboardService. (MINCRM-459)
 */

import type { Request, Response } from 'express';
import { usageDateRangePresetSchema } from '@minicrm/shared/schemas/aiUsageSchema.js';
import {
  getUsageSummary,
  getDailyUsageSeries,
  getUsageExportRows,
} from '../services/aiUsageDashboardService.js';
import type { DateRange } from '../services/aiUsageDashboardService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';

/**
 * Resolves the requested date range from query params. Supports either a
 * `preset` (current_month | last_month | last_3_months) or an explicit
 * `start`/`end` pair (ISO date strings, end exclusive).
 *
 * Returns null if the query params are invalid, so the caller can respond 400.
 */
function resolveDateRange(query: Request['query']): DateRange | null {
  const startParam = typeof query['start'] === 'string' ? query['start'] : undefined;
  const endParam = typeof query['end'] === 'string' ? query['end'] : undefined;

  if (startParam && endParam) {
    const start = new Date(startParam);
    const end = new Date(endParam);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return null;
    }
    return { start, end };
  }

  const presetParam = typeof query['preset'] === 'string' ? query['preset'] : 'current_month';
  const parsedPreset = usageDateRangePresetSchema.safeParse(presetParam);
  if (!parsedPreset.success) {
    return null;
  }

  const now = new Date();
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  switch (parsedPreset.data) {
    case 'current_month':
      return { start: startOfCurrentMonth, end: startOfNextMonth };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start, end: startOfCurrentMonth };
    }
    case 'last_3_months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      return { start, end: startOfNextMonth };
    }
  }
}

/** Sends the shared 400 response for an invalid/unparsable date range query. */
function sendInvalidDateRangeError(res: Response): void {
  res.status(400).json({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid date range. Provide a valid preset, or start/end ISO dates.',
    },
  });
}

export async function getAiUsageSummaryHandler(req: Request, res: Response): Promise<void> {
  const range = resolveDateRange(req.query);
  if (!range) {
    sendInvalidDateRangeError(res);
    return;
  }

  const summary = await getUsageSummary(range);
  res.status(200).json(summary);
}

export async function getAiUsageDailyHandler(req: Request, res: Response): Promise<void> {
  const range = resolveDateRange(req.query);
  if (!range) {
    sendInvalidDateRangeError(res);
    return;
  }

  const series = await getDailyUsageSeries(range);
  res.status(200).json(series);
}

export async function exportAiUsageCsvHandler(req: Request, res: Response): Promise<void> {
  const range = resolveDateRange(req.query);
  if (!range) {
    sendInvalidDateRangeError(res);
    return;
  }

  const rows = await getUsageExportRows(range);

  const headers = [
    'Date',
    'User Name',
    'User Email',
    'Feature',
    'Input Tokens',
    'Output Tokens',
    'Estimated Cost (USD)',
  ];
  const csvRows = rows.map((row) => ({
    Date: row.usage_date,
    'User Name': row.user_name,
    'User Email': row.user_email,
    Feature: row.feature,
    'Input Tokens': row.input_tokens,
    'Output Tokens': row.output_tokens,
    'Estimated Cost (USD)': (row.estimated_cost_cents / 100).toFixed(2),
  }));

  const csv = serializeToCsv(headers, csvRows);
  const filename = csvFilename('ai-usage');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}
