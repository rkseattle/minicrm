'use strict';

/**
 * Migration 081: Add updated_at to custom_field_definitions and import_jobs,
 * and attach the set_updated_at() trigger to both tables.
 *
 * custom_field_definitions has only created_at — field definitions can be
 * renamed or reordered with no record of when the last change occurred.
 *
 * import_jobs has created_at, started_at, and completed_at, but no general
 * updated_at for tracking intermediate status transitions (pending → running).
 *
 * The set_updated_at() trigger function was created in migration 077. This
 * migration adds the two new tables to the trigger coverage set, following
 * the same pattern established there.
 *
 * Existing rows receive now() as the initial updated_at value.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

const NEW_TABLES = ['custom_field_definitions', 'import_jobs'];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  for (const table of NEW_TABLES) {
    pgm.sql(`
      ALTER TABLE ${table}
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);

    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_set_updated_at ON ${table};`);
    pgm.sql(`
      CREATE TRIGGER ${table}_set_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    `);
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  for (const table of [...NEW_TABLES].reverse()) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_set_updated_at ON ${table};`);
    pgm.sql(`ALTER TABLE ${table} DROP COLUMN IF EXISTS updated_at;`);
  }
};
