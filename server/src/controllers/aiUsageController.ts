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
import { getBranding } from '../services/brandingService.js';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  type PdfTableColumn,
  type PdfTableRow,
} from '../services/pdfExportService.js';

/** One day in milliseconds, used to convert an inclusive calendar-day `end` param into the exclusive boundary every query in aiUsageDashboardService.ts filters against. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves the requested date range from query params. Supports either a
 * `preset` (current_month | last_month | last_3_months) or an explicit
 * `start`/`end` pair (ISO date strings). `start` and `end` are both treated
 * as inclusive calendar days — `end` is advanced by one day internally to
 * produce the exclusive boundary every query filters against, so a caller
 * asking for `end=2026-07-01` sees that day's data (matching what a date
 * picker labeled "End date" implies), not "up to but excluding" it.
 *
 * Both `start` and `end` must be supplied together — a lone one returns null
 * rather than silently falling back to the preset path.
 *
 * Returns null if the query params are invalid, so the caller can respond 400.
 */
function resolveDateRange(query: Request['query']): DateRange | null {
  const startParam = typeof query['start'] === 'string' ? query['start'] : undefined;
  const endParam = typeof query['end'] === 'string' ? query['end'] : undefined;

  if (startParam || endParam) {
    if (!startParam || !endParam) {
      return null;
    }
    const start = new Date(startParam);
    const inclusiveEnd = new Date(endParam);
    if (isNaN(start.getTime()) || isNaN(inclusiveEnd.getTime())) {
      return null;
    }
    const end = new Date(inclusiveEnd.getTime() + ONE_DAY_MS);
    if (start >= end) {
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

/** Column labels shared by the CSV and PDF AI usage export formats, in display order. */
const AI_USAGE_EXPORT_HEADERS = [
  'Date',
  'User Name',
  'User Email',
  'Feature',
  'Input Tokens',
  'Output Tokens',
  'Estimated Cost (USD)',
] as const;

/** PDF-only: numeric columns rendered right-aligned instead of left-aligned like text. (MINCRM-655) */
const AI_USAGE_NUMERIC_COLUMNS = new Set(['Input Tokens', 'Output Tokens', 'Estimated Cost (USD)']);

/**
 * Resolves the requested date range and fetches export rows, shaped identically for
 * both the CSV and PDF export handlers so both formats reflect the same data. Returns
 * null if the range is invalid; the response has already been written to in that
 * case and the caller must return without further writes. (MINCRM-601)
 */
async function resolveAiUsageExportData(
  req: Request,
  res: Response,
): Promise<Record<string, string | number>[] | null> {
  const range = resolveDateRange(req.query);
  if (!range) {
    sendInvalidDateRangeError(res);
    return null;
  }

  const rows = await getUsageExportRows(range);

  return rows.map((row) => ({
    Date: row.usage_date,
    'User Name': row.user_name,
    'User Email': row.user_email,
    Feature: row.feature,
    'Input Tokens': row.input_tokens,
    'Output Tokens': row.output_tokens,
    'Estimated Cost (USD)': (row.estimated_cost_cents / 100).toFixed(2),
  }));
}

export async function exportAiUsageCsvHandler(req: Request, res: Response): Promise<void> {
  const csvRows = await resolveAiUsageExportData(req, res);
  if (!csvRows) return;

  const csv = serializeToCsv([...AI_USAGE_EXPORT_HEADERS], csvRows);
  const filename = csvFilename('ai-usage');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

/**
 * GET /api/v1/admin/ai/usage/export.pdf
 * Renders AI usage data (per-user, per-day, per-feature) as a paginated PDF table.
 * Query params and admin-only access are identical to the CSV export above. (MINCRM-601)
 */
export async function exportAiUsagePdfHandler(req: Request, res: Response): Promise<void> {
  const rows = await resolveAiUsageExportData(req, res);
  if (!rows) return;

  const columns: PdfTableColumn[] = AI_USAGE_EXPORT_HEADERS.map((label) => ({
    key: label,
    label,
    align: AI_USAGE_NUMERIC_COLUMNS.has(label) ? 'right' : undefined,
  }));
  const tableRows: PdfTableRow[] = rows;

  const branding = await getBranding();
  setPdfResponseHeaders(res, pdfFilename('ai-usage'));
  await renderPdfDocument(
    res,
    {
      title: 'AI Usage',
      sections: [
        {
          heading: 'AI Usage',
          table: {
            columns,
            rows: tableRows,
            emptyMessage: 'No AI usage recorded for this period.',
          },
        },
      ],
    },
    branding,
  );
}
