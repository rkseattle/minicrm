/**
 * Import controller — request/response shaping for CSV import endpoints.
 * All business logic lives in importService.
 * Run endpoints now return immediately with a job_id (202) and process rows
 * in the background via setImmediate. Progress is written to import_jobs.
 *
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
  type CsvRow,
  type ParsedCsv,
  type ImportResult,
} from '../services/importService.js';
import {
  createJob,
  updateJobProgress,
  completeJob,
  failJob,
  getJob,
  pruneOldJobs,
  type ImportJobType,
} from '../services/importJobService.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import { z } from 'zod';

// ── Parse handlers (Step 1: upload → headers + preview) ───────────────────────

/**
 * POST /api/v1/admin/import/accounts/parse
 * Accepts a CSV upload and returns headers, field definitions, and a 5-row preview.
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
 * POST /api/v1/admin/import/contacts/parse
 * Accepts a CSV upload and returns headers, field definitions, and a 5-row preview.
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
 * POST /api/v1/admin/import/deals/parse
 * Accepts a CSV upload and returns headers, field definitions, and a 5-row preview.
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

// ── Run handlers (Step 2: mapping + CSV → background job) ─────────────────────

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
 * Validates file and CSV, creates the job row, responds 202, then kicks off the
 * background runner via setImmediate. Writes a summary audit entry after completion.
 *
 * @param jobType - The entity type ('accounts' | 'contacts' | 'deals').
 * @param req - Express request (file already attached by multer).
 * @param res - Express response.
 * @param runFn - Calls the correct importXxx service function with an onProgress callback.
 */
async function startImportJob(
  jobType: ImportJobType,
  req: Request,
  res: Response,
  runFn: (
    rows: CsvRow[],
    onProgress: (
      processedRows: number,
      created: number,
      skipped: number,
      failed: number,
    ) => Promise<void>,
  ) => Promise<ImportResult>,
): Promise<void> {
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

  let csvData: ParsedCsv;
  try {
    csvData = parseCsvBuffer(file.buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse CSV';
    res.status(400).json({ error: { code: 'CSV_PARSE_ERROR', message } });
    return;
  }

  // Prune stale jobs before creating a new one — fire and forget
  void pruneOldJobs().catch((pruneErr: unknown) => {
    console.error('Failed to prune old import jobs:', pruneErr);
  });

  const actorId = req.user!.id;
  const actorName = req.user!.name;
  const job = await createJob(jobType, csvData.rows.length, actorId);

  // Respond immediately — the client polls GET /api/v1/admin/import/jobs/:job_id for progress
  res.status(202).json({ job_id: job.id, status: 'pending' });

  const { rows } = csvData;

  // Background runner — not awaited; runs after the response is flushed
  setImmediate(() => {
    void (async () => {
      try {
        const onProgress = async (
          processedRows: number,
          created: number,
          skipped: number,
          failed: number,
        ): Promise<void> => {
          await updateJobProgress(job.id, processedRows, created, skipped, failed);
        };

        const importResult = await runFn(rows, onProgress);
        const errorCsv = buildErrorCsv(importResult.failed);
        await completeJob(
          job.id,
          importResult.created,
          importResult.skipped,
          importResult.failed.length,
          errorCsv,
        );

        void writeAuditEntryBestEffort({
          recordType: 'system_settings',
          recordName: `Import: ${jobType}`,
          eventType: 'created',
          newValue: `${importResult.created} records imported, ${importResult.skipped} skipped, ${importResult.failed.length} failed`,
          changedById: actorId,
          changedByName: actorName,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error during import';
        await failJob(job.id, message);
      }
    })();
  });
}

/**
 * POST /api/v1/admin/import/accounts/run
 * Validates the CSV + mapping synchronously, creates the job, returns 202,
 * then runs the account import in the background.
 */
export async function runAccountsImport(req: Request, res: Response): Promise<void> {
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

  const accountMapping: AccountMapping = {
    name: mapping.name,
    industry: mapping.industry,
    website: mapping.website,
    employee_range: mapping.employee_range,
    revenue_range: mapping.revenue_range,
  };

  const adminId = req.user!.id;

  await startImportJob('accounts', req, res, (rows, onProgress) =>
    importAccounts(rows, accountMapping, adminId, skipDuplicates, onProgress),
  );
}

/**
 * POST /api/v1/admin/import/contacts/run
 * Validates the CSV + mapping synchronously, creates the job, returns 202,
 * then runs the contact import in the background.
 */
export async function runContactsImport(req: Request, res: Response): Promise<void> {
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

  const contactMapping: ContactMapping = {
    first_name: mapping.first_name,
    last_name: mapping.last_name,
    email: mapping.email,
    phone: mapping.phone,
    title: mapping.title,
    department: mapping.department,
    account_name: mapping.account_name,
  };

  const adminId = req.user!.id;

  await startImportJob('contacts', req, res, (rows, onProgress) =>
    importContacts(rows, contactMapping, adminId, onProgress),
  );
}

/**
 * POST /api/v1/admin/import/deals/run
 * Validates the CSV + mapping synchronously, creates the job, returns 202,
 * then runs the deal import in the background.
 */
export async function runDealsImport(req: Request, res: Response): Promise<void> {
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

  const dealMapping: DealMapping = {
    name: mapping.name,
    stage: mapping.stage,
    value: mapping.value,
    close_date: mapping.close_date,
    loss_reason: mapping.loss_reason,
    account_name: mapping.account_name,
    skip_unresolvable_accounts: mapping.skip_unresolvable_accounts,
  };

  const adminId = req.user!.id;

  await startImportJob('deals', req, res, (rows, onProgress) =>
    importDeals(rows, dealMapping, adminId, onProgress),
  );
}

// ── Job status endpoint ────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/import/jobs/:job_id
 * Returns the current state of an import job (admin only).
 */
export async function getImportJob(req: Request, res: Response): Promise<void> {
  const job_id = req.params['job_id'] as string;
  const job = await getJob(job_id);
  if (!job) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Import job not found' } });
    return;
  }
  res.json({
    job_id: job.id,
    type: job.type,
    status: job.status,
    total_rows: job.total_rows,
    processed_rows: job.processed_rows,
    created: job.created_count,
    skipped: job.skipped_count,
    failed: job.failed_count,
    error_csv: job.error_csv ?? null,
    started_at: job.started_at,
    completed_at: job.completed_at,
    created_at: job.created_at,
  });
}
