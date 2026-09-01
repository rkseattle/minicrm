/**
 * Email sync job service — state tracking for mailbox backfills.
 *
 * Mirrors importJobService's create/progress/complete/fail/get surface, with one
 * difference that follows from the driver: an import job is started by a request and runs
 * to completion inside it, where a backfill is resumed by the scheduler across several
 * ticks. So progress advances repeatedly while status stays 'running', and the job
 * outlives any single caller.
 */

import pool from '../db.js';

export type EmailSyncJobStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface EmailSyncJobRow {
  id: string;
  connected_account_id: string;
  status: EmailSyncJobStatus;
  messages_synced: number;
  error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Opens a backfill job for a mailbox, or returns the one already in progress.
 *
 * Resuming is the normal path — a backfill spans many ticks — so a tick that finds
 * unfinished work must adopt it. Opening a second would strand the first: only one row is
 * reachable per account through the accessors here, and an unreachable job can never
 * reach a terminal status, which is the only status the retention purge deletes.
 *
 * Uniqueness is the partial index's job, not this function's. A `SELECT ... FOR UPDATE`
 * that matches nothing locks nothing, so a read-then-insert would let two ticks both find
 * no job and both insert; the index makes the second insert a conflict, and the conflict
 * resolves to adopting the winner's row.
 *
 * @param connectedAccountId - The mailbox being backfilled.
 * @returns The existing unfinished job, or a newly created one.
 */
export async function createEmailSyncJob(connectedAccountId: string): Promise<EmailSyncJobRow> {
  const inserted = await pool.query<EmailSyncJobRow>(
    `INSERT INTO email_sync_jobs (connected_account_id)
     VALUES ($1)
     ON CONFLICT (connected_account_id) WHERE status IN ('pending', 'running')
       DO NOTHING
     RETURNING *`,
    [connectedAccountId],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await getActiveEmailSyncJob(connectedAccountId);
  if (existing) return existing;

  // The conflicting job finished between the insert and this read, so the mailbox has no
  // active job after all and the caller's request to open one still stands.
  return createEmailSyncJob(connectedAccountId);
}

/**
 * Advances a job's progress, transitioning it to 'running' on the first call.
 *
 * `messages_synced` is set rather than incremented so a retried tick cannot double-count:
 * the caller knows the running total, and a tick that partially failed would otherwise
 * add its work twice.
 *
 * A finished job is left alone. Ticks outlive their job — one can return after the job
 * failed — and reviving it would leave a 'running' row carrying a completed_at.
 *
 * @param jobId - The job UUID.
 * @param messagesSynced - Running total of messages stored by this job.
 */
export async function updateEmailSyncJobProgress(
  jobId: string,
  messagesSynced: number,
): Promise<void> {
  await pool.query(
    `UPDATE email_sync_jobs
        SET status          = 'running',
            messages_synced = $2,
            started_at      = COALESCE(started_at, now())
      WHERE id = $1
        AND status IN ('pending', 'running')`,
    [jobId, messagesSynced],
  );
}

/**
 * Marks a job complete with its final count.
 *
 * A job that already finished is left alone, for the same reason progress updates are:
 * a late tick must not overwrite the outcome an earlier one recorded.
 *
 * @param jobId - The job UUID.
 * @param messagesSynced - Total messages stored by this job.
 */
export async function completeEmailSyncJob(jobId: string, messagesSynced: number): Promise<void> {
  await pool.query(
    `UPDATE email_sync_jobs
        SET status          = 'complete',
            messages_synced = $2,
            error           = NULL,
            completed_at    = now()
      WHERE id = $1
        AND status IN ('pending', 'running')`,
    [jobId, messagesSynced],
  );
}

/**
 * Marks a job failed, preserving the count it reached.
 *
 * A job that already finished is left alone: a late failure must not overwrite a
 * successful backfill's record with a stale error.
 *
 * @param jobId - The job UUID.
 * @param errorMessage - Why the backfill stopped.
 */
export async function failEmailSyncJob(jobId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE email_sync_jobs
        SET status       = 'failed',
            error        = $2,
            completed_at = now()
      WHERE id = $1
        AND status IN ('pending', 'running')`,
    [jobId, errorMessage],
  );
}

/**
 * Fetches one job by ID.
 *
 * @param jobId - The job UUID.
 * @returns The job row, or null when no such job exists.
 */
export async function getEmailSyncJob(jobId: string): Promise<EmailSyncJobRow | null> {
  const { rows } = await pool.query<EmailSyncJobRow>(
    'SELECT * FROM email_sync_jobs WHERE id = $1',
    [jobId],
  );
  return rows[0] ?? null;
}

/**
 * Returns the job still in progress for an account, if any.
 *
 * @param connectedAccountId - The mailbox to look up.
 * @returns The unfinished job, or null when the account has none.
 */
export async function getActiveEmailSyncJob(
  connectedAccountId: string,
): Promise<EmailSyncJobRow | null> {
  const { rows } = await pool.query<EmailSyncJobRow>(
    `SELECT * FROM email_sync_jobs
      WHERE connected_account_id = $1
        AND status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 1`,
    [connectedAccountId],
  );
  return rows[0] ?? null;
}
