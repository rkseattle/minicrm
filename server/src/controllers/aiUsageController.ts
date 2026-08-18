/**
 * AI usage dashboard controller — request/response shaping for
 * /api/v1/admin/ai/usage/*. No business logic or database access here —
 * delegates entirely to aiUsageDashboardService.
 */

import type { Request, Response } from 'express';
import { usageDateRangeParamsSchema } from '@minicrm/shared/schemas/aiUsageSchema.js';
import {
  getUsageSummary,
  getDailyUsageSeries,
  getUsageExportRows,
  resolveDateRange,
  type DateRange,
} from '../services/aiUsageDashboardService.js';
import { serializeToCsv, csvFilename } from '../utils/csvUtils.js';
import { getBranding } from '../services/brandingService.js';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  type PdfTableColumn,
  type PdfTableRow,
} from '../services/pdfExportService.js';

/**
 * Validates the date-range query params at the HTTP boundary, then resolves
 * them to a concrete range. Two distinct failures both surface as null (and so
 * as one 400): a query param that isn't the right shape, and a combination the
 * calendar can't turn into a range (a lone start or end, an inverted range).
 */
function parseDateRangeQuery(req: Request): DateRange | null {
  const parsed = usageDateRangeParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    return null;
  }
  return resolveDateRange(parsed.data);
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
  const range = parseDateRangeQuery(req);
  if (!range) {
    sendInvalidDateRangeError(res);
    return;
  }

  const summary = await getUsageSummary(range);
  res.status(200).json(summary);
}

export async function getAiUsageDailyHandler(req: Request, res: Response): Promise<void> {
  const range = parseDateRangeQuery(req);
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

/** PDF-only: numeric columns rendered right-aligned instead of left-aligned like text. */
const AI_USAGE_NUMERIC_COLUMNS = new Set(['Input Tokens', 'Output Tokens', 'Estimated Cost (USD)']);

/**
 * Resolves the requested date range and fetches export rows, shaped identically for
 * both the CSV and PDF export handlers so both formats reflect the same data. Returns
 * null if the range is invalid; the response has already been written to in that
 * case and the caller must return without further writes.
 */
async function resolveAiUsageExportData(
  req: Request,
  res: Response,
): Promise<Record<string, string | number>[] | null> {
  const range = parseDateRangeQuery(req);
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
 * Query params and admin-only access are identical to the CSV export above.
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
