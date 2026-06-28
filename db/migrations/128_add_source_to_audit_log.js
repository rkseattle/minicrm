/**
 * Migration 128: Add source column to audit_log (MINCRM-444)
 *
 * Adds a nullable source column to track whether an audit entry was created
 * by a human via REST or by the AI assistant (NLI). NULL means human/REST.
 * Uses varchar(20) with a CHECK constraint (never a PG ENUM per project rules).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      ADD COLUMN IF NOT EXISTS source varchar(20) DEFAULT NULL
        CONSTRAINT audit_log_source_check
          CHECK (source IN ('AI (NLI)', 'AI (context)'))
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE audit_log DROP COLUMN IF EXISTS source`);
};
