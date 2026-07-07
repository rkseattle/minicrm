/**
 * Report controller — request/response shaping for reporting endpoints.
 * No business logic here; all DB access goes through reportService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getWinLossReport,
  getActivityVolumeReport,
  getStageTrendReport,
  STAGE_TREND_DAYS_OPTIONS,
  ACTIVITY_TYPES,
  type StageTrendDays,
} from '../services/reportService.js';
import {
  renderPdfDocument,
  setPdfResponseHeaders,
  pdfFilename,
  type PdfTableColumn,
  type PdfTableRow,
} from '../services/pdfExportService.js';

/**
 * Column labels for the activity volume PDF export table, in display order.
 * Derived from ACTIVITY_TYPES so a new activity type automatically gains a
 * PDF column without a second place to update.
 */
const ACTIVITY_VOLUME_PDF_COLUMNS: PdfTableColumn[] = [
  { key: 'ownerName', label: 'Rep' },
  ...ACTIVITY_TYPES.map((type) => ({ key: type, label: type })),
  { key: 'total', label: 'Total' },
];

/** Zod schema for win/loss report query parameters */
const winLossQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD'),
  /** Optional owner_id filter — only admins may use this */
  owner_id: z.string().uuid().optional(),
});

/**
 * GET /api/reports/win-loss
 * Returns a win/loss summary for the given date range.
 * - Admins may filter by owner_id; if omitted, returns team-wide data.
 * - Reps always receive data scoped to their own deals.
 */
export async function getWinLossReportHandler(req: Request, res: Response): Promise<void> {
  const parsed = winLossQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
    });
    return;
  }

  const { start, end, owner_id } = parsed.data;

  if (start > end) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'start date must not be after end date' },
    });
    return;
  }

  const isAdmin = req.user!.role === 'admin';

  let ownerId: string | null;
  if (!isAdmin) {
    // Reps always see only their own deals
    ownerId = req.user!.id;
  } else if (owner_id) {
    // Admin filtered by a specific rep
    ownerId = owner_id;
  } else {
    // Admin with no filter — team-wide
    ownerId = null;
  }

  const report = await getWinLossReport({ startDate: start, endDate: end, ownerId });
  res.status(200).json(report);
}

/** Zod schema for activity volume report query parameters */
const activityVolumeQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD'),
  /** Optional owner_id filter — only admins may use this */
  owner_id: z.string().uuid().optional(),
});

/**
 * Parses and scopes the activity volume query params shared by the JSON and PDF export
 * handlers. Returns null if validation failed; the response has already been written to
 * in that case and the caller must return without further writes. (MINCRM-601)
 */
function resolveActivityVolumeParams(
  req: Request,
  res: Response,
): { startDate: string; endDate: string; ownerId: string | null } | null {
  const parsed = activityVolumeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
    });
    return null;
  }

  const { start, end, owner_id } = parsed.data;

  if (start > end) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'start date must not be after end date' },
    });
    return null;
  }

  const isAdmin = req.user!.role === 'admin';

  let ownerId: string | null;
  if (!isAdmin) {
    ownerId = req.user!.id;
  } else if (owner_id) {
    ownerId = owner_id;
  } else {
    ownerId = null;
  }

  return { startDate: start, endDate: end, ownerId };
}

/**
 * GET /api/reports/activity-volume
 * Returns an activity count matrix broken down by rep and activity type for a date range.
 * - Admins may filter by owner_id; if omitted, returns team-wide data.
 * - Reps always receive data scoped to their own activities.
 * Implements MINCRM-181.
 */
export async function getActivityVolumeReportHandler(req: Request, res: Response): Promise<void> {
  const params = resolveActivityVolumeParams(req, res);
  if (!params) return;

  const report = await getActivityVolumeReport(params);
  res.status(200).json(report);
}

/**
 * GET /api/v1/reports/activity-volume/export.pdf
 * Renders the activity volume report as a paginated PDF table. Query params and
 * ownership rules are identical to the JSON endpoint above. (MINCRM-601)
 */
export async function exportActivityVolumeReportPdfHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const params = resolveActivityVolumeParams(req, res);
  if (!params) return;

  const report = await getActivityVolumeReport(params);

  const rows: PdfTableRow[] = report.rows.map((r) => ({
    ownerName: r.ownerName,
    ...r.counts,
    total: r.total,
  }));
  rows.push({ ownerName: 'Total', ...report.totals });

  setPdfResponseHeaders(res, pdfFilename('activity-volume'));
  renderPdfDocument(res, {
    title: 'Activity Volume Report',
    sections: [
      {
        heading: 'Activity Volume',
        table: {
          columns: ACTIVITY_VOLUME_PDF_COLUMNS,
          rows,
          emptyMessage: 'No activities logged for this period.',
        },
      },
    ],
  });
}

// ── Stage Trend Report (MINCRM-284) ──────────────────────────────────────────

/** Zod schema for stage trend report query parameters */
const stageTrendQuerySchema = z.object({
  days: z
    .enum(['30', '60', '90'])
    .transform((v) => parseInt(v, 10) as StageTrendDays)
    .optional()
    .default('30'),
});

/**
 * GET /api/v1/reports/stage-trend
 * Returns stage entry and conversion counts over the last 30, 60, or 90 days.
 * Accessible to all authenticated users; no owner scoping (aggregated data).
 * Implements MINCRM-284.
 */
export async function getStageTrendReportHandler(req: Request, res: Response): Promise<void> {
  const parsed = stageTrendQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0].message },
    });
    return;
  }

  const { days } = parsed.data;
  if (!STAGE_TREND_DAYS_OPTIONS.includes(days)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'days must be 30, 60, or 90' },
    });
    return;
  }

  const report = await getStageTrendReport(days);
  res.status(200).json(report);
}
