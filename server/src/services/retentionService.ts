/**
 * retentionService.ts — Log table retention enforcement. (MINCRM-522, MINCRM-447)
 *
 * Deletes rows from append-only log tables that have aged past their defined
 * retention windows. Called once daily from server.ts, fire-and-forget.
 *
 * Retention policy (also documented in docs/dev/retention.md):
 *   automation_rule_logs  — 90 days  (keyed on triggered_at)
 *   webhook_delivery_logs — 30 days  (keyed on delivered_at)
 *   import_jobs           — 180 days (keyed on created_at; completed jobs only)
 *   ai_sessions           — configurable (default 90 days, min 30); reads
 *                           ai_configuration.ai_session_retention_days each run.
 *                           Cascade delete removes ai_messages automatically.
 *                           user_ai_context is NOT purged by this policy.
 *
 * Each table is purged in its own statement so a single large delete does not
 * hold a lock across all three tables. Row counts are logged for observability.
 */

import pool from '../db.js';
import logger from '../logger.js';
import { writeAuditEntry, SYSTEM_ACTOR } from './auditService.js';

/** Fallback AI session retention window when ai_configuration has no row. */
const AI_SESSION_RETENTION_DAYS_DEFAULT = 90;

/** Retention window in days for each log table. */
const RETENTION_DAYS = {
  automation_rule_logs: 90,
  webhook_delivery_logs: 30,
  import_jobs: 180,
} as const;

/**
 * Deletes rows from automation_rule_logs older than the retention window.
 * The standalone triggered_at index added in migration 082 covers this range scan.
 */
async function purgeAutomationRuleLogs(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM automation_rule_logs
      WHERE triggered_at < now() - ($1 || ' days')::interval`,
    [RETENTION_DAYS.automation_rule_logs],
  );
  return result.rowCount ?? 0;
}

/**
 * Deletes rows from webhook_delivery_logs older than the retention window.
 * The delivered_at column is indexed by migration 082.
 */
async function purgeWebhookDeliveryLogs(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM webhook_delivery_logs
      WHERE delivered_at < now() - ($1 || ' days')::interval`,
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
  const result = await pool.query(
    `DELETE FROM import_jobs
      WHERE created_at < now() - ($1 || ' days')::interval
        AND status IN ('complete', 'failed')`,
    [RETENTION_DAYS.import_jobs],
  );
  return result.rowCount ?? 0;
}

/**
 * Purges ai_sessions (and, via ON DELETE CASCADE, ai_messages) older than the
 * configured retention window. The window is read fresh from ai_configuration
 * each run so a mid-day admin change takes effect on the next nightly run.
 *
 * Returns the number of sessions deleted; message rows are removed implicitly
 * by the FK cascade and are not counted separately.
 *
 * Writes one audit entry recording the purge outcome. user_ai_context rows are
 * explicitly excluded — they are persistent personalisation data, not transcripts.
 *
 * Exported so it can be invoked directly by the manual "purge now" admin
 * endpoint (MINCRM-462), reusing the exact same logic and audit trail as the
 * nightly cron path rather than duplicating it.
 */
export async function purgeAiSessions(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Read retention_days and execute the DELETE atomically in one statement by
    // embedding the config lookup as a subquery. This eliminates the TOCTOU window
    // where an admin could change the retention setting between a separate read and
    // the subsequent DELETE, causing the wrong window to be applied.
    const result = await client.query<{ count: string; retention_days: number }>(
      `WITH cfg AS (
         SELECT COALESCE(ai_session_retention_days, $1) AS retention_days
         FROM ai_configuration
         LIMIT 1
       ),
       deleted AS (
         DELETE FROM ai_sessions
         WHERE created_at < now() - ((SELECT retention_days FROM cfg) || ' days')::interval
         RETURNING id
       )
       SELECT count(deleted.*)::text AS count, (SELECT retention_days FROM cfg) AS retention_days
       FROM deleted`,
      [AI_SESSION_RETENTION_DAYS_DEFAULT],
    );

    const deletedCount = parseInt(result.rows[0]?.count ?? '0', 10);
    const retentionDays = result.rows[0]?.retention_days ?? AI_SESSION_RETENTION_DAYS_DEFAULT;

    await writeAuditEntry(client, {
      recordType: 'ai_sessions',
      recordName: 'AI Session Retention Purge',
      eventType: 'deleted',
      newValue: `Purged ${deletedCount} session(s) older than ${retentionDays} day(s)`,
      changedById: SYSTEM_ACTOR.id,
      changedByName: SYSTEM_ACTOR.name,
    });

    await client.query('COMMIT');
    return deletedCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Counts of AI session data currently stored, for the retention admin UI (MINCRM-462). */
export interface AiSessionRetentionStats {
  sessionCount: number;
  messageCount: number;
}

/**
 * Returns the current counts of ai_sessions and ai_messages rows.
 * Read-only — used by the admin retention settings UI to show "N sessions,
 * M messages currently stored" alongside the configured retention window.
 */
export async function getAiSessionRetentionStats(): Promise<AiSessionRetentionStats> {
  const result = await pool.query<{ session_count: string; message_count: string }>(
    `SELECT
       (SELECT count(*) FROM ai_sessions)::text AS session_count,
       (SELECT count(*) FROM ai_messages)::text AS message_count`,
  );
  return {
    sessionCount: parseInt(result.rows[0]?.session_count ?? '0', 10),
    messageCount: parseInt(result.rows[0]?.message_count ?? '0', 10),
  };
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

  try {
    const aiSessionsDeleted = await purgeAiSessions();
    logger.info({ deleted: aiSessionsDeleted }, 'retention: ai_sessions purged');
  } catch (err) {
    logger.error({ err }, 'retention: failed to purge ai_sessions');
  }

  logger.info('retention: daily log table purge complete');
}
