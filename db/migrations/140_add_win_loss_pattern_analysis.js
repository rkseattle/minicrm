'use strict';

/**
 * Migration 140: AI win/loss pattern analysis.
 *
 * Adds:
 *   1. ai_win_loss_insights feature flag (child of ai_features, same seeding
 *      pattern as migration 071).
 *   2. deal_win_loss_insights table — cached nightly analysis results. The
 *      nightly job (winLossAnalysisService.analyzeWinLossPatterns) replaces
 *      the full row set on each run; the read path serves whatever rows are
 *      currently in the table (no per-request AI call).
 *   3. Admin-tunable thresholds on ai_configuration, following the additive-
 *      column pattern established by migrations 134/137 (ai_session_retention_days,
 *      ai_cost_rate columns) rather than a new settings table.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_win_loss_insights',
        'Win/Loss Pattern Insights',
        'Nightly AI analysis of closed deals surfacing patterns that correlate with winning and losing.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.deal_win_loss_insights (
      id                uuid DEFAULT gen_random_uuid() NOT NULL,
      signal_type       text NOT NULL,
      observation       text NOT NULL,
      win_rate_with     numeric(5,2) NOT NULL,
      win_rate_without  numeric(5,2) NOT NULL,
      sample_size       integer NOT NULL,
      is_win_pattern    boolean NOT NULL,
      supporting_deal_ids uuid[] NOT NULL DEFAULT '{}',
      generated_at      timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT deal_win_loss_insights_pkey PRIMARY KEY (id),
      CONSTRAINT deal_win_loss_insights_sample_size_positive CHECK (sample_size >= 0)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.deal_win_loss_insights IS
      'Cached nightly AI win/loss pattern analysis results (MINCRM-464). Fully replaced on each run of analyzeWinLossPatterns — not appended.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS deal_win_loss_insights_generated_at_idx
      ON public.deal_win_loss_insights USING btree (generated_at)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS deal_win_loss_insights_is_win_pattern_idx
      ON public.deal_win_loss_insights USING btree (is_win_pattern)
  `);

  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS win_loss_min_closed_deals integer NOT NULL DEFAULT 20
        CONSTRAINT ai_configuration_win_loss_min_closed_deals_positive
          CHECK (win_loss_min_closed_deals > 0)
  `);
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS win_loss_min_sample_size integer NOT NULL DEFAULT 5
        CONSTRAINT ai_configuration_win_loss_min_sample_size_positive
          CHECK (win_loss_min_sample_size > 0)
  `);

  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.win_loss_min_closed_deals IS
      'Minimum total closed (won+lost) deals required before win/loss patterns are surfaced. (MINCRM-464)'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.win_loss_min_sample_size IS
      'Minimum supporting deal count for a pattern to be surfaced (confidence threshold). (MINCRM-464)'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS win_loss_min_closed_deals
  `);
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS win_loss_min_sample_size
  `);
  pgm.sql(`DROP TABLE IF EXISTS public.deal_win_loss_insights`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_win_loss_insights'`);
};
