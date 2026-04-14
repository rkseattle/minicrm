/**
 * Report controller — request/response shaping for reporting endpoints.
 * No business logic here; all DB access goes through reportService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWinLossReport, getActivityVolumeReport } from '../services/reportService.js';

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
 * GET /api/reports/activity-volume
 * Returns an activity count matrix broken down by rep and activity type for a date range.
 * - Admins may filter by owner_id; if omitted, returns team-wide data.
 * - Reps always receive data scoped to their own activities.
 * Implements MINCRM-181.
 */
export async function getActivityVolumeReportHandler(req: Request, res: Response): Promise<void> {
  const parsed = activityVolumeQuerySchema.safeParse(req.query);
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
    ownerId = req.user!.id;
  } else if (owner_id) {
    ownerId = owner_id;
  } else {
    ownerId = null;
  }

  const report = await getActivityVolumeReport({ startDate: start, endDate: end, ownerId });
  res.status(200).json(report);
}
