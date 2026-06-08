/**
 * retentionService.ts — Log table retention enforcement. (MINCRM-522)
 *
 * Deletes rows from append-only log tables that have aged past their defined
 * retention windows. Called once daily from server.ts, fire-and-forget.
 *
 * Retention policy (also documented in CLAUDE.md):
 *   automation_rule_logs  — 90 days  (keyed on triggered_at)
 *   webhook_delivery_logs — 30 days  (keyed on delivered_at)
 *   import_jobs           — 180 days (keyed on created_at; completed jobs only)
 *
 * Each table is purged in its own statement so a single large delete does not
 * hold a lock across all three tables. Row counts are logged for observability.
 */

import pool from '../db.js';
import logger from '../logger.js';

/** Retention window in days for each log table. */
const RETENTION_DAYS = {
  automation_rule_logs: 90,
  webhook_delivery_logs: 30,
  import_jobs: 180,
} as const;

/**
 * Deletes rows from automation_rule_logs older than the retention window.
 * The triggered_at column is indexed (rule_id, triggered_at) from migration 012,
 * so the range scan is efficient.
 */
async function purgeAutomationRuleLogs(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `DELETE FROM automation_rule_logs
      WHERE triggered_at < now() - ($1 || ' days')::interval
      RETURNING id`,
    [RETENTION_DAYS.automation_rule_logs],
  );
  return result.rowCount ?? 0;
}

/**
 * Deletes rows from webhook_delivery_logs older than the retention window.
 * The delivered_at column is indexed by migration 082.
 */
async function purgeWebhookDeliveryLogs(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `DELETE FROM webhook_delivery_logs
      WHERE delivered_at < now() - ($1 || ' days')::interval
      RETURNING id`,
    [RETENTION_DAYS.webhook_delivery_logs],
  );
  return result.rowCount ?? 0;
}

/**
 * Deletes completed or failed import_jobs older than the retention window.
 * In-progress jobs (status = 'pending' | 'running') are never purged
 * regardless of age, to preserve active job state for polling clients.
 */
async function purgeImportJobs(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `DELETE FROM import_jobs
      WHERE created_at < now() - ($1 || ' days')::interval
        AND status IN ('complete', 'failed')
      RETURNING id`,
    [RETENTION_DAYS.import_jobs],
  );
  return result.rowCount ?? 0;
}

/**
 * Runs all retention purges sequentially and logs the outcome.
 * Called fire-and-forget from the daily cron in server.ts — errors are caught
 * and logged but do not propagate to avoid crashing the scheduler.
 */
export async function runRetentionPurge(): Promise<void> {
  logger.info('retention: starting daily log table purge');

  try {
    const automationDeleted = await purgeAutomationRuleLogs();
    logger.info({ deleted: automationDeleted }, 'retention: automation_rule_logs purged');
  } catch (err) {
    logger.error({ err }, 'retention: failed to purge automation_rule_logs');
  }

  try {
    const webhookDeleted = await purgeWebhookDeliveryLogs();
    logger.info({ deleted: webhookDeleted }, 'retention: webhook_delivery_logs purged');
  } catch (err) {
    logger.error({ err }, 'retention: failed to purge webhook_delivery_logs');
  }

  try {
    const importJobsDeleted = await purgeImportJobs();
    logger.info({ deleted: importJobsDeleted }, 'retention: import_jobs purged');
  } catch (err) {
    logger.error({ err }, 'retention: failed to purge import_jobs');
  }

  logger.info('retention: daily log table purge complete');
}
