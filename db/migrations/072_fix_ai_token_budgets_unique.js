'use strict';

/**
 * Migration 072: Fix ai_token_budgets uniqueness for the org-default row.
 *
 * PostgreSQL does not enforce UNIQUE constraints on NULL values — multiple NULLs
 * are allowed. The UNIQUE (user_id) constraint from migration 070 therefore
 * permits multiple org-default rows (user_id IS NULL), which is wrong.
 *
 * Fix strategy:
 *   1. Drop the bad UNIQUE (user_id) constraint.
 *   2. Add a partial unique index WHERE user_id IS NOT NULL to enforce one-per-user.
 *   3. Add a partial unique index WHERE user_id IS NULL to enforce the single org-default.
 *   4. Clean up any duplicate org-default rows introduced during migration 070 tests,
 *      keeping only the row with the lowest created_at.
 *
 * (MINCRM-458)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Remove any duplicate org-default rows, keeping the earliest one.
  pgm.sql(`
    DELETE FROM ai_token_budgets
    WHERE user_id IS NULL
      AND id NOT IN (
        SELECT id FROM ai_token_budgets
        WHERE user_id IS NULL
        ORDER BY created_at ASC
        LIMIT 1
      );
  `);

  // Drop the constraint that doesn't handle NULLs correctly.
  pgm.sql(`ALTER TABLE ai_token_budgets DROP CONSTRAINT IF EXISTS ai_token_budgets_user_id_unique;`);

  // Per-user uniqueness: one override row per user_id (only for non-null rows).
  pgm.createIndex('ai_token_budgets', 'user_id', {
    unique: true,
    name: 'ai_token_budgets_user_id_idx',
    where: 'user_id IS NOT NULL',
  });

  // Org-default uniqueness: at most one row with user_id IS NULL.
  pgm.sql(`
    CREATE UNIQUE INDEX ai_token_budgets_org_default_idx
    ON ai_token_budgets ((user_id IS NULL))
    WHERE user_id IS NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS ai_token_budgets_org_default_idx;`);
  pgm.sql(`DROP INDEX IF EXISTS ai_token_budgets_user_id_idx;`);
  pgm.addConstraint('ai_token_budgets', 'ai_token_budgets_user_id_unique', 'UNIQUE (user_id)');
};
