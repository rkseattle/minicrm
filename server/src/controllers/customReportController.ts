/**
 * Custom report controller — request/response shaping for custom report endpoints. (MINCRM-402)
 * No business logic here; all DB access goes through customReportService.
 */

import type { Request, Response } from 'express';
import {
  listReports,
  getReport,
  createReport,
  updateReport,
  deleteReport,
  executeReport,
  toReportResponse,
} from '../services/customReportService.js';
import {
  createCustomReportSchema,
  updateCustomReportSchema,
  reportConfigSchema,
  REPORT_ENTITY_TYPES,
} from '@minicrm/shared/schemas/customReportSchema.js';

function isValidEntityType(value: string): value is (typeof REPORT_ENTITY_TYPES)[number] {
  return (REPORT_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * GET /api/v1/reports/custom
 * Returns all saved custom reports, ordered by name.
 */
export async function listCustomReportsHandler(req: Request, res: Response): Promise<void> {
  const reports = await listReports();
  res.status(200).json({ reports: reports.map(toReportResponse) });
}

/**
 * GET /api/v1/reports/custom/:id
 * Returns a single saved custom report.
 */
export async function getCustomReportHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const report = await getReport(id);
  if (!report) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });
    return;
  }
  res.status(200).json(toReportResponse(report));
}

/**
 * POST /api/v1/reports/custom
 * Creates a new saved custom report.
 */
export async function createCustomReportHandler(req: Request, res: Response): Promise<void> {
  const parsed = createCustomReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const report = await createReport(parsed.data, actor);
    res.status(201).json(toReportResponse(report));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'CUSTOM_REPORT_NAME_CONFLICT') {
      res.status(409).json({
        error: { code: 'CUSTOM_REPORT_NAME_CONFLICT', message: (err as Error).message },
      });
      return;
    }
    if (code === 'INVALID_REPORT_FIELD') {
      res.status(400).json({
        error: { code: 'INVALID_REPORT_FIELD', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * PATCH /api/v1/reports/custom/:id
 * Updates a saved custom report.
 */
export async function updateCustomReportHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const parsed = updateCustomReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const report = await updateReport(id, parsed.data, actor);
    if (!report) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });
      return;
    }
    res.status(200).json(toReportResponse(report));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'CUSTOM_REPORT_NAME_CONFLICT') {
      res.status(409).json({
        error: { code: 'CUSTOM_REPORT_NAME_CONFLICT', message: (err as Error).message },
      });
      return;
    }
    if (code === 'INVALID_REPORT_FIELD') {
      res.status(400).json({
        error: { code: 'INVALID_REPORT_FIELD', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/v1/reports/custom/:id
 * Deletes a saved custom report.
 */
export async function deleteCustomReportHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const actor = { id: req.user!.id, name: req.user!.name };

  const report = await deleteReport(id, actor);
  if (!report) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });
    return;
  }
  res.status(200).json({ id });
}

/**
 * POST /api/v1/reports/custom/:id/run
 * Executes a saved custom report and returns the result rows.
 * Reps are scoped to their own owner_id; admins see all data.
 */
export async function runCustomReportHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const report = await getReport(id);
  if (!report) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });
    return;
  }

  const isAdmin = req.user!.role === 'admin';
  const scopeOwnerId = isAdmin ? null : req.user!.id;

  try {
    const result = await executeReport(report.entity_type, report.config, scopeOwnerId);
    res.status(200).json(result);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'INVALID_REPORT_FIELD') {
      res.status(400).json({
        error: { code: 'INVALID_REPORT_FIELD', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/v1/reports/custom/run
 * Executes an unsaved (ad-hoc) report config and returns the result rows.
 * Body: { entity_type, config }
 * Reps are scoped to their own owner_id; admins see all data.
 */
export async function runAdHocReportHandler(req: Request, res: Response): Promise<void> {
  const entityTypeRaw = String(req.body?.entity_type ?? '');
  if (!isValidEntityType(entityTypeRaw)) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `entity_type must be one of: ${REPORT_ENTITY_TYPES.join(', ')}`,
      },
    });
    return;
  }

  const configParsed = reportConfigSchema.safeParse(req.body?.config);
  if (!configParsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: configParsed.error.issues[0]?.message ?? 'Invalid config',
      },
    });
    return;
  }

  const isAdmin = req.user!.role === 'admin';
  const scopeOwnerId = isAdmin ? null : req.user!.id;

  try {
    const result = await executeReport(entityTypeRaw, configParsed.data, scopeOwnerId);
    res.status(200).json(result);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'INVALID_REPORT_FIELD') {
      res.status(400).json({
        error: { code: 'INVALID_REPORT_FIELD', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * POST /api/v1/reports/custom/:id/export
 * Executes a saved report and streams results as CSV.
 */
export async function exportCustomReportHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const report = await getReport(id);
  if (!report) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom report not found' } });
    return;
  }

  const isAdmin = req.user!.role === 'admin';
  const scopeOwnerId = isAdmin ? null : req.user!.id;

  try {
    const result = await executeReport(report.entity_type, report.config, scopeOwnerId);

    const filename = report.name.replace(/[^a-z0-9_\- ]/gi, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

    const escape = (v: string | number | null): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    res.write(result.columns.map(escape).join(',') + '\n');
    for (const row of result.rows) {
      res.write(result.columns.map((col) => escape(row[col] ?? null)).join(',') + '\n');
    }
    res.end();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'INVALID_REPORT_FIELD') {
      res.status(400).json({
        error: { code: 'INVALID_REPORT_FIELD', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}
