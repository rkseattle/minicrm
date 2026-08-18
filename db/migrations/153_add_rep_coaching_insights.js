'use strict';

/**
 * Migration 153: Deal stage history tracking + AI rep coaching insights.
 *
 * Adds:
 *   1. deal_stage_history — append-only log of every real stage transition a
 *      deal makes. Populated going forward by dealService.createDeal (day-0
 *      row), dealService.updateDeal, bulkService/bulkV2Service change_stage
 *      actions. NOT populated by pipelineStageService.updatePipelineStage's
 *      stage-rename path, since renaming a stage's label is not a transition.
 *      This table does not exist prior to this migration, so "average days
 *      per stage" starts sparse and improves as new transitions accumulate —
 *      there is no way to backfill history for deals that already changed
 *      stage before this migration ran.
 *   2. ai_rep_coaching_insights feature flag (child of the AI category).
 *   3. rep_coaching_scoring_config — singleton admin-editable thresholds
 *      (min closed deals, per-metric outlier thresholds). Per ADR-002, a
 *      fixed-column table, not a jsonb blob, mirroring
 *      account_health_scoring_config (migration 151).
 *   4. rep_coaching_insights — current cached insight set per rep (one row
 *      per rep per metric), upserted nightly. Absence of rows for a rep means
 *      insufficient data (fewer than min_closed_deals closed deals).
 *   5. rep_coaching_insight_history — append-only, one row per rep per metric
 *      per computation run, for future trend views.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── 1. deal_stage_history ────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.deal_stage_history (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
      pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
      stage       text NOT NULL,
      entered_at  timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT deal_stage_history_pkey PRIMARY KEY (id)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.deal_stage_history IS
      'Append-only log of real deal stage transitions (MINCRM-474). One row per deal per stage entered, including a day-0 row on creation. Never updated, only inserted. Powers average-days-per-stage and stage-conversion-rate metrics for rep coaching insights.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS deal_stage_history_deal_id_entered_at_idx
      ON public.deal_stage_history USING btree (deal_id, entered_at ASC)
  `);

  // ── 2. Feature flag ──────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_rep_coaching_insights',
        'AI Rep Coaching Insights',
        'Nightly AI-computed per-rep coaching insights (stage timing, conversion rates, activity patterns, win rates) compared against team averages, with recommended coaching actions.',
        'AI',
        true,
        '{"admin":true,"manager":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  // ── 3. rep_coaching_scoring_config (singleton) ──────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.rep_coaching_scoring_config (
      id                          boolean NOT NULL DEFAULT true,
      min_closed_deals            integer NOT NULL DEFAULT 10,
      stage_time_outlier_ratio    numeric(4,2) NOT NULL DEFAULT 1.50,
      activity_frequency_outlier_ratio numeric(4,2) NOT NULL DEFAULT 0.50,
      -- response_time_after_activity has no explicit reply/thread-tracking field in this
      -- schema; it is computed as the median gap between consecutive activities logged
      -- against the same deal, as a defensible proxy for "how quickly the rep follows up".
      response_time_outlier_hours integer NOT NULL DEFAULT 48,
      win_rate_outlier_delta      numeric(4,3) NOT NULL DEFAULT 0.150,
      updated_at                  timestamptz NOT NULL DEFAULT now(),
      updated_by                  uuid REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT rep_coaching_scoring_config_pkey PRIMARY KEY (id),
      CONSTRAINT rep_coaching_scoring_config_singleton CHECK (id = true),
      CONSTRAINT rep_coaching_scoring_config_min_closed_deals_check CHECK (min_closed_deals >= 1),
      CONSTRAINT rep_coaching_scoring_config_stage_ratio_check CHECK (stage_time_outlier_ratio > 1),
      CONSTRAINT rep_coaching_scoring_config_activity_ratio_check
        CHECK (activity_frequency_outlier_ratio > 0 AND activity_frequency_outlier_ratio < 1),
      CONSTRAINT rep_coaching_scoring_config_response_hours_check CHECK (response_time_outlier_hours >= 1),
      CONSTRAINT rep_coaching_scoring_config_win_rate_delta_check
        CHECK (win_rate_outlier_delta > 0 AND win_rate_outlier_delta < 1)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.rep_coaching_scoring_config IS
      'Singleton admin-editable thresholds for rep coaching insight generation (MINCRM-474). id is a boolean-typed singleton key (id = true) following the single-row-config convention (see account_health_scoring_config, migration 151).'
  `);

  pgm.sql(`
    INSERT INTO public.rep_coaching_scoring_config (id) VALUES (true)
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 4. rep_coaching_insights (current) ──────────────────────────────────
  //
  // segment distinguishes breakdown metrics (stage_conversion_rate: stage name;
  // deal_size_distribution: size bucket label; win_rate_by_industry: industry;
  // win_rate_by_lead_source: lead source) from whole-rep metrics (segment = '').
  // '' rather than NULL so ON CONFLICT (rep_id, metric_type, segment) upserts
  // deterministically — NULL is never equal to NULL under a UNIQUE constraint,
  // which would let duplicate whole-rep rows accumulate across nightly runs.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.rep_coaching_insights (
      id                    uuid DEFAULT gen_random_uuid() NOT NULL,
      rep_id                uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      metric_type           text NOT NULL,
      segment               text NOT NULL DEFAULT '',
      observation           text NOT NULL,
      recommended_action    text NOT NULL,
      rep_value             numeric(12,4) NOT NULL,
      team_average_value    numeric(12,4) NOT NULL,
      is_outlier            boolean NOT NULL DEFAULT false,
      closed_deal_count     integer NOT NULL,
      computed_at           timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rep_coaching_insights_pkey PRIMARY KEY (id),
      CONSTRAINT rep_coaching_insights_rep_metric_segment_unique UNIQUE (rep_id, metric_type, segment),
      CONSTRAINT rep_coaching_insights_closed_deal_count_check CHECK (closed_deal_count >= 0)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.rep_coaching_insights IS
      'Current cached per-rep coaching insight per metric (MINCRM-474). Upserted nightly by repCoachingService; the read path never computes live. Absence of rows for a rep means fewer than min_closed_deals closed deals. Never exposed as an NLI tool — read exclusively via the dedicated /insights/coaching and dashboard endpoints, gated by role, to protect rep privacy.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS rep_coaching_insights_rep_id_idx
      ON public.rep_coaching_insights USING btree (rep_id)
  `);

  // ── 5. rep_coaching_insight_history (append-only) ───────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.rep_coaching_insight_history (
      id                  uuid DEFAULT gen_random_uuid() NOT NULL,
      rep_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      metric_type         text NOT NULL,
      segment             text NOT NULL DEFAULT '',
      rep_value           numeric(12,4) NOT NULL,
      team_average_value  numeric(12,4) NOT NULL,
      is_outlier          boolean NOT NULL DEFAULT false,
      computed_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rep_coaching_insight_history_pkey PRIMARY KEY (id)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.rep_coaching_insight_history IS
      'Append-only per-run history of rep coaching insights (MINCRM-474), one row per rep per metric per nightly run. Reserved for a future trend view; not read by any endpoint in this ticket.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS rep_coaching_insight_history_rep_id_computed_at_idx
      ON public.rep_coaching_insight_history USING btree (rep_id, computed_at DESC)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.rep_coaching_insight_history`);
  pgm.sql(`DROP TABLE IF EXISTS public.rep_coaching_insights`);
  pgm.sql(`DROP TABLE IF EXISTS public.rep_coaching_scoring_config`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_rep_coaching_insights'`);
  pgm.sql(`DROP TABLE IF EXISTS public.deal_stage_history`);
};
