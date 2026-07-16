'use strict';

/**
 * Migration 154: AI intelligent lead routing suggestion. (MINCRM-475)
 *
 * Adds:
 *   1. ai_lead_routing_suggestion feature flag (child of the AI category).
 *   2. leads.territory / leads.industry / leads.employee_range — nullable
 *      free-text columns mirroring accounts.industry/employee_range's
 *      convention (no DB-level enum; enforced by shared Zod schema only).
 *      Needed so an unconverted lead has a comparable "profile" for the
 *      territory-alignment, industry-match, and similar-lead-profile
 *      win-rate routing factors — none of which the schema could express
 *      before this migration (leads had no industry/territory/size fields
 *      at all, and only linked to an account post-conversion).
 *   3. users.territory — nullable free-text column so reps can be assigned
 *      a territory to match against a lead's territory.
 *   4. lead_routing_decisions — one row per lead created after a routing
 *      suggestion was shown, written once at lead-creation time recording the
 *      suggested rep, confidence, contributing factors, whether the manager
 *      accepted or overrode it, and the actual assignee. Doubles as the
 *      "routing decisions are logged" audit trail the ticket's AC asks for —
 *      distinct from the generic audit_log table, mirroring how
 *      account_churn_expansion_signals is its own dedicated table rather
 *      than overloading audit_log.
 *   5. team_feature_overrides — generic (team_id, flag_key, enabled) table
 *      for "manager can disable intelligent routing per team." This is new
 *      territory: no existing per-team flag gating precedent in this
 *      codebase (only per-user overrides via feature_flag_user_overrides
 *      and per-group gates via feature_flag_groups). Kept generic (not
 *      routing-specific) so any future per-team toggle can reuse it.
 *   6. lead_routing_scoring_config — singleton admin-editable weights per
 *      routing factor plus confidence thresholds. Per ADR-002, a fixed-column
 *      table, not a jsonb blob, mirroring account_health_scoring_config
 *      (migration 151) and rep_coaching_scoring_config (migration 153).
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── 1. Feature flag ──────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_lead_routing_suggestion',
        'AI Lead Routing Suggestion',
        'Suggests which rep to assign a new lead to, based on territory, industry match, workload, and historical win rate. Advisory only — never auto-assigns.',
        'AI',
        true,
        '{"admin":true,"manager":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  // ── 2. Lead profile columns ──────────────────────────────────────────────
  pgm.sql(`ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS territory character varying(255)`);
  pgm.sql(`ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS industry character varying(255)`);
  pgm.sql(`ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS employee_range character varying(50)`);

  pgm.sql(`
    COMMENT ON COLUMN public.leads.territory IS
      'Free-text sales territory, matched against users.territory for routing suggestions (MINCRM-475). No DB-level enum, same convention as accounts.industry/employee_range.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.leads.industry IS
      'Free-text industry/vertical, matched against historical deal outcomes for routing suggestions (MINCRM-475). Independent of accounts.industry — leads have no account until conversion.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.leads.employee_range IS
      'Free-text company-size bucket, same convention as accounts.employee_range (MINCRM-475). Used alongside industry and lead_source to define a "similar lead profile" for historical win-rate comparison.'
  `);

  // ── 3. Rep territory ─────────────────────────────────────────────────────
  pgm.sql(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS territory character varying(255)`);
  pgm.sql(`
    COMMENT ON COLUMN public.users.territory IS
      'Free-text sales territory a rep is assigned to, matched against leads.territory for routing suggestions (MINCRM-475).'
  `);

  // ── 4. lead_routing_decisions ────────────────────────────────────────────
  //
  // Written once, at lead-creation time, in the same transaction as the lead
  // insert (leadRoutingService.persistRoutingDecision) — never updated after.
  // decision/actual_assignee_id/decided_at are all set at insert time, derived
  // by comparing the suggestion the manager saw (echoed back on the create
  // request) against the lead's final owner_id.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.lead_routing_decisions (
      id                  uuid DEFAULT gen_random_uuid() NOT NULL,
      lead_id             uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
      suggested_rep_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
      confidence          text NOT NULL,
      contributing_factors jsonb NOT NULL DEFAULT '[]',
      decision            text NOT NULL,
      actual_assignee_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
      decided_at          timestamptz NOT NULL,
      created_at          timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT lead_routing_decisions_pkey PRIMARY KEY (id),
      CONSTRAINT lead_routing_decisions_confidence_check CHECK (confidence IN ('high', 'medium', 'low')),
      CONSTRAINT lead_routing_decisions_decision_check CHECK (decision IN ('accepted', 'overridden'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.lead_routing_decisions IS
      'One row per lead created after a routing suggestion was shown to the manager (MINCRM-475). Written once, at lead-creation time, in the same transaction as the lead insert — never updated. Doubles as the AC-required routing decision log. Leads created without ever requesting a suggestion have no row here.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS lead_routing_decisions_lead_id_idx
      ON public.lead_routing_decisions USING btree (lead_id)
  `);

  // ── 5. team_feature_overrides ────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.team_feature_overrides (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
      flag_key   character varying(100) NOT NULL,
      enabled    boolean NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT team_feature_overrides_pkey PRIMARY KEY (id),
      CONSTRAINT team_feature_overrides_team_flag_unique UNIQUE (team_id, flag_key)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.team_feature_overrides IS
      'Per-team feature flag overrides (MINCRM-475). Generic, not routing-specific — any future per-team toggle can reuse this table. enabled=false blocks the flag for every member of the team regardless of rollout/beta/group state, but a per-user force_enabled override in feature_flag_user_overrides still wins (checked first in isFlagEnabledForUser).'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS team_feature_overrides_flag_key_idx
      ON public.team_feature_overrides USING btree (flag_key)
  `);

  // ── 6. lead_routing_scoring_config (singleton) ──────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.lead_routing_scoring_config (
      id                          boolean NOT NULL DEFAULT true,
      territory_weight            numeric(4,3) NOT NULL DEFAULT 0.250,
      industry_weight             numeric(4,3) NOT NULL DEFAULT 0.250,
      workload_weight             numeric(4,3) NOT NULL DEFAULT 0.200,
      win_rate_weight             numeric(4,3) NOT NULL DEFAULT 0.200,
      availability_weight         numeric(4,3) NOT NULL DEFAULT 0.100,
      low_confidence_threshold    numeric(4,3) NOT NULL DEFAULT 0.400,
      medium_confidence_threshold numeric(4,3) NOT NULL DEFAULT 0.650,
      min_closed_deals_for_win_rate integer NOT NULL DEFAULT 3,
      updated_at                  timestamptz NOT NULL DEFAULT now(),
      updated_by                  uuid REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT lead_routing_scoring_config_pkey PRIMARY KEY (id),
      CONSTRAINT lead_routing_scoring_config_singleton CHECK (id = true),
      CONSTRAINT lead_routing_scoring_config_weights_sum_check
        CHECK (
          territory_weight + industry_weight + workload_weight + win_rate_weight + availability_weight
          BETWEEN 0.999 AND 1.001
        ),
      CONSTRAINT lead_routing_scoring_config_threshold_order_check
        CHECK (medium_confidence_threshold > low_confidence_threshold),
      CONSTRAINT lead_routing_scoring_config_min_closed_deals_check
        CHECK (min_closed_deals_for_win_rate >= 1)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.lead_routing_scoring_config IS
      'Singleton admin-editable weights/thresholds for lead routing suggestion scoring (MINCRM-475). id is a boolean-typed singleton key (id = true) following the single-row-config convention (see account_health_scoring_config, migration 151; rep_coaching_scoring_config, migration 153).'
  `);

  pgm.sql(`
    INSERT INTO public.lead_routing_scoring_config (id) VALUES (true)
    ON CONFLICT (id) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.lead_routing_scoring_config`);
  pgm.sql(`DROP TABLE IF EXISTS public.team_feature_overrides`);
  pgm.sql(`DROP TABLE IF EXISTS public.lead_routing_decisions`);
  pgm.sql(`ALTER TABLE public.users DROP COLUMN IF EXISTS territory`);
  pgm.sql(`ALTER TABLE public.leads DROP COLUMN IF EXISTS employee_range`);
  pgm.sql(`ALTER TABLE public.leads DROP COLUMN IF EXISTS industry`);
  pgm.sql(`ALTER TABLE public.leads DROP COLUMN IF EXISTS territory`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_lead_routing_suggestion'`);
};
