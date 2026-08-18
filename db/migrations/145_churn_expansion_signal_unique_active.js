'use strict';

/**
 * Migration 145: prevent duplicate active churn/expansion signals per account.
 *
 * detectChurnExpansionSignals() reads the current active signal for an account
 * with a plain SELECT before opening its write transaction. Two overlapping
 * nightly-job runs on the same account can both observe "no active signal" and
 * both insert one, leaving two active rows of the same signal_type — the UI then
 * shows duplicate signals and can fire duplicate notifications. A partial unique
 * index makes the second concurrent insert fail at the database level instead of
 * silently succeeding.
 *
 * Different signal types (churn_risk vs expansion) may legitimately be active on
 * the same account at once — the constraint is scoped to (account_id, signal_type),
 * not account_id alone.
 *
 * Any pre-existing duplicates (from the race actually occurring before this fix)
 * are resolved by clearing all but the most-recently-detected active row per
 * (account_id, signal_type) so the migration is safe to run against data that
 * already hit the bug.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    UPDATE public.account_churn_expansion_signals AS s
    SET cleared_at = now()
    WHERE s.cleared_at IS NULL
      AND s.id NOT IN (
        SELECT DISTINCT ON (account_id, signal_type) id
        FROM public.account_churn_expansion_signals
        WHERE cleared_at IS NULL
        ORDER BY account_id, signal_type, detected_at DESC
      )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS account_churn_expansion_signals_one_active_per_type
      ON public.account_churn_expansion_signals USING btree (account_id, signal_type)
      WHERE cleared_at IS NULL
  `);

  pgm.sql(`
    COMMENT ON INDEX public.account_churn_expansion_signals_one_active_per_type IS
      'At most one active (cleared_at IS NULL) signal per account per signal_type — guards against overlapping nightly-job runs racing to insert duplicates. (MINCRM-469)'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS public.account_churn_expansion_signals_one_active_per_type`);
};
