'use strict';

/**
 * Migration 151: AI relationship health scoring per account. (MINCRM-467)
 *
 * Adds:
 *   1. ai_relationship_health_score feature flag (child of the AI category).
 *   2. account_health_scoring_config — single admin-editable row of typed
 *      weight/threshold columns driving the composite score. Per ADR-002,
 *      this is a fixed-column table (mirrors org_visibility_settings), not
 *      a jsonb config blob, so weights stay queryable/validatable.
 *   3. account_health_scores — current cached score per account, computed
 *      nightly and served from cache during the day (per AC). One row per
 *      account (upsert on each run).
 *   4. account_health_score_history — append-only, one row per account per
 *      computation run, feeding the 6-month trend sparkline. Never updated,
 *      only inserted; pruned by a future retention job if needed (not in
 *      scope for this ticket).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_relationship_health_score',
        'AI Relationship Health Score',
        'Nightly AI-computed relationship health score per account, shown as a badge with trend history and single-threaded risk flag.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.account_health_scoring_config (
      id                              boolean NOT NULL DEFAULT true,
      frequency_weight                numeric(4,3) NOT NULL DEFAULT 0.250,
      recency_weight                  numeric(4,3) NOT NULL DEFAULT 0.250,
      seniority_weight                numeric(4,3) NOT NULL DEFAULT 0.150,
      sentiment_weight                numeric(4,3) NOT NULL DEFAULT 0.200,
      breadth_weight                  numeric(4,3) NOT NULL DEFAULT 0.150,
      strong_threshold                numeric(5,2) NOT NULL DEFAULT 80.00,
      healthy_threshold               numeric(5,2) NOT NULL DEFAULT 60.00,
      cooling_threshold               numeric(5,2) NOT NULL DEFAULT 40.00,
      at_risk_threshold                numeric(5,2) NOT NULL DEFAULT 20.00,
      min_logged_activities           integer NOT NULL DEFAULT 3,
      recency_window_days             integer NOT NULL DEFAULT 90,
      single_threaded_window_days     integer NOT NULL DEFAULT 90,
      updated_at                      timestamptz NOT NULL DEFAULT now(),
      updated_by                      uuid REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT account_health_scoring_config_pkey PRIMARY KEY (id),
      CONSTRAINT account_health_scoring_config_singleton CHECK (id = true),
      CONSTRAINT account_health_scoring_config_weights_sum_check
        CHECK (
          frequency_weight + recency_weight + seniority_weight + sentiment_weight + breadth_weight
          BETWEEN 0.999 AND 1.001
        ),
      CONSTRAINT account_health_scoring_config_threshold_order_check
        CHECK (
          strong_threshold > healthy_threshold
          AND healthy_threshold > cooling_threshold
          AND cooling_threshold > at_risk_threshold
        ),
      CONSTRAINT account_health_scoring_config_min_activities_check
        CHECK (min_logged_activities >= 1),
      CONSTRAINT account_health_scoring_config_windows_check
        CHECK (recency_window_days >= 1 AND single_threaded_window_days >= 1)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.account_health_scoring_config IS
      'Singleton admin-editable weights/thresholds for account health scoring (MINCRM-467). id is a boolean-typed singleton key (id = true) following the single-row-config convention.'
  `);

  pgm.sql(`
    INSERT INTO public.account_health_scoring_config (id) VALUES (true)
    ON CONFLICT (id) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.account_health_scores (
      account_id                uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
      score                     numeric(5,2) NOT NULL,
      state                     text NOT NULL,
      single_threaded_risk      boolean NOT NULL DEFAULT false,
      contributing_factors      jsonb NOT NULL DEFAULT '[]',
      computed_at                timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT account_health_scores_pkey PRIMARY KEY (account_id),
      CONSTRAINT account_health_scores_score_range CHECK (score BETWEEN 0 AND 100),
      CONSTRAINT account_health_scores_state_check
        CHECK (state IN ('strong', 'healthy', 'cooling', 'at_risk', 'dormant'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.account_health_scores IS
      'Current cached relationship health score per account (MINCRM-467). Upserted nightly; the read path never computes live. Absence of a row means insufficient data (fewer than min_logged_activities logged activities).'
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.account_health_score_history (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
      score         numeric(5,2) NOT NULL,
      state         text NOT NULL,
      computed_at   timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT account_health_score_history_pkey PRIMARY KEY (id),
      CONSTRAINT account_health_score_history_score_range CHECK (score BETWEEN 0 AND 100),
      CONSTRAINT account_health_score_history_state_check
        CHECK (state IN ('strong', 'healthy', 'cooling', 'at_risk', 'dormant'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.account_health_score_history IS
      'Append-only per-run history of account health scores (MINCRM-467), feeding the 6-month trend sparkline on the Account detail view. One row inserted per account per nightly run.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS account_health_score_history_account_id_computed_at_idx
      ON public.account_health_score_history USING btree (account_id, computed_at DESC)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.account_health_score_history`);
  pgm.sql(`DROP TABLE IF EXISTS public.account_health_scores`);
  pgm.sql(`DROP TABLE IF EXISTS public.account_health_scoring_config`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_relationship_health_score'`);
};
