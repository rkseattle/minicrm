'use strict';

/**
 * Migration 149: AI sentiment tracking over time.
 *
 * Adds:
 *   1. ai_sentiment_tracking feature flag (child of the AI category).
 *   2. activity_sentiment_scores table — one row per activity holding its
 *      AI-inferred sentiment. Mirrors contact_champion_blocker_signals'
 *      rep-feedback pattern (see migration 141) but keyed per-activity
 *      rather than per-contact, since sentiment is scored per note/call
 *      summary, not merged into a rolling per-contact classification.
 *      Trend sparklines (Contact) and aggregate trends (Account) are
 *      computed at read time by joining this table to activities — no
 *      separate rollup table.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_sentiment_tracking',
        'AI Sentiment Tracking',
        'Scores activity notes and call summaries for sentiment and shows trend indicators on Contact and Account detail views.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.activity_sentiment_scores (
      id                      uuid DEFAULT gen_random_uuid() NOT NULL,
      activity_id             uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
      sentiment               text NOT NULL,
      confidence              numeric(3,2) NOT NULL DEFAULT 0,
      -- Rep "not accurate" feedback (mirrors contact_champion_blocker_signals.dismissed_*):
      -- a flagged score is excluded from trend calculations but the row is kept for audit.
      flagged_inaccurate_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
      flagged_inaccurate_at   timestamp with time zone,
      created_at              timestamp with time zone DEFAULT now() NOT NULL,
      updated_at              timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT activity_sentiment_scores_pkey PRIMARY KEY (id),
      CONSTRAINT activity_sentiment_scores_activity_id_unique UNIQUE (activity_id),
      CONSTRAINT activity_sentiment_scores_sentiment_check
        CHECK (sentiment IN ('positive', 'neutral', 'negative'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.activity_sentiment_scores IS
      'Per-activity AI sentiment classification (MINCRM-472). One row per activity, scored asynchronously after save.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS activity_sentiment_scores_activity_id_idx
      ON public.activity_sentiment_scores USING btree (activity_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.activity_sentiment_scores`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_sentiment_tracking'`);
};
