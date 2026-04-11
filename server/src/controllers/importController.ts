/**
 * Import controller — request/response shaping for CSV import endpoints.
 * All business logic lives in importService.
 * MINCRM-158, MINCRM-159, MINCRM-160
 */

import type { Request, Response } from 'express';
import {
  parseCsvBuffer,
  importAccounts,
  importContacts,
  importDeals,
  buildErrorCsv,
  ACCOUNT_FIELDS,
  CONTACT_FIELDS,
  DEAL_FIELDS,
  MAX_CSV_BYTES,
  type AccountMapping,
  type ContactMapping,
  type DealMapping,
} from '../services/importService.js';
import { z } from 'zod';

// ── Parse handlers (Step 1: upload → headers + preview) ───────────────────────

/**
 * POST /api/admin/import/accounts/parse
 * Accepts a CSV upload and returns headers, field definitions, and a 5-row preview.
 *
 * @param req - Express request with file attached by multer.
 * @param res - Express response.
 */
export async function parseAccountsCsv(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No CSV file uploaded' } });
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds 10 MB limit' } });
    return;
  }

  try {
    const parsed = parseCsvBuffer(file.buffer);
    res.json({ headers: parsed.headers, preview: parsed.preview, fields: ACCOUNT_FIELDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
  }
}

/**
 * POST /api/admin/import/contacts/parse
 * Accepts a CSV upload and returns headers, field definitions, and a 5-row preview.
 *
 * @param req - Express request with file attached by multer.
 * @param res - Express response.
 */
export async function parseContactsCsv(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No CSV file uploaded' } });
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds 10 MB limit' } });
    return;
  }

  try {
    const parsed = parseCsvBuffer(file.buffer);
    res.json({ headers: parsed.headers, preview: parsed.preview, fields: CONTACT_FIELDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
  }
}

/**
 * POST /api/admin/import/deals/parse
 * Accepts a CSV upload and returns headers, field definitions, and a 5-row preview.
 *
 * @param req - Express request with file attached by multer.
 * @param res - Express response.
 */
export async function parseDealsCsv(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No CSV file uploaded' } });
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds 10 MB limit' } });
    return;
  }

  try {
    const parsed = parseCsvBuffer(file.buffer);
    res.json({ headers: parsed.headers, preview: parsed.preview, fields: DEAL_FIELDS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
  }
}

// ── Run handlers (Step 2: mapping + CSV → import) ─────────────────────────────

const accountMappingSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  website: z.string().optional(),
  employee_range: z.string().optional(),
  revenue_range: z.string().optional(),
  skip_duplicates: z.boolean().optional(),
});

const contactMappingSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().optional(),
  title: z.string().optional(),
  department: z.string().optional(),
  account_name: z.string().optional(),
});

const dealMappingSchema = z.object({
  name: z.string().min(1),
  stage: z.string().min(1),
  value: z.string().optional(),
  close_date: z.string().optional(),
  loss_reason: z.string().optional(),
  account_name: z.string().optional(),
  skip_unresolvable_accounts: z.boolean().optional(),
});

/**
 * POST /api/admin/import/accounts/run
 * Runs the account import using the uploaded CSV and provided column mapping.
 *
 * @param req - Express request with file + JSON mapping field.
 * @param res - Express response with import summary and optional error CSV.
 */
export async function runAccountsImport(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No CSV file uploaded' } });
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds 10 MB limit' } });
    return;
  }

  let rawMapping: unknown;
  try {
    rawMapping = JSON.parse(typeof req.body.mapping === 'string' ? req.body.mapping : '{}');
  } catch {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'mapping must be valid JSON' } });
    return;
  }

  const parsed = accountMappingSchema.safeParse(rawMapping);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid mapping',
      },
    });
    return;
  }

  const mapping = parsed.data;
  const skipDuplicates = mapping.skip_duplicates !== false;

  let csvData;
  try {
    csvData = parseCsvBuffer(file.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
    return;
  }

  const accountMapping: AccountMapping = {
    name: mapping.name,
    industry: mapping.industry,
    website: mapping.website,
    employee_range: mapping.employee_range,
    revenue_range: mapping.revenue_range,
  };

  const importResult = await importAccounts(
    csvData.rows,
    accountMapping,
    req.user!.id,
    skipDuplicates,
  );

  res.json({
    created: importResult.created,
    skipped: importResult.skipped,
    failedCount: importResult.failed.length,
    failed: importResult.failed,
    errorCsv: buildErrorCsv(importResult.failed),
  });
}

/**
 * POST /api/admin/import/contacts/run
 * Runs the contact import using the uploaded CSV and provided column mapping.
 *
 * @param req - Express request with file + JSON mapping field.
 * @param res - Express response with import summary and optional error CSV.
 */
export async function runContactsImport(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No CSV file uploaded' } });
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds 10 MB limit' } });
    return;
  }

  let rawMapping: unknown;
  try {
    rawMapping = JSON.parse(typeof req.body.mapping === 'string' ? req.body.mapping : '{}');
  } catch {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'mapping must be valid JSON' } });
    return;
  }

  const parsed = contactMappingSchema.safeParse(rawMapping);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid mapping',
      },
    });
    return;
  }

  const mapping = parsed.data;

  let csvData;
  try {
    csvData = parseCsvBuffer(file.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
    return;
  }

  const contactMapping: ContactMapping = {
    first_name: mapping.first_name,
    last_name: mapping.last_name,
    email: mapping.email,
    phone: mapping.phone,
    title: mapping.title,
    department: mapping.department,
    account_name: mapping.account_name,
  };

  const importResult = await importContacts(csvData.rows, contactMapping, req.user!.id);

  res.json({
    created: importResult.created,
    skipped: importResult.skipped,
    failedCount: importResult.failed.length,
    failed: importResult.failed,
    errorCsv: buildErrorCsv(importResult.failed),
  });
}

/**
 * POST /api/admin/import/deals/run
 * Runs the deal import using the uploaded CSV and provided column mapping.
 *
 * @param req - Express request with file + JSON mapping field.
 * @param res - Express response with import summary and optional error CSV.
 */
export async function runDealsImport(req: Request, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No CSV file uploaded' } });
    return;
  }
  if (file.size > MAX_CSV_BYTES) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'File exceeds 10 MB limit' } });
    return;
  }

  let rawMapping: unknown;
  try {
    rawMapping = JSON.parse(typeof req.body.mapping === 'string' ? req.body.mapping : '{}');
  } catch {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'mapping must be valid JSON' } });
    return;
  }

  const parsed = dealMappingSchema.safeParse(rawMapping);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid mapping',
      },
    });
    return;
  }

  const mapping = parsed.data;

  let csvData;
  try {
    csvData = parseCsvBuffer(file.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
    return;
  }

  const dealMapping: DealMapping = {
    name: mapping.name,
    stage: mapping.stage,
    value: mapping.value,
    close_date: mapping.close_date,
    loss_reason: mapping.loss_reason,
    account_name: mapping.account_name,
    skip_unresolvable_accounts: mapping.skip_unresolvable_accounts,
  };

  const importResult = await importDeals(csvData.rows, dealMapping, req.user!.id);

  res.json({
    created: importResult.created,
    skipped: importResult.skipped,
    failedCount: importResult.failed.length,
    failed: importResult.failed,
    errorCsv: buildErrorCsv(importResult.failed),
  });
}
