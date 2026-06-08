/**
 * Audit partition management service. (MINCRM-521)
 *
 * Manages monthly child partitions for the audit_log partitioned table.
 * Called at server startup and on a monthly node-cron schedule to ensure
 * future partitions always exist ahead of the data insertion window.
 *
 * Partition naming convention: audit_log_y{YYYY}m{MM}
 * Example: audit_log_y2026m06 covers [2026-06-01, 2026-07-01).
 *
 * All operations are idempotent — calling this function when partitions
 * already exist is safe and has no effect.
 */

import pool from '../db.js';
import logger from '../logger.js';

/** Number of zero-padded digits in the month component of partition names. */
const MONTH_PAD_LENGTH = 2;

/**
 * Returns the partition table name for the month containing the given date.
 * Format: audit_log_y{YYYY}m{MM}
 */
export function auditPartitionName(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(MONTH_PAD_LENGTH, '0');
  return `audit_log_y${year}m${month}`;
}

/**
 * Returns the UTC start of the month containing the given date.
 */
function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Returns the UTC start of the month that is `offsetMonths` after `date`.
 */
function addMonths(date: Date, offsetMonths: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
}

/**
 * Ensures that monthly audit_log partitions exist for the current month
 * through `monthsAhead` months into the future.
 *
 * Uses CREATE TABLE IF NOT EXISTS so repeated calls are fully idempotent.
 * Each partition covers the half-open interval [month_start, next_month_start).
 *
 * @param monthsAhead - Number of additional months beyond the current month to
 *   pre-create. Defaults to 3, giving a rolling 4-month lookahead window.
 */
export async function ensureAuditLogPartitions(monthsAhead: number = 3): Promise<void> {
  const now = new Date();
  const created: string[] = [];

  for (let i = 0; i <= monthsAhead; i++) {
    const start = monthStart(addMonths(now, i));
    const end = addMonths(start, 1);
    const name = auditPartitionName(start);

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${name}
         PARTITION OF audit_log
         FOR VALUES FROM ($1) TO ($2)`,
      [start.toISOString(), end.toISOString()],
    );

    created.push(name);
  }

  logger.info({ partitions: created }, 'auditPartitionService: partition check complete');
}
