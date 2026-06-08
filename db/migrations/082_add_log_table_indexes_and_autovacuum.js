'use strict';

/**
 * Migration 082: Add missing indexes for append-only log tables and tune
 * autovacuum for tables with burst write patterns. (MINCRM-522)
 *
 * Indexes added:
 *   automation_rule_logs_outcome_idx    — filtering for failed executions
 *   webhook_delivery_logs_delivered_at_idx — recent delivery history and purge queries
 *   sequence_enrollment_logs_executed_at_idx — time-range queries on step execution
 *   import_jobs_status_idx             — polling for pending/running jobs
 *
 * Index replaced:
 *   feature_flag_usage_used_at_idx is dropped and replaced with a composite
 *   (flag_key, used_at) index. The "active users per flag in the last 30 days"
 *   query filters on flag_key first, then restricts on used_at — a leading
 *   flag_key column eliminates the full-table scan on the previous single-column index.
 *
 * Autovacuum tuning:
 *   automation_rule_logs and webhook_delivery_logs receive burst writes during
 *   automation runs and webhook delivery attempts. The default 20% dead-tuple
 *   threshold (autovacuum_vacuum_scale_factor = 0.2) allows significant bloat
 *   between cycles as these tables grow. Lowering to 5% triggers vacuum cycles
 *   more aggressively, keeping bloat bounded without requiring manual VACUUM calls.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX automation_rule_logs_outcome_idx
      ON automation_rule_logs (outcome);
  `);

  pgm.sql(`
    CREATE INDEX webhook_delivery_logs_delivered_at_idx
      ON webhook_delivery_logs (delivered_at);
  `);

  pgm.sql(`
    CREATE INDEX sequence_enrollment_logs_executed_at_idx
      ON sequence_enrollment_logs (executed_at);
  `);

  pgm.sql(`
    CREATE INDEX import_jobs_status_idx
      ON import_jobs (status);
  `);

  // Replace the single-column used_at index with a leading-flag_key composite
  // that covers the "active users per flag in the last N days" query pattern.
  pgm.sql('DROP INDEX IF EXISTS feature_flag_usage_used_at_idx;');
  pgm.sql(`
    CREATE INDEX feature_flag_usage_flag_key_used_at_idx
      ON feature_flag_usage (flag_key, used_at);
  `);

  // Tune autovacuum for tables with burst write patterns.
  pgm.sql(`
    ALTER TABLE automation_rule_logs
      SET (autovacuum_vacuum_scale_factor = 0.05);
  `);
  pgm.sql(`
    ALTER TABLE webhook_delivery_logs
      SET (autovacuum_vacuum_scale_factor = 0.05);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE webhook_delivery_logs
      RESET (autovacuum_vacuum_scale_factor);
  `);
  pgm.sql(`
    ALTER TABLE automation_rule_logs
      RESET (autovacuum_vacuum_scale_factor);
  `);

  pgm.sql('DROP INDEX IF EXISTS feature_flag_usage_flag_key_used_at_idx;');
  pgm.sql(`
    CREATE INDEX feature_flag_usage_used_at_idx
      ON feature_flag_usage (used_at);
  `);

  pgm.sql('DROP INDEX IF EXISTS import_jobs_status_idx;');
  pgm.sql('DROP INDEX IF EXISTS sequence_enrollment_logs_executed_at_idx;');
  pgm.sql('DROP INDEX IF EXISTS webhook_delivery_logs_delivered_at_idx;');
  pgm.sql('DROP INDEX IF EXISTS automation_rule_logs_outcome_idx;');
};
