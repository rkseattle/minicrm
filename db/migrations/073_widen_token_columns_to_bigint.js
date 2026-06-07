'use strict';

/**
 * Migration 073: Widen token count and budget columns from integer to bigint.
 *
 * PostgreSQL integer (int4) has a maximum of ~2.15 billion. High-volume tenants
 * accumulating token counts within a single month can exhaust this and receive
 * "integer out of range" errors on every subsequent AI call for that month.
 * monthly_limit in ai_token_budgets has the same ceiling, which is relevant now
 * that 0 = unlimited and large positive values set real caps.
 *
 * All three columns are widened to bigint (int8, max ~9.2 × 10^18).
 *
 * (MINCRM-458)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.alterColumn('ai_token_budgets', 'monthly_limit', { type: 'bigint' });
  pgm.alterColumn('ai_token_usage', 'input_tokens', { type: 'bigint' });
  pgm.alterColumn('ai_token_usage', 'output_tokens', { type: 'bigint' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.alterColumn('ai_token_usage', 'output_tokens', { type: 'integer' });
  pgm.alterColumn('ai_token_usage', 'input_tokens', { type: 'integer' });
  pgm.alterColumn('ai_token_budgets', 'monthly_limit', { type: 'integer' });
};
