'use strict';

/**
 * Migration 070: Create ai_token_budgets and ai_token_usage tables.
 *
 * ai_token_budgets — org-wide default and per-user monthly token limit overrides.
 *   user_id NULL  → org-wide default row (exactly one such row, seeded here)
 *   user_id set   → per-user override (higher or lower than the org default)
 *   monthly_limit = 0 means AI is effectively disabled for that user / org
 *
 * ai_token_usage — accumulated input+output token counts per user per calendar month.
 *   year_month format: 'YYYY-MM' (e.g. '2026-06')
 *   Upserted on each AI call; reset by starting a new month row (old rows preserved
 *   for historical reporting). Admins are tracked in org totals but are exempt from
 *   per-user limit enforcement.
 *
 * (MINCRM-458)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('ai_token_budgets', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    // NULL = org-wide default row. Non-null = per-user override.
    user_id: {
      type: 'uuid',
      notNull: false,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    // 0 = unlimited (no enforcement). Set a positive integer to impose a monthly cap.
    // NULL is never stored in this column.
    monthly_limit: {
      type: 'integer',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // At most one org-default row (user_id IS NULL) and at most one override per user.
  pgm.addConstraint('ai_token_budgets', 'ai_token_budgets_user_id_unique', 'UNIQUE (user_id)');

  pgm.createTable(
    'ai_token_usage',
    {
      user_id: {
        type: 'uuid',
        notNull: true,
        references: '"users"',
        onDelete: 'CASCADE',
      },
      // 'YYYY-MM' — calendar month bucket. New month = new row; old rows kept for history.
      year_month: {
        type: 'char(7)',
        notNull: true,
      },
      input_tokens: {
        type: 'integer',
        notNull: true,
        default: 0,
      },
      output_tokens: {
        type: 'integer',
        notNull: true,
        default: 0,
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    { constraints: { primaryKey: ['user_id', 'year_month'] } },
  );

  pgm.createIndex('ai_token_usage', 'year_month');

  // Seed the org-wide default: monthly_limit = 0 means "unlimited" out of the box
  // (admins configure a real limit to enable enforcement).
  // We use a sentinel value of 0 here and document that 0 = "no limit set / unlimited".
  // The service layer interprets 0 as unlimited when checking budgets.
  pgm.sql(`
    INSERT INTO ai_token_budgets (user_id, monthly_limit)
    VALUES (NULL, 0)
    ON CONFLICT (user_id) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('ai_token_usage');
  pgm.dropTable('ai_token_budgets');
};
