/**
 * AI usage dashboard controller — request/response shaping for
 * /api/v1/admin/ai/usage/*. No business logic or database access here —
 * delegates entirely to aiUsageDashboardService. (MINCRM-459)
 */

import type { Request, Response } from 'express';
import { usageDateRangePresetSchema } from '@minicrm/shared/schemas/aiUsageSchema.js';
import { getUsageSummary, getDailyUsageSeries } from '../services/aiUsageDashboardService.js';
import type { DateRange } from '../services/aiUsageDashboardService.js';

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

export async function getAiUsageSummaryHandler(req: Request, res: Response): Promise<void> {
  const range = resolveDateRange(req.query);
  if (!range) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid date range. Provide a valid preset, or start/end ISO dates.',
      },
    });
    return;
  }

  const summary = await getUsageSummary(range);
  res.status(200).json(summary);
}

export async function getAiUsageDailyHandler(req: Request, res: Response): Promise<void> {
  const range = resolveDateRange(req.query);
  if (!range) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid date range. Provide a valid preset, or start/end ISO dates.',
      },
    });
    return;
  }

  const series = await getDailyUsageSeries(range);
  res.status(200).json(series);
}
