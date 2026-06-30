'use strict';

/**
 * Migration 134: Add ai_session_retention_days column to ai_configuration.
 *
 * Stores the number of days AI sessions and messages are retained before the
 * nightly purge job hard-deletes them. Minimum 30 days enforced at DB level;
 * default 90 days matches the automation_rule_logs retention window.
 *
 * user_ai_context entries are explicitly excluded from this retention policy
 * (they are persistent personalisation data, not conversation transcripts).
 *
 * (MINCRM-447)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS ai_session_retention_days integer NOT NULL DEFAULT 90
        CONSTRAINT ai_configuration_session_retention_min
          CHECK (ai_session_retention_days >= 30)
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.ai_session_retention_days IS
      'Days to retain ai_sessions/ai_messages before nightly hard-delete purge. Minimum 30, default 90. user_ai_context is NOT subject to this policy. (MINCRM-447)'
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS ai_session_retention_days
  `);
};
