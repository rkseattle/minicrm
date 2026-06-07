/**
 * Import job service — CRUD helpers for the import_jobs table.
 * Used by the background runner in importController to track async CSV import progress.
 * MINCRM-255
 */

import pool from '../db.js';

export type ImportJobStatus = 'pending' | 'running' | 'complete' | 'failed';
export type ImportJobType = 'contacts' | 'accounts' | 'deals';

export interface ImportJobRow {
  id: string;
  type: ImportJobType;
  status: ImportJobStatus;
  total_rows: number | null;
  processed_rows: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  error_csv: string | null;
  /** NULL when the creating user has been deleted (MINCRM-505) */
  created_by: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

/**
 * Creates a new import job row in pending status.
 *
 * @param type - The entity type being imported.
 * @param totalRows - Total number of data rows in the CSV.
 * @param createdBy - ID of the admin user who initiated the import.
 * @returns The newly created job row.
 */
export async function createJob(
  type: ImportJobType,
  totalRows: number,
  createdBy: string,
): Promise<ImportJobRow> {
  const { rows } = await pool.query<ImportJobRow>(
    `INSERT INTO import_jobs (type, total_rows, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [type, totalRows, createdBy],
  );
  return rows[0];
}

/**
 * Transitions a job to 'running' and writes the started_at timestamp.
 * Also updates the per-batch progress counters.
 *
 * @param jobId - The job UUID.
 * @param processedRows - Number of rows processed so far.
 * @param createdCount - Number of records created so far.
 * @param skippedCount - Number of rows skipped so far.
 * @param failedCount - Number of rows failed so far.
 */
export async function updateJobProgress(
  jobId: string,
  processedRows: number,
  createdCount: number,
  skippedCount: number,
  failedCount: number,
): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
     SET status         = 'running',
         processed_rows = $2,
         created_count  = $3,
         skipped_count  = $4,
         failed_count   = $5,
         started_at     = COALESCE(started_at, now())
     WHERE id = $1`,
    [jobId, processedRows, createdCount, skippedCount, failedCount],
  );
}

/**
 * Marks a job as complete with final counts and the error CSV (if any failures).
 *
 * @param jobId - The job UUID.
 * @param createdCount - Total records created.
 * @param skippedCount - Total rows skipped.
 * @param failedCount - Total rows failed.
 * @param errorCsv - CSV string of failed rows (empty string when no failures).
 */
export async function completeJob(
  jobId: string,
  createdCount: number,
  skippedCount: number,
  failedCount: number,
  errorCsv: string,
): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
     SET status        = 'complete',
         created_count = $2,
         skipped_count = $3,
         failed_count  = $4,
         error_csv     = NULLIF($5, ''),
         completed_at  = now(),
         processed_rows = total_rows
     WHERE id = $1`,
    [jobId, createdCount, skippedCount, failedCount, errorCsv],
  );
}

/**
 * Marks a job as failed with an error message stored in error_csv.
 *
 * @param jobId - The job UUID.
 * @param errorMessage - Human-readable failure reason.
 */
export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
     SET status       = 'failed',
         error_csv    = $2,
         completed_at = now()
     WHERE id = $1`,
    [jobId, errorMessage],
  );
}

/**
 * Fetches a single import job by ID.
 *
 * @param jobId - The job UUID.
 * @returns The job row, or null if not found.
 */
export async function getJob(jobId: string): Promise<ImportJobRow | null> {
  const { rows } = await pool.query<ImportJobRow>('SELECT * FROM import_jobs WHERE id = $1', [
    jobId,
  ]);
  return rows[0] ?? null;
}

/**
 * Deletes import_jobs rows older than 7 days.
 * Called at the start of each POST /api/admin/import/:type/run request.
 */
export async function pruneOldJobs(): Promise<void> {
  await pool.query(`DELETE FROM import_jobs WHERE created_at < now() - INTERVAL '7 days'`);
}
