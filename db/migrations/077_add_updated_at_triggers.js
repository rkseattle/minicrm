'use strict';

/**
 * Migration 077: Add BEFORE UPDATE triggers to automatically set updated_at
 * on every table that exposes that column. (MINCRM-503)
 *
 * A single PL/pgSQL trigger function `set_updated_at()` is created once and
 * reused by a trigger on each table. The function sets NEW.updated_at to
 * clock_timestamp() (wall-clock time, not transaction start time) so that
 * multiple updates within the same transaction each get distinct timestamps.
 *
 * Tables covered (all tables with an updated_at column):
 *   accounts, activities, ai_token_budgets, ai_token_usage,
 *   automation_rules, contact_addresses, contacts, currencies,
 *   custom_field_values, custom_reports, deals, feature_flags,
 *   leads, notes, pipeline_stages, pipelines,
 *   sales_sequence_steps, sales_sequences, sequence_enrollments,
 *   system_settings, tags, users
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** Tables that need the trigger, in alphabetical order. */
const TABLES = [
  'accounts',
  'activities',
  'ai_token_budgets',
  'ai_token_usage',
  'automation_rules',
  'contact_addresses',
  'contacts',
  'currencies',
  'custom_field_values',
  'custom_reports',
  'deals',
  'feature_flags',
  'leads',
  'notes',
  'pipeline_stages',
  'pipelines',
  'sales_sequence_steps',
  'sales_sequences',
  'sequence_enrollments',
  'system_settings',
  'tags',
  'users',
];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Create the shared trigger function once.
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = clock_timestamp();
      RETURN NEW;
    END;
    $$;
  `);

  // Attach a BEFORE UPDATE trigger to every table with an updated_at column.
  // DROP … IF EXISTS before CREATE makes the block idempotent on re-runs or
  // partial failures, matching the same defensive pattern used in exports.down.
  for (const table of TABLES) {
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
  // Drop triggers in reverse order, then the shared function.
  for (const table of [...TABLES].reverse()) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_set_updated_at ON ${table};`);
  }

  pgm.sql(`DROP FUNCTION IF EXISTS set_updated_at();`);
};
