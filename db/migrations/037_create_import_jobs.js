/**
 * Migration 037: Create import_jobs table for async CSV import
 *
 * Stores the state of background CSV import jobs so the client can poll for
 * progress and retrieve the final result without holding open the HTTP connection.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE import_jobs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type           VARCHAR(16)  NOT NULL,
      status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
      total_rows     INTEGER,
      processed_rows INTEGER      NOT NULL DEFAULT 0,
      created_count  INTEGER      NOT NULL DEFAULT 0,
      skipped_count  INTEGER      NOT NULL DEFAULT 0,
      failed_count   INTEGER      NOT NULL DEFAULT 0,
      error_csv      TEXT,
      created_by     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at     TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
    )
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql('DROP TABLE import_jobs');
};
