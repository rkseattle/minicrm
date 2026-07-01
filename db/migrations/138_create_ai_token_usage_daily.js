'use strict';

/**
 * Migration 138: Create ai_token_usage_daily table.
 *
 * Additive, per-day, per-feature token usage tracking for the AI usage/cost
 * dashboard. Deliberately separate from ai_token_usage (per-user, per-month,
 * used for budget enforcement) rather than widening that table — budget
 * enforcement's upsert-by-month semantics must not change, and a failure
 * writing to this new table must never affect that existing path.
 *
 * feature is free text (not a DB enum) so new AI features can start recording
 * usage without a migration; the server validates against a small in-code
 * allow-list instead.
 *
 * (MINCRM-459)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_token_usage_daily (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      usage_date     date NOT NULL,
      feature        text NOT NULL DEFAULT 'nli_chat',
      input_tokens   bigint NOT NULL DEFAULT 0,
      output_tokens  bigint NOT NULL DEFAULT 0,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT ai_token_usage_daily_pkey PRIMARY KEY (id)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.ai_token_usage_daily IS
      'Per-day, per-feature token usage for the AI usage/cost dashboard. Additive to ai_token_usage, which remains the source of truth for monthly budget enforcement. (MINCRM-459)'
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_token_usage_daily_user_date_feature_idx
      ON public.ai_token_usage_daily USING btree (user_id, usage_date, feature)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ai_token_usage_daily_usage_date_idx
      ON public.ai_token_usage_daily USING btree (usage_date)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS ai_token_usage_daily_feature_idx
      ON public.ai_token_usage_daily USING btree (feature)
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.ai_token_usage_daily`);
};
