/**
 * Migration 101: Drop FK from currency_rate_history.code to currencies (MINCRM-526)
 *
 * currency_rate_history is an immutable audit log. The ON DELETE CASCADE defined in
 * migration 099 causes PostgreSQL to wipe every history row for a currency the moment
 * that currency is deleted from the currencies table — which is exactly the data the
 * table was designed to preserve. Deals denominated in a removed currency must still
 * be convertible using the last-known rate; the CASCADE silently makes that impossible.
 *
 * Replacing CASCADE with no referential action (dropping the FK entirely) treats
 * currency_rate_history as append-only audit storage rather than a child table.
 * The application enforces the invariant that only valid ISO codes are inserted;
 * a DB-level FK is not needed for correctness here.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Apply the migration: drop the CASCADE FK so history rows survive currency deletion.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('currency_rate_history', 'currency_rate_history_code_fkey');
};

/**
 * Revert: restore the FK (without CASCADE — RESTRICT prevents silent data loss).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.addConstraint('currency_rate_history', 'currency_rate_history_code_fkey', {
    foreignKeys: {
      columns: 'code',
      references: 'currencies(code)',
      onDelete: 'RESTRICT',
    },
  });
};
