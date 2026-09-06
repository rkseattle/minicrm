'use strict';

/**
 * Migration 000 — Schema baseline.
 *
 * Captures the full schema so a fresh environment skips replaying every migration.
 * Covers migrations 1–180; anything numbered above that still runs normally on top.
 *
 * Generated from `pg_dump --schema-only` against a fully migrated database, then made
 * idempotent: every CREATE TABLE/INDEX carries IF NOT EXISTS, and every type, function,
 * trigger, policy and constraint is wrapped in a DO block that swallows duplicate_object.
 * That is what lets it run as a no-op against a database that already has these objects,
 * which is how it reaches deployments that predate it.
 *
 * Do NOT run `npm run migrate` on a brand-new database — it would replay this plus every
 * later migration. Use `npm run migrate:fresh`, which runs this one and fake-marks the
 * rest. See docs/dev/migrations.md.
 *
 * `baselineCoveredMigrationCount` below and BASELINE_COVERED_MIGRATION_COUNT in
 * server/src/migrate.ts must agree; countBaselineCoveredMigrations() asserts it at every
 * boot and throws when they drift, so both change in the same commit.
 *
 * pgmigrations is excluded: node-pg-migrate creates its own ledger.
 *
 * TWO SECTIONS BELOW ARE HAND-MAINTAINED and invisible to pg_dump --schema-only, so any
 * regeneration must carry them forward or a fresh install comes up unusable:
 *   - Seed rows. --schema-only dumps no data, and the migrations that inserted these are
 *     fake-marked on a fresh bootstrap, so they never run either. Without them there is no
 *     default pipeline, no stages, no feature flags, no home currency.
 *   - The minicrm_app role and its grants. --schema-only dumps no cluster-level roles.
 *     rlsEnforcement.test.ts connects as it to evaluate policies as a non-superuser.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** How many sequential migrations this baseline already contains. */
exports.baselineCoveredMigrationCount = 180;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  pgm.sql(`CREATE SCHEMA IF NOT EXISTS public`);
  pgm.sql(`DO $do$ BEGIN
CREATE TYPE public.activity_direction AS ENUM (
    'Inbound',
    'Outbound'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TYPE public.activity_status AS ENUM (
    'open',
    'complete'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TYPE public.activity_type AS ENUM (
    'Note',
    'Call',
    'Email',
    'Meeting',
    'Task'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TYPE public.automation_action_type AS ENUM (
    'create_task',
    'send_notification'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TYPE public.automation_log_outcome AS ENUM (
    'success',
    'error'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TYPE public.automation_trigger_type AS ENUM (
    'deal_stage_changed',
    'deal_created',
    'contact_created'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE FUNCTION public.app_current_user_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
      DECLARE
        raw text;
      BEGIN
        raw := current_setting('app.current_user_id', true);
        IF raw IS NULL OR raw = '' THEN
          RETURN NULL;
        END IF;
        RETURN raw::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
      END;
      $$;
EXCEPTION WHEN duplicate_object OR duplicate_function THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE FUNCTION public.audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are not permitted';
      END;
      $$;
EXCEPTION WHEN duplicate_object OR duplicate_function THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE FUNCTION public.audit_log_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        PERFORM pg_notify(
          'audit_events',
          json_build_object(
            'id',              NEW.id,
            'record_type',     NEW.record_type,
            'record_id',       NEW.record_id,
            'record_name',     NEW.record_name,
            'event_type',      NEW.event_type,
            'field_name',      NEW.field_name,
            'old_value',       NEW.old_value,
            'new_value',       NEW.new_value,
            'changed_by_id',   NEW.changed_by_id,
            'changed_by_name', NEW.changed_by_name, 'source', NEW.source,
            'created_at',      NEW.created_at
          )::text
        );
        RETURN NEW;
      END;
      $$;
EXCEPTION WHEN duplicate_object OR duplicate_function THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE FUNCTION public.is_valid_role_overrides(overrides jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      DECLARE
        k text;
        v jsonb;
      BEGIN
        IF overrides IS NULL THEN
          RETURN TRUE;
        END IF;
        IF jsonb_typeof(overrides) <> 'object' THEN
          RETURN FALSE;
        END IF;
        FOR k, v IN SELECT key, value FROM jsonb_each(overrides) LOOP
          IF length(k) = 0 THEN
            RETURN FALSE;
          END IF;
          IF jsonb_typeof(v) <> 'boolean' THEN
            RETURN FALSE;
          END IF;
        END LOOP;
        RETURN TRUE;
      END;
    $$;
EXCEPTION WHEN duplicate_object OR duplicate_function THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        NEW.updated_at = clock_timestamp();
        RETURN NEW;
      END;
      $$;
EXCEPTION WHEN duplicate_object OR duplicate_function THEN NULL;
END $do$`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.account_churn_expansion_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    signal_type text NOT NULL,
    confidence numeric(3,2) DEFAULT 0 NOT NULL,
    contributing_factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    cleared_at timestamp with time zone,
    CONSTRAINT account_churn_expansion_signals_confidence_range CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT account_churn_expansion_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['churn_risk'::text, 'expansion'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.account_health_score_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    score numeric(5,2) NOT NULL,
    state text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_health_score_history_score_range CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric))),
    CONSTRAINT account_health_score_history_state_check CHECK ((state = ANY (ARRAY['strong'::text, 'healthy'::text, 'cooling'::text, 'at_risk'::text, 'dormant'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.account_health_scores (
    account_id uuid NOT NULL,
    score numeric(5,2) NOT NULL,
    state text NOT NULL,
    single_threaded_risk boolean DEFAULT false NOT NULL,
    contributing_factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_health_scores_score_range CHECK (((score >= (0)::numeric) AND (score <= (100)::numeric))),
    CONSTRAINT account_health_scores_state_check CHECK ((state = ANY (ARRAY['strong'::text, 'healthy'::text, 'cooling'::text, 'at_risk'::text, 'dormant'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.account_health_scoring_config (
    id boolean DEFAULT true NOT NULL,
    frequency_weight numeric(4,3) DEFAULT 0.250 NOT NULL,
    recency_weight numeric(4,3) DEFAULT 0.250 NOT NULL,
    seniority_weight numeric(4,3) DEFAULT 0.150 NOT NULL,
    sentiment_weight numeric(4,3) DEFAULT 0.200 NOT NULL,
    breadth_weight numeric(4,3) DEFAULT 0.150 NOT NULL,
    strong_threshold numeric(5,2) DEFAULT 80.00 NOT NULL,
    healthy_threshold numeric(5,2) DEFAULT 60.00 NOT NULL,
    cooling_threshold numeric(5,2) DEFAULT 40.00 NOT NULL,
    at_risk_threshold numeric(5,2) DEFAULT 20.00 NOT NULL,
    min_logged_activities integer DEFAULT 3 NOT NULL,
    recency_window_days integer DEFAULT 90 NOT NULL,
    single_threaded_window_days integer DEFAULT 90 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT account_health_scoring_config_min_activities_check CHECK ((min_logged_activities >= 1)),
    CONSTRAINT account_health_scoring_config_singleton CHECK ((id = true)),
    CONSTRAINT account_health_scoring_config_threshold_order_check CHECK (((strong_threshold > healthy_threshold) AND (healthy_threshold > cooling_threshold) AND (cooling_threshold > at_risk_threshold))),
    CONSTRAINT account_health_scoring_config_weights_sum_check CHECK (((((((frequency_weight + recency_weight) + seniority_weight) + sentiment_weight) + breadth_weight) >= 0.999) AND (((((frequency_weight + recency_weight) + seniority_weight) + sentiment_weight) + breadth_weight) <= 1.001))),
    CONSTRAINT account_health_scoring_config_windows_check CHECK (((recency_window_days >= 1) AND (single_threaded_window_days >= 1)))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.account_tags (
    account_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    industry character varying(255),
    website character varying(255),
    employee_range character varying(50),
    revenue_range character varying(50),
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    account_type character varying(20),
    parent_account_id uuid,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT accounts_account_type_check CHECK (((account_type IS NULL) OR ((account_type)::text = ANY (ARRAY[('Prospect'::character varying)::text, ('Customer'::character varying)::text, ('Partner'::character varying)::text, ('Vendor'::character varying)::text, ('Competitor'::character varying)::text, ('Other'::character varying)::text]))))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type public.activity_type NOT NULL,
    subject character varying(255) NOT NULL,
    notes text,
    due_date date,
    status public.activity_status DEFAULT 'open'::public.activity_status NOT NULL,
    contact_id uuid,
    account_id uuid,
    deal_id uuid,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    direction public.activity_direction,
    outcome text,
    is_demo boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    metadata jsonb,
    CONSTRAINT activities_has_parent CHECK (((contact_id IS NOT NULL) OR (account_id IS NOT NULL) OR (deal_id IS NOT NULL)))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.activity_meeting_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    brief_json jsonb NOT NULL,
    generated_by uuid NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.activity_objection_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    category text NOT NULL,
    classified_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activity_objection_signals_category_check CHECK ((category = ANY (ARRAY['Price'::text, 'Timing'::text, 'Competitor'::text, 'Product Fit'::text, 'Authority'::text, 'Risk'::text, 'Other'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.activity_sentiment_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    sentiment text NOT NULL,
    confidence numeric(3,2) DEFAULT 0 NOT NULL,
    flagged_inaccurate_by uuid,
    flagged_inaccurate_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activity_sentiment_scores_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_configuration (
    singleton boolean DEFAULT true NOT NULL,
    provider character varying(50) DEFAULT 'anthropic'::character varying NOT NULL,
    model character varying(100) DEFAULT 'claude-sonnet-4-20250514'::character varying NOT NULL,
    api_key_encrypted text DEFAULT ''::text NOT NULL,
    deployment_mode character varying(30) DEFAULT 'cloud_api'::character varying NOT NULL,
    base_url text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    enabled_updated_at timestamp with time zone,
    dpa_acknowledged boolean DEFAULT false NOT NULL,
    dpa_acknowledged_by uuid,
    dpa_acknowledged_at timestamp with time zone,
    dpa_acknowledged_for_provider character varying(50) DEFAULT ''::character varying NOT NULL,
    custom_dpa_url text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    api_key_key_version smallint DEFAULT 1 NOT NULL,
    ai_session_retention_days integer DEFAULT 90 NOT NULL,
    ai_input_cost_per_million_cents integer DEFAULT 300 NOT NULL,
    ai_output_cost_per_million_cents integer DEFAULT 1500 NOT NULL,
    win_loss_min_closed_deals integer DEFAULT 20 NOT NULL,
    win_loss_min_sample_size integer DEFAULT 5 NOT NULL,
    champion_blocker_deal_value_threshold numeric(15,2) DEFAULT 10000 NOT NULL,
    churn_expansion_confidence_threshold numeric(3,2) DEFAULT 0.70 NOT NULL,
    web_search_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT ai_configuration_champion_blocker_threshold_nonnegative CHECK ((champion_blocker_deal_value_threshold >= (0)::numeric)),
    CONSTRAINT ai_configuration_churn_expansion_confidence_threshold_range CHECK (((churn_expansion_confidence_threshold >= (0)::numeric) AND (churn_expansion_confidence_threshold <= (1)::numeric))),
    CONSTRAINT ai_configuration_input_cost_nonnegative CHECK ((ai_input_cost_per_million_cents >= 0)),
    CONSTRAINT ai_configuration_output_cost_nonnegative CHECK ((ai_output_cost_per_million_cents >= 0)),
    CONSTRAINT ai_configuration_session_retention_min CHECK ((ai_session_retention_days >= 30)),
    CONSTRAINT ai_configuration_singleton CHECK (singleton),
    CONSTRAINT ai_configuration_win_loss_min_closed_deals_positive CHECK ((win_loss_min_closed_deals > 0)),
    CONSTRAINT ai_configuration_win_loss_min_sample_size_positive CHECK ((win_loss_min_sample_size > 0))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_field_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(16) NOT NULL,
    field_name text NOT NULL,
    excluded boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_field_exclusions_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('contact'::character varying)::text, ('account'::character varying)::text, ('deal'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_gdpr_cascade_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    triggered_by uuid,
    messages_redacted integer DEFAULT 0 NOT NULL,
    context_entries_removed integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    error_detail text,
    original_name text,
    original_email text,
    record_type character varying(20) DEFAULT 'contact'::character varying NOT NULL,
    record_id uuid NOT NULL,
    CONSTRAINT ai_gdpr_cascade_log_record_type_check CHECK (((record_type)::text = ANY (ARRAY[('contact'::character varying)::text, ('lead'::character varying)::text]))),
    CONSTRAINT ai_gdpr_cascade_log_status_check CHECK (((status)::text = ANY (ARRAY[('completed'::character varying)::text, ('failed'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tool_results jsonb,
    pending_action jsonb,
    context_proposal jsonb,
    CONSTRAINT ai_messages_role_check CHECK (((role)::text = ANY (ARRAY[('user'::character varying)::text, ('assistant'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_token_budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    monthly_limit bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_token_usage (
    user_id uuid NOT NULL,
    year_month character(7) NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.ai_token_usage_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    usage_date date NOT NULL,
    feature text DEFAULT 'nli_chat'::text NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_type text NOT NULL,
    record_id uuid NOT NULL,
    filename text NOT NULL,
    file_size bigint NOT NULL,
    mime_type text NOT NULL,
    storage_key text NOT NULL,
    uploader_id uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attachments_record_type_check CHECK ((record_type = ANY (ARRAY['contact'::text, 'account'::text, 'deal'::text, 'lead'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_type text NOT NULL,
    record_id uuid,
    record_name text,
    event_type text NOT NULL,
    field_name text,
    old_value text,
    new_value text,
    changed_by_id uuid,
    changed_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(20) DEFAULT NULL::character varying,
    CONSTRAINT audit_log_source_check CHECK (((source)::text = ANY (ARRAY[('AI (NLI)'::character varying)::text, ('AI (context)'::character varying)::text])))
)
PARTITION BY RANGE (created_at)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.automation_rule_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid NOT NULL,
    triggered_at timestamp with time zone DEFAULT now() NOT NULL,
    triggering_record_type character varying(50) NOT NULL,
    triggering_record_id uuid NOT NULL,
    outcome public.automation_log_outcome NOT NULL,
    error_message text,
    action_config_snapshot jsonb
)
WITH (autovacuum_vacuum_scale_factor='0.05')`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.automation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    trigger_type public.automation_trigger_type NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_type public.automation_action_type NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.connected_account_oauth_states (
    state text NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(16) NOT NULL,
    pkce_verifier text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT connected_account_oauth_states_provider_check CHECK (((provider)::text = ANY (ARRAY[('google'::character varying)::text, ('microsoft'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.connected_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(16) NOT NULL,
    email_address text NOT NULL,
    auth_encrypted text NOT NULL,
    granted_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    status_detail text,
    last_sync_at timestamp with time zone,
    sync_cursor text,
    key_version smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_failure_count integer DEFAULT 0 NOT NULL,
    sync_next_attempt_at timestamp with time zone,
    CONSTRAINT connected_accounts_provider_check CHECK (((provider)::text = ANY (ARRAY[('google'::character varying)::text, ('microsoft'::character varying)::text, ('imap'::character varying)::text]))),
    CONSTRAINT connected_accounts_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('error'::character varying)::text, ('disconnected'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.contact_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    label character varying(50),
    address_line1 character varying(255),
    address_line2 character varying(255),
    city character varying(100),
    state_region character varying(100),
    postal_code character varying(20),
    country character varying(100),
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.contact_champion_blocker_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'neutral'::text NOT NULL,
    confidence numeric(3,2) DEFAULT 0 NOT NULL,
    contributing_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_activity_id uuid,
    override_status text,
    override_reason text,
    overridden_by uuid,
    overridden_at timestamp with time zone,
    dismissed_by uuid,
    dismissed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_champion_blocker_signals_override_status_check CHECK (((override_status IS NULL) OR (override_status = ANY (ARRAY['champion'::text, 'likely_champion'::text, 'neutral'::text, 'likely_blocker'::text, 'blocker'::text])))),
    CONSTRAINT contact_champion_blocker_signals_status_check CHECK ((status = ANY (ARRAY['champion'::text, 'likely_champion'::text, 'neutral'::text, 'likely_blocker'::text, 'blocker'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.contact_followup_timing_suggestions (
    contact_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    hour_start_utc smallint NOT NULL,
    hour_end_utc smallint NOT NULL,
    sample_size integer NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_followup_timing_suggestions_day_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT contact_followup_timing_suggestions_hour_end_check CHECK (((hour_end_utc >= 1) AND (hour_end_utc <= 24))),
    CONSTRAINT contact_followup_timing_suggestions_hour_order_check CHECK ((hour_end_utc > hour_start_utc)),
    CONSTRAINT contact_followup_timing_suggestions_hour_start_check CHECK (((hour_start_utc >= 0) AND (hour_start_utc <= 23))),
    CONSTRAINT contact_followup_timing_suggestions_sample_size_check CHECK ((sample_size >= 5))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.contact_tags (
    contact_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50),
    title character varying(255),
    department character varying(255),
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id uuid,
    is_demo boolean DEFAULT false NOT NULL,
    source_lead_id uuid,
    linkedin_url character varying(500),
    twitter_x_url character varying(500),
    other_url character varying(500),
    version integer DEFAULT 1 NOT NULL,
    title_updated_at timestamp with time zone
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.currencies (
    code character varying(3) NOT NULL,
    name character varying(64) NOT NULL,
    symbol character varying(8) NOT NULL,
    rate_to_home numeric(18,6) NOT NULL,
    is_home boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT currencies_rate_to_home_positive CHECK ((rate_to_home > (0)::numeric))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.currency_rate_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(3) NOT NULL,
    rate_to_home numeric(18,6) NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT currency_rate_history_rate_positive CHECK ((rate_to_home > (0)::numeric))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(16) NOT NULL,
    name character varying(100) NOT NULL,
    field_type character varying(16) NOT NULL,
    options jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pii_excluded boolean DEFAULT false NOT NULL,
    CONSTRAINT custom_field_definitions_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('contact'::character varying)::text, ('account'::character varying)::text, ('deal'::character varying)::text]))),
    CONSTRAINT custom_field_definitions_field_type_check CHECK (((field_type)::text = ANY (ARRAY[('text'::character varying)::text, ('number'::character varying)::text, ('date'::character varying)::text, ('boolean'::character varying)::text, ('select'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.custom_field_values (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    definition_id uuid NOT NULL,
    record_id uuid NOT NULL,
    value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.custom_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    entity_type character varying(16) NOT NULL,
    config jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visibility character varying(16) DEFAULT 'public'::character varying NOT NULL,
    CONSTRAINT custom_reports_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('contact'::character varying)::text, ('account'::character varying)::text, ('deal'::character varying)::text, ('lead'::character varying)::text, ('activity'::character varying)::text]))),
    CONSTRAINT custom_reports_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('private'::character varying)::text, ('public_read_only'::character varying)::text, ('public'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.custom_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_builtin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.data_hygiene_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    issue_type text NOT NULL,
    related_entity_id uuid,
    owner_id uuid NOT NULL,
    last_activity_at timestamp with time zone,
    suggested_action text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    dismissed_until timestamp with time zone,
    dismissed_reason text,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_hygiene_findings_entity_type_check CHECK ((entity_type = ANY (ARRAY['contact'::text, 'account'::text, 'opportunity'::text]))),
    CONSTRAINT data_hygiene_findings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'dismissed'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.data_hygiene_scoring_config (
    id boolean DEFAULT true NOT NULL,
    contact_inactivity_days integer DEFAULT 365 NOT NULL,
    account_inactivity_days integer DEFAULT 365 NOT NULL,
    title_staleness_days integer DEFAULT 1095 NOT NULL,
    opportunity_inactivity_days integer DEFAULT 30 NOT NULL,
    dismiss_suppression_days integer DEFAULT 90 NOT NULL,
    weekly_digest_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT data_hygiene_scoring_config_account_inactivity_check CHECK ((account_inactivity_days >= 1)),
    CONSTRAINT data_hygiene_scoring_config_contact_inactivity_check CHECK ((contact_inactivity_days >= 1)),
    CONSTRAINT data_hygiene_scoring_config_dismiss_suppression_check CHECK ((dismiss_suppression_days >= 1)),
    CONSTRAINT data_hygiene_scoring_config_opportunity_inactivity_check CHECK ((opportunity_inactivity_days >= 1)),
    CONSTRAINT data_hygiene_scoring_config_singleton CHECK ((id = true)),
    CONSTRAINT data_hygiene_scoring_config_title_staleness_check CHECK ((title_staleness_days >= 1))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.deal_contacts (
    deal_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.deal_stage_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    stage text NOT NULL,
    entered_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.deal_tags (
    deal_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.deal_win_loss_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_type text NOT NULL,
    observation text NOT NULL,
    win_rate_with numeric(5,2) NOT NULL,
    win_rate_without numeric(5,2) NOT NULL,
    sample_size integer NOT NULL,
    is_win_pattern boolean NOT NULL,
    supporting_deal_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deal_win_loss_insights_sample_size_positive CHECK ((sample_size >= 0))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    stage character varying(50) NOT NULL,
    value numeric(15,2),
    close_date date,
    loss_reason text,
    account_id uuid,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    source_lead_id uuid,
    probability integer,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    pipeline_id uuid NOT NULL,
    pipeline_stage_id uuid NOT NULL,
    CONSTRAINT deals_probability_check CHECK (((probability IS NULL) OR ((probability >= 0) AND (probability <= 100))))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.email_message_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_message_id uuid NOT NULL,
    record_type character varying(16) NOT NULL,
    record_id uuid NOT NULL,
    match_type character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_message_links_match_type_check CHECK (((match_type)::text = ANY (ARRAY[('auto'::character varying)::text, ('manual'::character varying)::text]))),
    CONSTRAINT email_message_links_record_type_check CHECK (((record_type)::text = ANY (ARRAY[('contact'::character varying)::text, ('lead'::character varying)::text, ('account'::character varying)::text, ('deal'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.email_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connected_account_id uuid NOT NULL,
    provider_message_id text NOT NULL,
    thread_id text NOT NULL,
    direction character varying(16) NOT NULL,
    from_address text NOT NULL,
    to_addresses text[] DEFAULT '{}'::text[] NOT NULL,
    cc_addresses text[] DEFAULT '{}'::text[] NOT NULL,
    subject text,
    has_attachments boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone,
    is_private boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    message_body_text text,
    message_body_html text,
    message_snippet text,
    CONSTRAINT email_messages_direction_check CHECK (((direction)::text = ANY (ARRAY[('inbound'::character varying)::text, ('outbound'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.email_sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    connected_account_id uuid NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    messages_synced integer DEFAULT 0 NOT NULL,
    error text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_sync_jobs_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('running'::character varying)::text, ('complete'::character varying)::text, ('failed'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    subject character varying(500) NOT NULL,
    body text NOT NULL,
    merge_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.feature_flag_beta_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flag_key character varying(100) NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.feature_flag_group_beta_users (
    group_key character varying(100) NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.feature_flag_groups (
    group_key character varying(100) NOT NULL,
    label character varying(100) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    enable_at timestamp with time zone,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.feature_flag_usage (
    flag_key character varying(100) NOT NULL,
    user_id uuid NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.feature_flag_user_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flag_key character varying(100) NOT NULL,
    user_id uuid NOT NULL,
    override character varying(20) NOT NULL,
    reason text,
    added_by uuid,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feature_flag_user_overrides_override_check CHECK (((override)::text = ANY (ARRAY[('force_enabled'::character varying)::text, ('force_disabled'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.feature_flags (
    flag_key character varying(100) NOT NULL,
    label character varying(100) NOT NULL,
    description text NOT NULL,
    category character varying(50) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    role_overrides jsonb,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    system_flag boolean DEFAULT true NOT NULL,
    enable_at timestamp with time zone,
    rollout_percentage smallint,
    rollout_stages jsonb,
    group_key character varying(100),
    CONSTRAINT feature_flags_role_overrides_valid_shape CHECK (public.is_valid_role_overrides(role_overrides)),
    CONSTRAINT feature_flags_rollout_percentage_range CHECK (((rollout_percentage >= 0) AND (rollout_percentage <= 100)))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.gdpr_deletion_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_type text NOT NULL,
    record_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    erasure_scope text[] NOT NULL,
    notes text
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(16) NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    total_rows integer,
    processed_rows integer DEFAULT 0 NOT NULL,
    created_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    error_csv text,
    created_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.lead_routing_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    suggested_rep_id uuid,
    confidence text NOT NULL,
    contributing_factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    decision text NOT NULL,
    actual_assignee_id uuid NOT NULL,
    decided_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lead_routing_decisions_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT lead_routing_decisions_decision_check CHECK ((decision = ANY (ARRAY['accepted'::text, 'overridden'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.lead_routing_scoring_config (
    id boolean DEFAULT true NOT NULL,
    territory_weight numeric(4,3) DEFAULT 0.250 NOT NULL,
    industry_weight numeric(4,3) DEFAULT 0.250 NOT NULL,
    workload_weight numeric(4,3) DEFAULT 0.200 NOT NULL,
    win_rate_weight numeric(4,3) DEFAULT 0.200 NOT NULL,
    availability_weight numeric(4,3) DEFAULT 0.100 NOT NULL,
    low_confidence_threshold numeric(4,3) DEFAULT 0.400 NOT NULL,
    medium_confidence_threshold numeric(4,3) DEFAULT 0.650 NOT NULL,
    min_closed_deals_for_win_rate integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT lead_routing_scoring_config_min_closed_deals_check CHECK ((min_closed_deals_for_win_rate >= 1)),
    CONSTRAINT lead_routing_scoring_config_singleton CHECK ((id = true)),
    CONSTRAINT lead_routing_scoring_config_threshold_order_check CHECK ((medium_confidence_threshold > low_confidence_threshold)),
    CONSTRAINT lead_routing_scoring_config_weights_sum_check CHECK (((((((territory_weight + industry_weight) + workload_weight) + win_rate_weight) + availability_weight) >= 0.999) AND (((((territory_weight + industry_weight) + workload_weight) + win_rate_weight) + availability_weight) <= 1.001)))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.lead_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by_id uuid,
    changed_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.lead_tags (
    lead_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text NOT NULL,
    last_name text,
    email text NOT NULL,
    phone text,
    company_name text,
    lead_source text,
    status text DEFAULT 'New'::text NOT NULL,
    disqualification_reason text,
    notes text,
    owner_id uuid NOT NULL,
    converted_at timestamp with time zone,
    converted_contact_id uuid,
    converted_account_id uuid,
    converted_deal_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    territory character varying(255),
    industry character varying(255),
    employee_range character varying(50),
    CONSTRAINT leads_lead_source_check CHECK ((lead_source = ANY (ARRAY['Web'::text, 'Referral'::text, 'Trade Show'::text, 'Cold Outreach'::text, 'Other'::text]))),
    CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['New'::text, 'Contacted'::text, 'Qualified'::text, 'Disqualified'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.note_tags (
    note_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(16) NOT NULL,
    entity_id uuid NOT NULL,
    title character varying(255),
    body text NOT NULL,
    body_text text,
    visibility character varying(8) DEFAULT 'team'::character varying NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT notes_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('contact'::character varying)::text, ('account'::character varying)::text, ('deal'::character varying)::text, ('lead'::character varying)::text]))),
    CONSTRAINT notes_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('private'::character varying)::text, ('team'::character varying)::text, ('public'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link_path text,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.org_visibility_settings (
    object_type text NOT NULL,
    policy text DEFAULT 'org'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT org_visibility_settings_object_type_check CHECK ((object_type = ANY (ARRAY['contact'::text, 'deal'::text, 'activity'::text, 'account'::text]))),
    CONSTRAINT org_visibility_settings_policy_check CHECK ((policy = ANY (ARRAY['private'::text, 'team'::text, 'org'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.overdue_task_notifications (
    activity_id uuid NOT NULL,
    notified_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    sort_order integer NOT NULL,
    probability integer DEFAULT 0 NOT NULL,
    is_terminal boolean DEFAULT false NOT NULL,
    is_fixed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pipeline_id uuid,
    stage_exit_requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT pipeline_stages_probability_check CHECK (((probability >= 0) AND (probability <= 100)))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.rep_coaching_insight_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rep_id uuid NOT NULL,
    metric_type text NOT NULL,
    segment text DEFAULT ''::text NOT NULL,
    rep_value numeric(12,4) NOT NULL,
    team_average_value numeric(12,4) NOT NULL,
    is_outlier boolean DEFAULT false NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.rep_coaching_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rep_id uuid NOT NULL,
    metric_type text NOT NULL,
    segment text DEFAULT ''::text NOT NULL,
    observation text NOT NULL,
    recommended_action text NOT NULL,
    rep_value numeric(12,4) NOT NULL,
    team_average_value numeric(12,4) NOT NULL,
    is_outlier boolean DEFAULT false NOT NULL,
    closed_deal_count integer NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rep_coaching_insights_closed_deal_count_check CHECK ((closed_deal_count >= 0))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.rep_coaching_scoring_config (
    id boolean DEFAULT true NOT NULL,
    min_closed_deals integer DEFAULT 10 NOT NULL,
    stage_time_outlier_ratio numeric(4,2) DEFAULT 1.50 NOT NULL,
    activity_frequency_outlier_ratio numeric(4,2) DEFAULT 0.50 NOT NULL,
    response_time_outlier_hours integer DEFAULT 48 NOT NULL,
    win_rate_outlier_delta numeric(4,3) DEFAULT 0.150 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT rep_coaching_scoring_config_activity_ratio_check CHECK (((activity_frequency_outlier_ratio > (0)::numeric) AND (activity_frequency_outlier_ratio < (1)::numeric))),
    CONSTRAINT rep_coaching_scoring_config_min_closed_deals_check CHECK ((min_closed_deals >= 1)),
    CONSTRAINT rep_coaching_scoring_config_response_hours_check CHECK ((response_time_outlier_hours >= 1)),
    CONSTRAINT rep_coaching_scoring_config_singleton CHECK ((id = true)),
    CONSTRAINT rep_coaching_scoring_config_stage_ratio_check CHECK ((stage_time_outlier_ratio > (1)::numeric)),
    CONSTRAINT rep_coaching_scoring_config_win_rate_delta_check CHECK (((win_rate_outlier_delta > (0)::numeric) AND (win_rate_outlier_delta < (1)::numeric)))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.role_capabilities (
    role_id uuid NOT NULL,
    capability text NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.sales_sequence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    sort_order integer NOT NULL,
    action_type character varying(32) NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    delay_days integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_sequence_steps_action_type_check CHECK (((action_type)::text = ANY (ARRAY[('send_email'::character varying)::text, ('log_call_reminder'::character varying)::text, ('create_task'::character varying)::text]))),
    CONSTRAINT sales_sequence_steps_delay_days_check CHECK ((delay_days >= 0))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.sales_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.scim_group_role_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scim_group_id text NOT NULL,
    group_name text NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.scim_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.sequence_enrollment_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    step_id uuid,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    action_type character varying(32) NOT NULL,
    outcome character varying(8) NOT NULL,
    error_message text,
    CONSTRAINT sequence_enrollment_logs_outcome_check CHECK (((outcome)::text = ANY (ARRAY[('success'::character varying)::text, ('skipped'::character varying)::text, ('error'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    enrolled_by_id uuid,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(16) DEFAULT '''active'''::character varying NOT NULL,
    current_step_id uuid,
    next_action_at timestamp with time zone,
    unenrolled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sequence_enrollments_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('completed'::character varying)::text, ('unenrolled'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.smtp_configuration (
    singleton boolean DEFAULT true NOT NULL,
    host character varying(255) DEFAULT ''::character varying NOT NULL,
    port integer DEFAULT 587 NOT NULL,
    username character varying(255) DEFAULT ''::character varying NOT NULL,
    pass_encrypted text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pass_key_version smallint DEFAULT 1 NOT NULL,
    CONSTRAINT smtp_configuration_singleton CHECK (singleton)
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.system_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.team_feature_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    flag_key character varying(100) NOT NULL,
    enabled boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.team_memberships (
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    CONSTRAINT team_memberships_role_check CHECK ((role = ANY (ARRAY['lead'::text, 'member'::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    manager_id uuid,
    parent_team_id uuid,
    scim_group_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.user_ai_context (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    key character varying(100) NOT NULL,
    value character varying(500) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.user_custom_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text,
    name character varying(255) NOT NULL,
    role character varying(20) DEFAULT '''rep'''::character varying NOT NULL,
    status character varying(10) DEFAULT '''active'''::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    must_change_password boolean DEFAULT false NOT NULL,
    preferred_language character varying(10) DEFAULT NULL::character varying,
    password_reset_token_hash character varying(64) DEFAULT NULL::character varying,
    password_reset_expires_at timestamp with time zone,
    password_changed_at timestamp with time zone,
    notify_overdue_tasks boolean DEFAULT true NOT NULL,
    notify_assignments boolean DEFAULT true NOT NULL,
    notify_deal_stage_changes boolean DEFAULT true NOT NULL,
    mfa_enabled boolean DEFAULT false NOT NULL,
    mfa_secret text,
    mfa_pending_secret text,
    mfa_recovery_codes text[] DEFAULT '{}'::text[] NOT NULL,
    onboarding_completed boolean DEFAULT false NOT NULL,
    onboarding_completed_at timestamp with time zone,
    sso_provider character varying(20) DEFAULT NULL::character varying,
    sso_subject text,
    api_token_hash text,
    api_token_issued_at timestamp with time zone,
    scim_external_id text,
    territory character varying(255),
    nav_layout character varying(20) DEFAULT NULL::character varying,
    CONSTRAINT users_nav_layout_check CHECK (((nav_layout IS NULL) OR ((nav_layout)::text = ANY (ARRAY[('top'::character varying)::text, ('left'::character varying)::text, ('hamburger'::character varying)::text])))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('rep'::character varying)::text, ('manager'::character varying)::text, ('viewer'::character varying)::text, ('service_account'::character varying)::text]))),
    CONSTRAINT users_sso_provider_requires_subject CHECK (((sso_provider IS NULL) OR (sso_subject IS NOT NULL))),
    CONSTRAINT users_sso_subject_max_length CHECK (((sso_subject IS NULL) OR (length(sso_subject) <= 1024))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('invited'::character varying)::text, ('inactive'::character varying)::text])))
)`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.webhook_delivery_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid,
    event_id uuid NOT NULL,
    event_type character varying(64) NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    status_code integer,
    response_ms integer,
    error text,
    delivered_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.05')`);
  pgm.sql(`CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url text NOT NULL,
    events text[] NOT NULL,
    secret_hash text NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_subscriptions_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('failed'::character varying)::text, ('disabled'::character varying)::text])))
)`);
  // audit_log partitions — default plus the seeded calendar months.
  // auditPartitionService.ensureAuditLogPartitions() creates later ones at runtime.
  // PARTITION OF rather than CREATE + ATTACH: the attach form restates the parent's
  // CHECK in a different but equivalent rendering, which raises 42804 on re-run.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_default
      PARTITION OF public.audit_log DEFAULT
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m06
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00')
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m07
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00')
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m08
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00')
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m09
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00')
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m10
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00')
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m11
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00')
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log_y2026m12
      PARTITION OF public.audit_log
      FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00')
  `);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.accounts FORCE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activities FORCE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contacts FORCE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals FORCE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.leads FORCE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_default DEFAULT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m06 FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m07 FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m08 FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m09 FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m10 FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m11 FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log ATTACH PARTITION public.audit_log_y2026m12 FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_churn_expansion_signals
    ADD CONSTRAINT account_churn_expansion_signals_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_health_score_history
    ADD CONSTRAINT account_health_score_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_health_scores
    ADD CONSTRAINT account_health_scores_pkey PRIMARY KEY (account_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_health_scoring_config
    ADD CONSTRAINT account_health_scoring_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_tags
    ADD CONSTRAINT account_tags_pkey PRIMARY KEY (account_id, tag_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_meeting_briefs
    ADD CONSTRAINT activity_meeting_briefs_activity_id_unique UNIQUE (activity_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_meeting_briefs
    ADD CONSTRAINT activity_meeting_briefs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_objection_signals
    ADD CONSTRAINT activity_objection_signals_activity_id_unique UNIQUE (activity_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_objection_signals
    ADD CONSTRAINT activity_objection_signals_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_sentiment_scores
    ADD CONSTRAINT activity_sentiment_scores_activity_id_unique UNIQUE (activity_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_sentiment_scores
    ADD CONSTRAINT activity_sentiment_scores_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_configuration
    ADD CONSTRAINT ai_configuration_singleton_unique UNIQUE (singleton);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_field_exclusions
    ADD CONSTRAINT ai_field_exclusions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_gdpr_cascade_log
    ADD CONSTRAINT ai_gdpr_cascade_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_sessions
    ADD CONSTRAINT ai_sessions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_token_budgets
    ADD CONSTRAINT ai_token_budgets_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_token_usage_daily
    ADD CONSTRAINT ai_token_usage_daily_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_token_usage
    ADD CONSTRAINT ai_token_usage_pkey PRIMARY KEY (user_id, year_month);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_storage_key_key UNIQUE (storage_key);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_default
    ADD CONSTRAINT audit_log_default_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m06
    ADD CONSTRAINT audit_log_y2026m06_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m07
    ADD CONSTRAINT audit_log_y2026m07_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m08
    ADD CONSTRAINT audit_log_y2026m08_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m09
    ADD CONSTRAINT audit_log_y2026m09_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m10
    ADD CONSTRAINT audit_log_y2026m10_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m11
    ADD CONSTRAINT audit_log_y2026m11_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.audit_log_y2026m12
    ADD CONSTRAINT audit_log_y2026m12_pkey PRIMARY KEY (id, created_at);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.automation_rule_logs
    ADD CONSTRAINT automation_rule_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.connected_account_oauth_states
    ADD CONSTRAINT connected_account_oauth_states_pkey PRIMARY KEY (state);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.connected_accounts
    ADD CONSTRAINT connected_accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.connected_accounts
    ADD CONSTRAINT connected_accounts_user_provider_email_unique UNIQUE (user_id, provider, email_address);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_addresses
    ADD CONSTRAINT contact_addresses_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_champion_blocker_signals
    ADD CONSTRAINT contact_champion_blocker_signals_contact_id_unique UNIQUE (contact_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_champion_blocker_signals
    ADD CONSTRAINT contact_champion_blocker_signals_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_followup_timing_suggestions
    ADD CONSTRAINT contact_followup_timing_suggestions_pkey PRIMARY KEY (contact_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_pkey PRIMARY KEY (contact_id, tag_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (code);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.currency_rate_history
    ADD CONSTRAINT currency_rate_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_entity_type_name_key UNIQUE (entity_type, name);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_field_definitions
    ADD CONSTRAINT custom_field_definitions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_definition_id_record_id_key UNIQUE (definition_id, record_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_reports
    ADD CONSTRAINT custom_reports_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_reports
    ADD CONSTRAINT custom_reports_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_roles
    ADD CONSTRAINT custom_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.data_hygiene_findings
    ADD CONSTRAINT data_hygiene_findings_entity_issue_unique UNIQUE (entity_type, entity_id, issue_type);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.data_hygiene_findings
    ADD CONSTRAINT data_hygiene_findings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.data_hygiene_scoring_config
    ADD CONSTRAINT data_hygiene_scoring_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_pkey PRIMARY KEY (deal_id, contact_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_stage_history
    ADD CONSTRAINT deal_stage_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_tags
    ADD CONSTRAINT deal_tags_pkey PRIMARY KEY (deal_id, tag_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_win_loss_insights
    ADD CONSTRAINT deal_win_loss_insights_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_message_links
    ADD CONSTRAINT email_message_links_message_record_unique UNIQUE (email_message_id, record_type, record_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_message_links
    ADD CONSTRAINT email_message_links_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_account_provider_id_unique UNIQUE (connected_account_id, provider_message_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_sync_jobs
    ADD CONSTRAINT email_sync_jobs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_beta_users
    ADD CONSTRAINT feature_flag_beta_users_flag_key_user_id_unique UNIQUE (flag_key, user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_beta_users
    ADD CONSTRAINT feature_flag_beta_users_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_group_beta_users
    ADD CONSTRAINT feature_flag_group_beta_users_pkey PRIMARY KEY (group_key, user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_groups
    ADD CONSTRAINT feature_flag_groups_pkey PRIMARY KEY (group_key);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_user_overrides
    ADD CONSTRAINT feature_flag_user_overrides_flag_key_user_id_unique UNIQUE (flag_key, user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_user_overrides
    ADD CONSTRAINT feature_flag_user_overrides_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (flag_key);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.gdpr_deletion_log
    ADD CONSTRAINT gdpr_deletion_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_routing_decisions
    ADD CONSTRAINT lead_routing_decisions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_routing_scoring_config
    ADD CONSTRAINT lead_routing_scoring_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_status_history
    ADD CONSTRAINT lead_status_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_pkey PRIMARY KEY (lead_id, tag_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_pkey PRIMARY KEY (note_id, tag_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.org_visibility_settings
    ADD CONSTRAINT org_visibility_settings_pkey PRIMARY KEY (object_type);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.overdue_task_notifications
    ADD CONSTRAINT overdue_task_notifications_pkey PRIMARY KEY (activity_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_usage
    ADD CONSTRAINT pk_feature_flag_usage PRIMARY KEY (flag_key, user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_insight_history
    ADD CONSTRAINT rep_coaching_insight_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_insights
    ADD CONSTRAINT rep_coaching_insights_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_insights
    ADD CONSTRAINT rep_coaching_insights_rep_metric_segment_unique UNIQUE (rep_id, metric_type, segment);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_scoring_config
    ADD CONSTRAINT rep_coaching_scoring_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_pkey PRIMARY KEY (role_id, capability);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sales_sequence_steps
    ADD CONSTRAINT sales_sequence_steps_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sales_sequences
    ADD CONSTRAINT sales_sequences_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.scim_group_role_mappings
    ADD CONSTRAINT scim_group_role_mappings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.scim_group_role_mappings
    ADD CONSTRAINT scim_group_role_mappings_scim_group_id_key UNIQUE (scim_group_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.scim_tokens
    ADD CONSTRAINT scim_tokens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.scim_tokens
    ADD CONSTRAINT scim_tokens_token_hash_key UNIQUE (token_hash);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollment_logs
    ADD CONSTRAINT sequence_enrollment_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.smtp_configuration
    ADD CONSTRAINT smtp_configuration_singleton_unique UNIQUE (singleton);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_feature_overrides
    ADD CONSTRAINT team_feature_overrides_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_feature_overrides
    ADD CONSTRAINT team_feature_overrides_team_flag_unique UNIQUE (team_id, flag_key);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_memberships
    ADD CONSTRAINT team_memberships_pkey PRIMARY KEY (team_id, user_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_scim_group_id_key UNIQUE (scim_group_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sales_sequence_steps
    ADD CONSTRAINT uq_sequence_sort_order UNIQUE (sequence_id, sort_order);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.user_ai_context
    ADD CONSTRAINT user_ai_context_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.user_ai_context
    ADD CONSTRAINT user_ai_context_user_id_key_unique UNIQUE (user_id, key);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_pkey PRIMARY KEY (user_id, role_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_scim_external_id_key UNIQUE (scim_external_id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.webhook_delivery_logs
    ADD CONSTRAINT webhook_delivery_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.webhook_subscriptions
    ADD CONSTRAINT webhook_subscriptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_churn_expansion_signals
    ADD CONSTRAINT account_churn_expansion_signals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_health_score_history
    ADD CONSTRAINT account_health_score_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_health_scores
    ADD CONSTRAINT account_health_scores_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_health_scoring_config
    ADD CONSTRAINT account_health_scoring_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_tags
    ADD CONSTRAINT account_tags_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.account_tags
    ADD CONSTRAINT account_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_meeting_briefs
    ADD CONSTRAINT activity_meeting_briefs_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_meeting_briefs
    ADD CONSTRAINT activity_meeting_briefs_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_objection_signals
    ADD CONSTRAINT activity_objection_signals_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_sentiment_scores
    ADD CONSTRAINT activity_sentiment_scores_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.activity_sentiment_scores
    ADD CONSTRAINT activity_sentiment_scores_flagged_inaccurate_by_fkey FOREIGN KEY (flagged_inaccurate_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_configuration
    ADD CONSTRAINT ai_configuration_dpa_acknowledged_by_fkey FOREIGN KEY (dpa_acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_configuration
    ADD CONSTRAINT ai_configuration_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_gdpr_cascade_log
    ADD CONSTRAINT ai_gdpr_cascade_log_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_sessions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_sessions
    ADD CONSTRAINT ai_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_token_budgets
    ADD CONSTRAINT ai_token_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_token_usage_daily
    ADD CONSTRAINT ai_token_usage_daily_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.ai_token_usage
    ADD CONSTRAINT ai_token_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.automation_rule_logs
    ADD CONSTRAINT automation_rule_logs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.connected_account_oauth_states
    ADD CONSTRAINT connected_account_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.connected_accounts
    ADD CONSTRAINT connected_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_addresses
    ADD CONSTRAINT contact_addresses_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_champion_blocker_signals
    ADD CONSTRAINT contact_champion_blocker_signals_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_champion_blocker_signals
    ADD CONSTRAINT contact_champion_blocker_signals_dismissed_by_fkey FOREIGN KEY (dismissed_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_champion_blocker_signals
    ADD CONSTRAINT contact_champion_blocker_signals_last_activity_id_fkey FOREIGN KEY (last_activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_champion_blocker_signals
    ADD CONSTRAINT contact_champion_blocker_signals_overridden_by_fkey FOREIGN KEY (overridden_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_followup_timing_suggestions
    ADD CONSTRAINT contact_followup_timing_suggestions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_field_values
    ADD CONSTRAINT custom_field_values_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.custom_reports
    ADD CONSTRAINT custom_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.data_hygiene_findings
    ADD CONSTRAINT data_hygiene_findings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.data_hygiene_scoring_config
    ADD CONSTRAINT data_hygiene_scoring_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_stage_history
    ADD CONSTRAINT deal_stage_history_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_stage_history
    ADD CONSTRAINT deal_stage_history_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_tags
    ADD CONSTRAINT deal_tags_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deal_tags
    ADD CONSTRAINT deal_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_message_links
    ADD CONSTRAINT email_message_links_email_message_id_fkey FOREIGN KEY (email_message_id) REFERENCES public.email_messages(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_connected_account_id_fkey FOREIGN KEY (connected_account_id) REFERENCES public.connected_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_sync_jobs
    ADD CONSTRAINT email_sync_jobs_connected_account_id_fkey FOREIGN KEY (connected_account_id) REFERENCES public.connected_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_beta_users
    ADD CONSTRAINT feature_flag_beta_users_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_beta_users
    ADD CONSTRAINT feature_flag_beta_users_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES public.feature_flags(flag_key) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_beta_users
    ADD CONSTRAINT feature_flag_beta_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_group_beta_users
    ADD CONSTRAINT feature_flag_group_beta_users_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_group_beta_users
    ADD CONSTRAINT feature_flag_group_beta_users_group_key_fkey FOREIGN KEY (group_key) REFERENCES public.feature_flag_groups(group_key) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_group_beta_users
    ADD CONSTRAINT feature_flag_group_beta_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_groups
    ADD CONSTRAINT feature_flag_groups_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_usage
    ADD CONSTRAINT feature_flag_usage_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES public.feature_flags(flag_key) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_usage
    ADD CONSTRAINT feature_flag_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_user_overrides
    ADD CONSTRAINT feature_flag_user_overrides_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_user_overrides
    ADD CONSTRAINT feature_flag_user_overrides_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES public.feature_flags(flag_key) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flag_user_overrides
    ADD CONSTRAINT feature_flag_user_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_group_key_fkey FOREIGN KEY (group_key) REFERENCES public.feature_flag_groups(group_key) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.gdpr_deletion_log
    ADD CONSTRAINT gdpr_deletion_log_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.import_jobs
    ADD CONSTRAINT import_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_routing_decisions
    ADD CONSTRAINT lead_routing_decisions_actual_assignee_id_fkey FOREIGN KEY (actual_assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_routing_decisions
    ADD CONSTRAINT lead_routing_decisions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_routing_decisions
    ADD CONSTRAINT lead_routing_decisions_suggested_rep_id_fkey FOREIGN KEY (suggested_rep_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_routing_scoring_config
    ADD CONSTRAINT lead_routing_scoring_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_status_history
    ADD CONSTRAINT lead_status_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_account_id_fkey FOREIGN KEY (converted_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_contact_id_fkey FOREIGN KEY (converted_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_deal_id_fkey FOREIGN KEY (converted_deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.note_tags
    ADD CONSTRAINT note_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.org_visibility_settings
    ADD CONSTRAINT org_visibility_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.overdue_task_notifications
    ADD CONSTRAINT overdue_task_notifications_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_insight_history
    ADD CONSTRAINT rep_coaching_insight_history_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_insights
    ADD CONSTRAINT rep_coaching_insights_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.rep_coaching_scoring_config
    ADD CONSTRAINT rep_coaching_scoring_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.role_capabilities
    ADD CONSTRAINT role_capabilities_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.custom_roles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sales_sequence_steps
    ADD CONSTRAINT sales_sequence_steps_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sales_sequences(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sales_sequences
    ADD CONSTRAINT sales_sequences_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.scim_group_role_mappings
    ADD CONSTRAINT scim_group_role_mappings_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.custom_roles(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.scim_tokens
    ADD CONSTRAINT scim_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollment_logs
    ADD CONSTRAINT sequence_enrollment_logs_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollment_logs
    ADD CONSTRAINT sequence_enrollment_logs_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.sales_sequence_steps(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_current_step_id_fkey FOREIGN KEY (current_step_id) REFERENCES public.sales_sequence_steps(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_enrolled_by_id_fkey FOREIGN KEY (enrolled_by_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sales_sequences(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_feature_overrides
    ADD CONSTRAINT team_feature_overrides_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_feature_overrides
    ADD CONSTRAINT team_feature_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_memberships
    ADD CONSTRAINT team_memberships_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.team_memberships
    ADD CONSTRAINT team_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_parent_team_id_fkey FOREIGN KEY (parent_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.user_ai_context
    ADD CONSTRAINT user_ai_context_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.custom_roles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.user_custom_roles
    ADD CONSTRAINT user_custom_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.webhook_delivery_logs
    ADD CONSTRAINT webhook_delivery_logs_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE ONLY public.webhook_subscriptions
    ADD CONSTRAINT webhook_subscriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN duplicate_object OR duplicate_table OR invalid_table_definition OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS account_churn_expansion_signals_account_id_idx ON public.account_churn_expansion_signals USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS account_churn_expansion_signals_active_idx ON public.account_churn_expansion_signals USING btree (signal_type) WHERE (cleared_at IS NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS account_churn_expansion_signals_one_active_per_type ON public.account_churn_expansion_signals USING btree (account_id, signal_type) WHERE (cleared_at IS NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS account_health_score_history_account_id_computed_at_idx ON public.account_health_score_history USING btree (account_id, computed_at DESC)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS account_tags_tag_id_index ON public.account_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS accounts_is_demo_index ON public.accounts USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS accounts_name_trgm_idx ON public.accounts USING gin (name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS accounts_owner_id_index ON public.accounts USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_account_id_index ON public.activities USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_contact_id_index ON public.activities USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_deal_id_index ON public.activities USING btree (deal_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_is_demo_index ON public.activities USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_owner_id_index ON public.activities USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activity_objection_signals_category_idx ON public.activity_objection_signals USING btree (category)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activity_sentiment_scores_activity_id_idx ON public.activity_sentiment_scores USING btree (activity_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS ai_field_exclusions_entity_field_idx ON public.ai_field_exclusions USING btree (entity_type, field_name)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_gdpr_cascade_log_contact_id_idx ON public.ai_gdpr_cascade_log USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_gdpr_cascade_log_record_idx ON public.ai_gdpr_cascade_log USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_gdpr_cascade_log_triggered_at_idx ON public.ai_gdpr_cascade_log USING btree (triggered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_messages_session_id_created_at_index ON public.ai_messages USING btree (session_id, created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_messages_session_id_index ON public.ai_messages USING btree (session_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_sessions_user_id_index ON public.ai_sessions USING btree (user_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_sessions_user_id_updated_at_index ON public.ai_sessions USING btree (user_id, updated_at)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS ai_token_budgets_org_default_idx ON public.ai_token_budgets USING btree (((user_id IS NULL))) WHERE (user_id IS NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS ai_token_budgets_user_id_idx ON public.ai_token_budgets USING btree (user_id) WHERE (user_id IS NOT NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_token_usage_daily_feature_idx ON public.ai_token_usage_daily USING btree (feature)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_token_usage_daily_usage_date_idx ON public.ai_token_usage_daily USING btree (usage_date)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS ai_token_usage_daily_user_date_feature_idx ON public.ai_token_usage_daily USING btree (user_id, usage_date, feature)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_token_usage_year_month_index ON public.ai_token_usage USING btree (year_month)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS attachments_record_type_record_id_index ON public.attachments USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_changed_by_id_index ON ONLY public.audit_log USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_created_at_index ON ONLY public.audit_log USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_changed_by_id_idx ON public.audit_log_default USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_created_at_idx ON public.audit_log_default USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_event_type_index ON ONLY public.audit_log USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_event_type_idx ON public.audit_log_default USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_record_type_record_id_index ON ONLY public.audit_log USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_record_type_record_id_idx ON public.audit_log_default USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m06_changed_by_id_idx ON public.audit_log_y2026m06 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m06_created_at_idx ON public.audit_log_y2026m06 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m06_event_type_idx ON public.audit_log_y2026m06 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m06_record_type_record_id_idx ON public.audit_log_y2026m06 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m07_changed_by_id_idx ON public.audit_log_y2026m07 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m07_created_at_idx ON public.audit_log_y2026m07 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m07_event_type_idx ON public.audit_log_y2026m07 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m07_record_type_record_id_idx ON public.audit_log_y2026m07 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m08_changed_by_id_idx ON public.audit_log_y2026m08 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m08_created_at_idx ON public.audit_log_y2026m08 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m08_event_type_idx ON public.audit_log_y2026m08 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m08_record_type_record_id_idx ON public.audit_log_y2026m08 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m09_changed_by_id_idx ON public.audit_log_y2026m09 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m09_created_at_idx ON public.audit_log_y2026m09 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m09_event_type_idx ON public.audit_log_y2026m09 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m09_record_type_record_id_idx ON public.audit_log_y2026m09 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m10_changed_by_id_idx ON public.audit_log_y2026m10 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m10_created_at_idx ON public.audit_log_y2026m10 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m10_event_type_idx ON public.audit_log_y2026m10 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m10_record_type_record_id_idx ON public.audit_log_y2026m10 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m11_changed_by_id_idx ON public.audit_log_y2026m11 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m11_created_at_idx ON public.audit_log_y2026m11 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m11_event_type_idx ON public.audit_log_y2026m11 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m11_record_type_record_id_idx ON public.audit_log_y2026m11 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m12_changed_by_id_idx ON public.audit_log_y2026m12 USING btree (changed_by_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m12_created_at_idx ON public.audit_log_y2026m12 USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m12_event_type_idx ON public.audit_log_y2026m12 USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_y2026m12_record_type_record_id_idx ON public.audit_log_y2026m12 USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rule_logs_outcome_idx ON public.automation_rule_logs USING btree (outcome) WHERE (outcome = 'error'::public.automation_log_outcome)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rule_logs_rule_id_triggered_at_index ON public.automation_rule_logs USING btree (rule_id, triggered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rule_logs_triggered_at_idx ON public.automation_rule_logs USING btree (triggered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rules_enabled_index ON public.automation_rules USING btree (enabled)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rules_is_demo_index ON public.automation_rules USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rules_trigger_type_index ON public.automation_rules USING btree (trigger_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS connected_account_oauth_states_expires_at_idx ON public.connected_account_oauth_states USING btree (expires_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS connected_accounts_sync_due_idx ON public.connected_accounts USING btree (sync_next_attempt_at NULLS FIRST) WHERE ((status)::text = ANY (ARRAY[('active'::character varying)::text, ('error'::character varying)::text]))`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS connected_accounts_user_id_idx ON public.connected_accounts USING btree (user_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contact_addresses_contact_id_index ON public.contact_addresses USING btree (contact_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS contact_addresses_one_default_per_contact ON public.contact_addresses USING btree (contact_id) WHERE (is_default = true)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contact_champion_blocker_signals_status_idx ON public.contact_champion_blocker_signals USING btree (status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contact_tags_tag_id_index ON public.contact_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_account_id_index ON public.contacts USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_email_trgm_idx ON public.contacts USING gin (email public.gin_trgm_ops)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique_index ON public.contacts USING btree (email)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_first_name_trgm_idx ON public.contacts USING gin (first_name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_is_demo_index ON public.contacts USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_last_name_trgm_idx ON public.contacts USING gin (last_name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_lower_email_idx ON public.contacts USING btree (lower((email)::text))`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_owner_id_index ON public.contacts USING btree (owner_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS currencies_home_idx ON public.currencies USING btree (is_home) WHERE (is_home = true)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS currency_rate_history_code_effective_from_idx ON public.currency_rate_history USING btree (code, effective_from DESC)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS custom_field_values_record_id_index ON public.custom_field_values USING btree (record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS custom_reports_created_by_index ON public.custom_reports USING btree (created_by)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS data_hygiene_findings_entity_idx ON public.data_hygiene_findings USING btree (entity_type, entity_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS data_hygiene_findings_owner_id_idx ON public.data_hygiene_findings USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS data_hygiene_findings_related_entity_idx ON public.data_hygiene_findings USING btree (related_entity_id) WHERE (related_entity_id IS NOT NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_contacts_contact_id_index ON public.deal_contacts USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_stage_history_deal_id_entered_at_idx ON public.deal_stage_history USING btree (deal_id, entered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_tags_tag_id_index ON public.deal_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_win_loss_insights_generated_at_idx ON public.deal_win_loss_insights USING btree (generated_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_win_loss_insights_is_win_pattern_idx ON public.deal_win_loss_insights USING btree (is_win_pattern)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_account_id_index ON public.deals USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_close_date_index ON public.deals USING btree (close_date)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_is_demo_index ON public.deals USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_name_trgm_idx ON public.deals USING gin (name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_owner_id_index ON public.deals USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_pipeline_id_idx ON public.deals USING btree (pipeline_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_pipeline_stage_id_idx ON public.deals USING btree (pipeline_stage_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_stage_close_date_idx ON public.deals USING btree (stage, close_date)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_stage_index ON public.deals USING btree (stage)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_message_links_record_idx ON public.email_message_links USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_messages_account_sent_at_idx ON public.email_messages USING btree (connected_account_id, sent_at DESC)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_messages_account_thread_idx ON public.email_messages USING btree (connected_account_id, thread_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_messages_sent_at_idx ON public.email_messages USING btree (sent_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_messages_thread_id_idx ON public.email_messages USING btree (thread_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_sync_jobs_account_id_idx ON public.email_sync_jobs USING btree (connected_account_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS email_sync_jobs_one_active_per_account_idx ON public.email_sync_jobs USING btree (connected_account_id) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('running'::character varying)::text]))`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_templates_category_index ON public.email_templates USING btree (category)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_templates_enabled_index ON public.email_templates USING btree (enabled)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_beta_users_flag_key_index ON public.feature_flag_beta_users USING btree (flag_key)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_usage_flag_key_used_at_idx ON public.feature_flag_usage USING btree (flag_key, used_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_usage_used_at_index ON public.feature_flag_usage USING btree (used_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_user_overrides_flag_key_index ON public.feature_flag_user_overrides USING btree (flag_key)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flags_category_index ON public.feature_flags USING btree (category)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flags_group_key_index ON public.feature_flags USING btree (group_key)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS gdpr_deletion_log_record_idx ON public.gdpr_deletion_log USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON public.import_jobs USING btree (status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS lead_routing_decisions_lead_id_idx ON public.lead_routing_decisions USING btree (lead_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS lead_status_history_lead_id_index ON public.lead_status_history USING btree (lead_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS lead_tags_tag_id_index ON public.lead_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_converted_at_idx ON public.leads USING btree (converted_at) WHERE (converted_at IS NOT NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_created_at_index ON public.leads USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_email_index ON public.leads USING btree (email)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_is_demo_index ON public.leads USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_lower_email_idx ON public.leads USING btree (lower(email))`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_owner_id_index ON public.leads USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_status_index ON public.leads USING btree (status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS note_tags_tag_id_index ON public.note_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_body_text_trgm_idx ON public.notes USING gin (body_text public.gin_trgm_ops) WHERE (deleted_at IS NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_created_by_idx ON public.notes USING btree (created_by)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_entity_active_idx ON public.notes USING btree (entity_type, entity_id) WHERE (deleted_at IS NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_entity_idx ON public.notes USING btree (entity_type, entity_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx ON public.notifications USING btree (user_id, created_at DESC)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notifications_user_id_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_pipeline_name_lower_unique ON public.pipeline_stages USING btree (pipeline_id, lower((name)::text))`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_pipeline_sort_order_unique ON public.pipeline_stages USING btree (pipeline_id, sort_order)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipelines_name_lower_unique ON public.pipelines USING btree (lower((name)::text))`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipelines_single_default_idx ON public.pipelines USING btree (is_default) WHERE (is_default = true)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS rep_coaching_insight_history_rep_id_computed_at_idx ON public.rep_coaching_insight_history USING btree (rep_id, computed_at DESC)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS rep_coaching_insights_rep_id_idx ON public.rep_coaching_insights USING btree (rep_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS role_capabilities_role_id_idx ON public.role_capabilities USING btree (role_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sales_sequence_steps_sequence_id_index ON public.sales_sequence_steps USING btree (sequence_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sales_sequences_created_by_index ON public.sales_sequences USING btree (created_by)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollment_logs_enrollment_id_index ON public.sequence_enrollment_logs USING btree (enrollment_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollment_logs_executed_at_idx ON public.sequence_enrollment_logs USING btree (executed_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_contact_id_index ON public.sequence_enrollments USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_next_action_at_index ON public.sequence_enrollments USING btree (next_action_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_sequence_id_index ON public.sequence_enrollments USING btree (sequence_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_status_next_action_idx ON public.sequence_enrollments USING btree (next_action_at) WHERE ((status)::text = 'active'::text)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS team_feature_overrides_flag_key_idx ON public.team_feature_overrides USING btree (flag_key)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS team_memberships_user_id_idx ON public.team_memberships USING btree (user_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS teams_name_lower_idx ON public.teams USING btree (lower(name))`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_active_enrollment ON public.sequence_enrollments USING btree (sequence_id, contact_id) WHERE ((status)::text = 'active'::text)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS user_ai_context_user_id_idx ON public.user_ai_context USING btree (user_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS user_custom_roles_role_id_idx ON public.user_custom_roles USING btree (role_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS user_custom_roles_user_id_idx ON public.user_custom_roles USING btree (user_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS users_api_token_hash_unique ON public.users USING btree (api_token_hash) WHERE (api_token_hash IS NOT NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS users_email_index ON public.users USING btree (email)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS users_password_reset_token_hash_idx ON public.users USING btree (password_reset_token_hash) WHERE (password_reset_token_hash IS NOT NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS users_sso_provider_sso_subject_unique ON public.users USING btree (sso_provider, sso_subject) WHERE (sso_subject IS NOT NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS webhook_delivery_logs_delivered_at_idx ON public.webhook_delivery_logs USING btree (delivered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS webhook_delivery_logs_event_id_index ON public.webhook_delivery_logs USING btree (event_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS webhook_delivery_logs_subscription_id_index ON public.webhook_delivery_logs USING btree (subscription_id)`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_default_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_default_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_default_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_default_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_default_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m06_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m06_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m06_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m06_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m06_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m07_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m07_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m07_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m07_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m07_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m08_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m08_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m08_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m08_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m08_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m09_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m09_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m09_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m09_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m09_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m10_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m10_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m10_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m10_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m10_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m11_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m11_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m11_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m11_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m11_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_y2026m12_changed_by_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_y2026m12_created_at_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_y2026m12_event_type_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_pkey ATTACH PARTITION public.audit_log_y2026m12_pkey;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_y2026m12_record_type_record_id_idx;
EXCEPTION WHEN duplicate_object OR wrong_object_type THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER activities_set_updated_at BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER ai_token_budgets_set_updated_at BEFORE UPDATE ON public.ai_token_budgets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER ai_token_usage_set_updated_at BEFORE UPDATE ON public.ai_token_usage FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER audit_log_after_insert AFTER INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_notify();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER audit_log_no_modify BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER automation_rules_set_updated_at BEFORE UPDATE ON public.automation_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER connected_accounts_set_updated_at BEFORE UPDATE ON public.connected_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER contact_addresses_set_updated_at BEFORE UPDATE ON public.contact_addresses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER currencies_set_updated_at BEFORE UPDATE ON public.currencies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER custom_field_definitions_set_updated_at BEFORE UPDATE ON public.custom_field_definitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER custom_field_values_set_updated_at BEFORE UPDATE ON public.custom_field_values FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER custom_reports_set_updated_at BEFORE UPDATE ON public.custom_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER custom_roles_set_updated_at BEFORE UPDATE ON public.custom_roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER deals_set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER email_sync_jobs_set_updated_at BEFORE UPDATE ON public.email_sync_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER email_templates_set_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER feature_flags_set_updated_at BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER import_jobs_set_updated_at BEFORE UPDATE ON public.import_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER pipeline_stages_set_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER pipelines_set_updated_at BEFORE UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER sales_sequence_steps_set_updated_at BEFORE UPDATE ON public.sales_sequence_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER sales_sequences_set_updated_at BEFORE UPDATE ON public.sales_sequences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER sequence_enrollments_set_updated_at BEFORE UPDATE ON public.sequence_enrollments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER system_settings_set_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER tags_set_updated_at BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER user_ai_context_set_updated_at BEFORE UPDATE ON public.user_ai_context FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_delete ON public.accounts FOR DELETE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_delete ON public.activities FOR DELETE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_delete ON public.contacts FOR DELETE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_delete ON public.deals FOR DELETE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_delete ON public.leads FOR DELETE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_select ON public.accounts FOR SELECT USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_select ON public.activities FOR SELECT USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_select ON public.contacts FOR SELECT USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_select ON public.deals FOR SELECT USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_select ON public.leads FOR SELECT USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_update ON public.accounts FOR UPDATE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_update ON public.activities FOR UPDATE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_update ON public.contacts FOR UPDATE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_update ON public.deals FOR UPDATE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_admin_update ON public.leads FOR UPDATE USING (((( SELECT users.role
   FROM public.users
  WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_delete ON public.accounts FOR DELETE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_delete ON public.activities FOR DELETE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_delete ON public.contacts FOR DELETE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_delete ON public.deals FOR DELETE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_delete ON public.leads FOR DELETE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_select ON public.accounts FOR SELECT USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_select ON public.activities FOR SELECT USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_select ON public.contacts FOR SELECT USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_select ON public.deals FOR SELECT USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_select ON public.leads FOR SELECT USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_update ON public.accounts FOR UPDATE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_update ON public.activities FOR UPDATE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_update ON public.contacts FOR UPDATE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_update ON public.deals FOR UPDATE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`DO $do$ BEGIN
CREATE POLICY rls_owner_update ON public.leads FOR UPDATE USING ((owner_id = public.app_current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$`);
  pgm.sql(`COMMENT ON TABLE public.account_churn_expansion_signals IS 'Nightly AI churn/expansion signals per closed-won account (MINCRM-469). A new row is inserted per detection run; cleared_at is set (not deleted) when contradicted by new positive activity.'`);
  pgm.sql(`COMMENT ON TABLE public.account_health_score_history IS 'Append-only per-run history of account health scores (MINCRM-467), feeding the 6-month trend sparkline on the Account detail view. One row inserted per account per nightly run.'`);
  pgm.sql(`COMMENT ON TABLE public.account_health_scores IS 'Current cached relationship health score per account (MINCRM-467). Upserted nightly; the read path never computes live. Absence of a row means insufficient data (fewer than min_logged_activities logged activities).'`);
  pgm.sql(`COMMENT ON TABLE public.account_health_scoring_config IS 'Singleton admin-editable weights/thresholds for account health scoring (MINCRM-467). id is a boolean-typed singleton key (id = true) following the single-row-config convention.'`);
  pgm.sql(`COMMENT ON TABLE public.activity_meeting_briefs IS 'Most recently generated AI pre-meeting brief per activity (MINCRM-465). One row per activity — replaced on regenerate, not appended.'`);
  pgm.sql(`COMMENT ON TABLE public.activity_objection_signals IS 'AI objection classification per activity (MINCRM-471). One row per classified activity — classification runs on-demand, not pre-computed, so this table is populated lazily as reps view objection-logged activities.'`);
  pgm.sql(`COMMENT ON TABLE public.activity_sentiment_scores IS 'Per-activity AI sentiment classification (MINCRM-472). One row per activity, scored asynchronously after save.'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.api_key_key_version IS 'Key version used to encrypt api_key_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.ai_session_retention_days IS 'Days to retain ai_sessions/ai_messages before nightly hard-delete purge. Minimum 30, default 90. user_ai_context is NOT subject to this policy. (MINCRM-447)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.ai_input_cost_per_million_cents IS 'Admin-configured cost rate in cents per 1,000,000 input tokens, used to estimate spend on the AI usage dashboard. (MINCRM-459)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.ai_output_cost_per_million_cents IS 'Admin-configured cost rate in cents per 1,000,000 output tokens, used to estimate spend on the AI usage dashboard. (MINCRM-459)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.win_loss_min_closed_deals IS 'Minimum total closed (won+lost) deals required before win/loss patterns are surfaced. (MINCRM-464)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.win_loss_min_sample_size IS 'Minimum supporting deal count for a pattern to be surfaced (confidence threshold). (MINCRM-464)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.champion_blocker_deal_value_threshold IS 'Deal value above which the single-threaded-risk warning applies when only one contact is engaged. (MINCRM-466)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.churn_expansion_confidence_threshold IS 'Minimum confidence for a churn/expansion signal to be surfaced; lower-confidence signals are suppressed. (MINCRM-469)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.web_search_enabled IS 'Admin toggle for the optional news-hook section of AI meeting briefs. (MINCRM-465)'`);
  pgm.sql(`COMMENT ON TABLE public.ai_field_exclusions IS 'Admin-configurable AI payload exclusion toggles for standard entity fields. Immutable defaults live in code (ALWAYS_EXCLUDED_FIELDS), not here. (MINCRM-461)'`);
  pgm.sql(`COMMENT ON TABLE public.ai_gdpr_cascade_log IS 'Audit log for GDPR AI data cascade runs — redaction of PII in ai_messages and removal of matching user_ai_context entries following contact erasure. (MINCRM-446)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_gdpr_cascade_log.contact_id IS 'Superseded by record_id. Mirrors it when record_type is contact, and is NULL otherwise, so a query on this column matches only contacts.'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_gdpr_cascade_log.triggered_by IS 'NULL = system-initiated (auto-cascade after GDPR erasure). Non-null = admin who triggered a manual re-run.'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_gdpr_cascade_log.record_type IS 'Which entity was erased. Leads and contacts both cascade to AI data, and their ids share no namespace.'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_gdpr_cascade_log.record_id IS 'UUID of the erased record, in the table named by record_type. No FK — the row is erased in place, and for leads it is not a contact.'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_messages.tool_results IS 'Structured tool call results for native CRM result rendering. Array of {toolName, input, output} objects. NULL for user messages and assistant messages that did not invoke tools. (MINCRM-423, MINCRM-431)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_messages.pending_action IS 'Pending mutation action awaiting user confirmation. Object with {operation, entityType, entityId?, entityName?, fields, isBulk, bulkCount?, bulkSample?, isBulkDelete?, summary}. NULL when no confirmation is pending. (MINCRM-425, MINCRM-426)'`);
  pgm.sql(`COMMENT ON COLUMN public.ai_messages.context_proposal IS 'AI-proposed context entry awaiting user accept/dismiss. Object with {key, value, reason}. NULL when no proposal is present. (MINCRM-429, MINCRM-430)'`);
  pgm.sql(`COMMENT ON TABLE public.ai_token_usage_daily IS 'Per-day, per-feature token usage for the AI usage/cost dashboard. Additive to ai_token_usage, which remains the source of truth for monthly budget enforcement. (MINCRM-459)'`);
  pgm.sql(`COMMENT ON TABLE public.attachments IS 'File attachment metadata for CRM entity records. record_type + record_id form a polymorphic reference — no FK constraint exists because PostgreSQL FKs cannot span multiple parent tables. Valid record_type values: ''contact'', ''account'', ''deal'', ''lead'' (extended in migration 047). Orphan cleanup is the application''s responsibility: rows whose record_id no longer exists in the referenced entity table should be deleted when the parent is removed. The physical file (storage_key) must be deleted from object storage before or alongside the row. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);
  pgm.sql(`COMMENT ON TABLE public.audit_log IS 'Append-only audit trail, partitioned monthly by created_at (MINCRM-521). Valid record_type values: contact, account, deal, lead, activity, user, system_settings, custom_report, sequence, sequence_enrollment, feature_flag, ai_settings. Valid event_type values: created, updated, deleted, login, logout, password_changed, role_changed, deactivated, reactivated, ownership_reassigned, merged, note_created, note_updated, note_deleted, note_visibility_changed, gdpr_erasure, mfa_enabled, mfa_disabled, sso_login, sso_provisioned, sso_linked, sso_unlinked. Enforced at service layer via AuditRecordType and AuditEventType TypeScript unions in server/src/services/auditService.ts. Partition naming: audit_log_y{YYYY}m{MM}. Default partition: audit_log_default. Future partitions created by auditPartitionService.ensureAuditLogPartitions().'`);
  pgm.sql(`COMMENT ON COLUMN public.automation_rule_logs.triggering_record_type IS 'Entity type that caused the automation rule to fire. Valid values: ''deal'', ''contact''. Enforced at the service layer via AutomationTriggerContext in server/src/services/automationService.ts. Not a CHECK constraint — see migration 083 for rationale (mirrors the audit_log approach from migration 076).'`);
  pgm.sql(`COMMENT ON TABLE public.connected_account_oauth_states IS 'Single-use OAuth authorization-code state. Binds a flow to the user who started it and holds that flow PKCE verifier until the callback consumes the row.'`);
  pgm.sql(`COMMENT ON TABLE public.connected_accounts IS 'Per-user linked mailboxes. auth_encrypted is AES-256-GCM ciphertext (OAuth tokens or IMAP credentials as JSON); it is never returned by any API.'`);
  pgm.sql(`COMMENT ON COLUMN public.connected_accounts.granted_scopes IS 'Scopes the provider actually granted, which may be fewer than were requested.'`);
  pgm.sql(`COMMENT ON COLUMN public.connected_accounts.key_version IS 'Key version used to encrypt auth_encrypted. References ENCRYPTION_KEY_V<n> env var.'`);
  pgm.sql(`COMMENT ON COLUMN public.connected_accounts.sync_failure_count IS 'Consecutive failed sync attempts. Drives the retry delay and the ceiling past which a mailbox is no longer claimed; reset when a connection test succeeds.'`);
  pgm.sql(`COMMENT ON COLUMN public.connected_accounts.sync_next_attempt_at IS 'Earliest time this mailbox may be synced again. Null means due now while sync_failure_count is below the ceiling, and parked-until-a-user-acts once it reaches it; the two columns gate the claim together.'`);
  pgm.sql(`COMMENT ON TABLE public.contact_champion_blocker_signals IS 'Per-contact AI champion/blocker classification (MINCRM-466). One row per contact — replaced/updated after each new activity, not appended.'`);
  pgm.sql(`COMMENT ON TABLE public.contact_followup_timing_suggestions IS 'Cached best-time-to-contact suggestion per contact (MINCRM-470). day_of_week/hour_start_utc/hour_end_utc are UTC-anchored; project to a display timezone at read time, never store localized values. Absence of a row means fewer than 5 logged interactions (insufficient data).'`);
  pgm.sql(`COMMENT ON COLUMN public.contacts.title_updated_at IS 'Timestamp of the most recent change to contacts.title specifically (MINCRM-476) — stamped only by contactService.updateContact when title actually changes, unlike updated_at which bumps on any field edit. NULL means never explicitly changed since this column was added; the hygiene scan treats NULL as "at least as stale as created_at."'`);
  pgm.sql(`COMMENT ON TABLE public.custom_field_values IS 'Values for admin-defined custom fields on CRM entity records. record_id is a polymorphic reference to the entity row identified by the associated custom_field_definitions.entity_type — no FK constraint is possible because the parent table varies per definition. Valid entity_type values (on custom_field_definitions): ''contact'', ''account'', ''deal''. definition_id has a real FK with ON DELETE CASCADE — deleting a field definition removes all its values automatically. Orphan cleanup: rows whose record_id no longer exists in the parent entity table accumulate silently when the entity is deleted. Application must delete custom_field_values rows alongside entity deletion. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);
  pgm.sql(`COMMENT ON TABLE public.custom_roles IS 'Named role definitions for capability-based RBAC (MINCRM-542). Rows with is_builtin = true correspond to the five built-in roles and cannot be deleted or renamed via the REST API.'`);
  pgm.sql(`COMMENT ON TABLE public.data_hygiene_findings IS 'Current data hygiene queue (MINCRM-476), one row per flagged record per issue type. Upserted nightly by dataHygieneService; mutated in place by update/merge/archive/dismiss actions rather than appended — reflects current state, not a history log. A finding is cleared (deleted) once the nightly scan no longer detects the issue, or the underlying record is deleted/archived. dismissed_until implements the 90-day (admin-configurable) dismiss suppression window.'`);
  pgm.sql(`COMMENT ON TABLE public.data_hygiene_scoring_config IS 'Singleton admin-editable thresholds for the data hygiene scan (MINCRM-476). id is a boolean-typed singleton key (id = true) following the single-row-config convention (see account_health_scoring_config, migration 151).'`);
  pgm.sql(`COMMENT ON TABLE public.deal_stage_history IS 'Append-only log of real deal stage transitions (MINCRM-474). One row per deal per stage entered, including a day-0 row on creation. Never updated, only inserted. Powers average-days-per-stage and stage-conversion-rate metrics for rep coaching insights.'`);
  pgm.sql(`COMMENT ON TABLE public.deal_win_loss_insights IS 'Cached nightly AI win/loss pattern analysis results (MINCRM-464). Fully replaced on each run of analyzeWinLossPatterns — not appended.'`);
  pgm.sql(`COMMENT ON TABLE public.email_message_links IS 'Links a synced message to the CRM records its addresses name. record_type + record_id form a polymorphic reference with no FK constraint, because a PostgreSQL FK cannot span several parent tables. Valid record_type values: ''contact'', ''lead'', ''account'', ''deal''. Orphan cleanup is the application''s responsibility: a hard-delete of one of those records must clear its links in the same transaction, and a consolidating path — a contact merge, a lead conversion — must move them to the surviving record rather than drop them. See docs/dev/schema.md — Polymorphic FK Pattern.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_message_links.match_type IS 'How the link was made: ''auto'' by the sync engine''s address matching, ''manual'' by a user. A manual link is audited and an automatic one is not, so this also says whether to expect an audit entry.'`);
  pgm.sql(`COMMENT ON TABLE public.email_messages IS 'Messages synced from a connected mailbox. Headers, metadata, and body text. All three body columns are nullable: a message may store its headers with no body.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_messages.provider_message_id IS 'The provider''s own message identifier, opaque here. Unique per connected account, which is what makes a repeated sync idempotent.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_messages.thread_id IS 'Normalized across providers: native thread id where one exists, otherwise derived from RFC 5322 References/In-Reply-To/Message-ID.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_messages.is_private IS 'Restricts a message to the mailbox owner; enforced at the service layer.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_messages.message_body_text IS 'Plain-text body. Taken from the text part where one exists, otherwise converted from the HTML part so a message reads the same either way. Null when neither part exists or the document could not be parsed.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_messages.message_body_html IS 'HTML body exactly as the sender wrote it, stored UNSANITIZED. Nothing renders it today; whatever first does must sanitize at render, since sanitizing here would discard markup a renderer needs.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_messages.message_snippet IS 'First 200 characters of the plain-text body with whitespace collapsed, for list views that must not load a whole body. Derived from message_body_text, so it is null whenever that is.'`);
  pgm.sql(`COMMENT ON TABLE public.email_sync_jobs IS 'Progress of a bounded mailbox backfill. One row per backfill run; incremental syncs create none.'`);
  pgm.sql(`COMMENT ON COLUMN public.email_sync_jobs.messages_synced IS 'Messages stored so far. A backfill spans several scheduler ticks, so this advances while status stays running.'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.role_overrides IS 'Per-role enable/disable overrides. Keys are arbitrary role name strings (built-in or custom); values are booleans. Role name validity enforced at service layer against custom_roles table. (MINCRM-565)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.enable_at IS 'When set and <= now(), the flag is treated as enabled regardless of the enabled column. Evaluated lazily at resolution time — no background job required. (MINCRM-488)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.rollout_percentage IS 'When non-null, gates users via stableHash(userId+flagKey)%100 < rollout_percentage. null skips rollout gating entirely. 100 means all users are enabled. (MINCRM-490)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.rollout_stages IS 'Ordered array of {percentage, scheduled_at} objects. Background scheduler advances rollout_percentage when scheduled_at <= now(). (MINCRM-490)'`);
  pgm.sql(`COMMENT ON TABLE public.gdpr_deletion_log IS 'Append-only log of GDPR Art. 17 erasure requests (one row per erased record). The UNIQUE index on (record_type, record_id) is safe because all record_id values are UUIDs generated by gen_random_uuid() at row-creation time — re-imports always receive a new UUID. If deterministic external IDs are ever introduced this constraint must be revisited. See migration 084 for full rationale. (MINCRM-517) No FK constraint on record_id — the referenced row is hard-deleted during erasure. Rows are retained indefinitely by design; orphan cleanup does not apply. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);
  pgm.sql(`COMMENT ON COLUMN public.gdpr_deletion_log.record_id IS 'UUID of the erased record. References the PK of the entity identified by record_type. No FK constraint — the referenced row will have been hard-deleted before or during erasure. UNIQUE constraint assumption: safe only while all record IDs are gen_random_uuid() UUIDs. See migration 084 if deterministic external IDs are introduced.'`);
  pgm.sql(`COMMENT ON TABLE public.lead_routing_decisions IS 'One row per lead created after a routing suggestion was shown to the manager (MINCRM-475). Written once, at lead-creation time, in the same transaction as the lead insert — never updated. Doubles as the AC-required routing decision log. Leads created without ever requesting a suggestion have no row here.'`);
  pgm.sql(`COMMENT ON TABLE public.lead_routing_scoring_config IS 'Singleton admin-editable weights/thresholds for lead routing suggestion scoring (MINCRM-475). id is a boolean-typed singleton key (id = true) following the single-row-config convention (see account_health_scoring_config, migration 151; rep_coaching_scoring_config, migration 153).'`);
  pgm.sql(`COMMENT ON COLUMN public.leads.territory IS 'Free-text sales territory, matched against users.territory for routing suggestions (MINCRM-475). No DB-level enum, same convention as accounts.industry/employee_range.'`);
  pgm.sql(`COMMENT ON COLUMN public.leads.industry IS 'Free-text industry/vertical, matched against historical deal outcomes for routing suggestions (MINCRM-475). Independent of accounts.industry — leads have no account until conversion.'`);
  pgm.sql(`COMMENT ON COLUMN public.leads.employee_range IS 'Free-text company-size bucket, same convention as accounts.employee_range (MINCRM-475). Used alongside industry and lead_source to define a "similar lead profile" for historical win-rate comparison.'`);
  pgm.sql(`COMMENT ON TABLE public.notes IS 'Rich notes attached to CRM entity records, with soft-delete support. entity_type + entity_id form a polymorphic reference — no FK constraint exists because PostgreSQL FKs cannot span multiple parent tables. Valid entity_type values: ''contact'', ''account'', ''deal'', ''lead''. Soft-deleted rows (deleted_at IS NOT NULL) are excluded from application queries but remain in the table; the partial GIN index on body_text also excludes them. Hard orphan cleanup (rows whose entity_id no longer exists) is the application''s responsibility. Soft-deleted orphans are harmless but may be purged by a periodic maintenance query. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);
  pgm.sql(`COMMENT ON TABLE public.notifications IS 'Minimal in-app notification feed (MINCRM-469). type is free text (not a DB enum) so new notification-producing features can start writing rows without a migration, same convention as ai_token_usage_daily.feature.'`);
  pgm.sql(`COMMENT ON TABLE public.rep_coaching_insight_history IS 'Append-only per-run history of rep coaching insights (MINCRM-474), one row per rep per metric per nightly run. Reserved for a future trend view; not read by any endpoint in this ticket.'`);
  pgm.sql(`COMMENT ON TABLE public.rep_coaching_insights IS 'Current cached per-rep coaching insight per metric (MINCRM-474). Upserted nightly by repCoachingService; the read path never computes live. Absence of rows for a rep means fewer than min_closed_deals closed deals. Never exposed as an NLI tool — read exclusively via the dedicated /insights/coaching and dashboard endpoints, gated by role, to protect rep privacy.'`);
  pgm.sql(`COMMENT ON TABLE public.rep_coaching_scoring_config IS 'Singleton admin-editable thresholds for rep coaching insight generation (MINCRM-474). id is a boolean-typed singleton key (id = true) following the single-row-config convention (see account_health_scoring_config, migration 151).'`);
  pgm.sql(`COMMENT ON TABLE public.role_capabilities IS 'Capability strings granted to a role (MINCRM-542). The TypeScript Capability enum is the source of truth for valid strings; the DB stores assignments only.'`);
  pgm.sql(`COMMENT ON COLUMN public.smtp_configuration.pass_key_version IS 'Key version used to encrypt pass_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)'`);
  pgm.sql(`COMMENT ON COLUMN public.system_settings.updated_by IS 'User who last modified this setting — NULL for system/migration writes (MINCRM-520)'`);
  pgm.sql(`COMMENT ON TABLE public.team_feature_overrides IS 'Per-team feature flag overrides (MINCRM-475). Generic, not routing-specific — any future per-team toggle can reuse this table. enabled=false blocks the flag for every member of the team regardless of rollout/beta/group state, but a per-user force_enabled override in feature_flag_user_overrides still wins (checked first in isFlagEnabledForUser).'`);
  pgm.sql(`COMMENT ON TABLE public.user_ai_context IS 'Per-user key/value context entries injected into every Claude system prompt as a personalisation preamble. (MINCRM-427)'`);
  pgm.sql(`COMMENT ON COLUMN public.user_ai_context.key IS 'Short label for this preference (e.g. "a while", "high-value"). Max 100 chars.'`);
  pgm.sql(`COMMENT ON COLUMN public.user_ai_context.value IS 'Plain-text definition of the preference (e.g. "30+ days without activity"). Max 500 chars.'`);
  pgm.sql(`COMMENT ON TABLE public.user_custom_roles IS 'Assignment of custom roles to users (MINCRM-542). Effective capabilities are the union of all capabilities from all assigned roles.'`);
  pgm.sql(`COMMENT ON COLUMN public.users.sso_provider IS 'SSO protocol that provisioned this user: saml | oidc'`);
  pgm.sql(`COMMENT ON COLUMN public.users.sso_subject IS 'Stable external identity: SAML nameID or OIDC sub claim'`);
  pgm.sql(`COMMENT ON COLUMN public.users.territory IS 'Free-text sales territory a rep is assigned to, matched against leads.territory for routing suggestions (MINCRM-475).'`);
  pgm.sql(`COMMENT ON COLUMN public.users.nav_layout IS 'Personal navigation layout. NULL means follow the workspace default in system_settings.nav_layout, so a later admin change still propagates.'`);
  pgm.sql(`COMMENT ON INDEX public.account_churn_expansion_signals_one_active_per_type IS 'At most one active (cleared_at IS NULL) signal per account per signal_type — guards against overlapping nightly-job runs racing to insert duplicates. (MINCRM-469)'`);

  // ── Seed data ────────────────────────────────────────────────────────────────
  // Rows the application needs on a fresh install. pg_dump --schema-only carries
  // none of these, and the migrations that inserted them are fake-marked during
  // bootstrap, so they exist nowhere else: without this section a fresh database
  // has no pipeline, no stages, no feature flags and no home currency.
  //
  // Read from a database built by running the migrations, so the two cannot drift.
  // Every statement is a no-op on a database that already has the row.
  pgm.sql(`
    INSERT INTO public.system_settings (key, value)
    VALUES
      ('deal_auto_link', 'true'),
      ('default_currency', 'USD'),
      ('default_language', 'en'),
      ('default_timezone', 'UTC'),
      ('email_notifications_enabled', 'true'),
      ('nav_layout', 'top'),
      ('onboarding_completed', 'false'),
      ('pipeline_stages_reviewed', 'false'),
      ('require_mfa', 'false'),
      ('tags_restrict_creation', 'false')
    ON CONFLICT (key) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.currencies (code, name, symbol, rate_to_home, is_home)
    VALUES
      ('USD', 'US Dollar', '$', 1.0, true)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.pipelines (name, is_default)
    SELECT * FROM (VALUES
      ('Default', true)
    ) AS seed(name, is_default)
    WHERE NOT EXISTS (SELECT 1 FROM public.pipelines)
  `);
  pgm.sql(`
    INSERT INTO public.org_visibility_settings (object_type, policy)
    VALUES
      ('account', 'org'),
      ('activity', 'org'),
      ('contact', 'org'),
      ('deal', 'org')
    ON CONFLICT (object_type) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.custom_roles (name, description, is_builtin)
    VALUES
      ('admin', 'Full administrative access to all capabilities', true),
      ('manager', 'Team management with broad record access', true),
      ('rep', 'Standard sales representative access', true),
      ('service_account', 'Machine-to-machine API access via bearer token', true),
      ('viewer', 'Read-only access across the organisation', true)
    ON CONFLICT (name) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      ('activities', 'Activities', 'Enables activity logging (calls, emails, meetings) on CRM records.', 'Core CRM', true, NULL, true),
      ('ai_activity_summarizer', 'Activity Summarizer', 'Generates AI summaries of recent activity on contact, account, and deal record timelines.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_champion_blocker_detection', 'Champion/Blocker Detection', 'AI-inferred champion and blocker signals detected from activity notes, shown as badges on contacts.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_churn_expansion_detection', 'Churn/Expansion Detection', 'Nightly AI monitoring of closed-won accounts for churn risk and expansion opportunity signals.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_contact_enrichment', 'Contact Enrichment', 'Automatically enriches contact records with additional data from AI-powered inference.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_data_hygiene_assistant', 'AI Data Hygiene Assistant', 'Nightly scan for stale, incomplete, and potentially invalid contact/account/opportunity records, surfaced as a prioritized, actionable queue.', 'AI', true, '{"rep": true, "admin": true, "manager": true}'::jsonb, true),
      ('ai_deal_health_check', 'Deal Health Check', 'Assesses overall deal health and surfaces risk signals using AI analysis of deal activity.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_duplicate_explanation', 'Duplicate Explanation', 'Provides a natural language explanation of why two records were flagged as potential duplicates.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_email_draft', 'Email Draft', 'Assists users with drafting outbound emails in the activity composer using AI.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_features', 'AI Features', 'Master toggle for all AI-powered features in the CRM.', 'AI', true, NULL, true),
      ('ai_followup_timing_suggestions', 'AI Follow-Up Timing Suggestions', 'Suggests the optimal day/time to follow up with a contact based on historical engagement patterns.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_lead_routing_suggestion', 'AI Lead Routing Suggestion', 'Suggests which rep to assign a new lead to, based on territory, industry match, workload, and historical win rate. Advisory only — never auto-assigns.', 'AI', true, '{"rep": false, "admin": true, "manager": true}'::jsonb, true),
      ('ai_lead_score_narrative', 'Lead Score Narrative', 'Generates a plain-English explanation of the factors contributing to a lead score.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_lead_scoring', 'Lead Scoring', 'Computes a rule-based quality score for leads, shown on the Lead detail page.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_meeting_brief', 'AI Meeting Brief', 'Generates an AI pre-meeting brief for upcoming call and meeting activities.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_nli_page', 'NLI Page', 'Provides the natural language interface page where users can query CRM data in plain English.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_objection_pattern_matching', 'Objection Pattern Matching', 'AI classification of objections in activity notes, with precedent matching against how similar objections were handled in past won deals.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_proposal_draft_generation', 'Proposal Draft Generation', 'AI-generated first-draft proposal documents from a deal, editable before export as Markdown or DOCX.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_relationship_health_score', 'AI Relationship Health Score', 'Nightly AI-computed relationship health score per account, shown as a badge with trend history and single-threaded risk flag.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_rep_coaching_insights', 'AI Rep Coaching Insights', 'Nightly AI-computed per-rep coaching insights (stage timing, conversion rates, activity patterns, win rates) compared against team averages, with recommended coaching actions.', 'AI', true, '{"rep": true, "admin": true, "manager": true}'::jsonb, true),
      ('ai_sentiment_tracking', 'AI Sentiment Tracking', 'Scores activity notes and call summaries for sentiment and shows trend indicators on Contact and Account detail views.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_stage_advancement', 'Stage Advancement Suggestion', 'Suggests when a deal is ready to advance to the next pipeline stage based on activity signals.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_task_suggestions', 'Task Suggestions', 'Suggests follow-up tasks based on recent activity and deal context.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_warm_intro_path', 'AI Warm Introduction Paths', 'Surfaces warm introduction paths through a rep''s contact network on the Contact detail view and via NLI queries.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('ai_win_loss_insights', 'Win/Loss Pattern Insights', 'Nightly AI analysis of closed deals surfacing patterns that correlate with winning and losing.', 'AI', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('automation_rules', 'Automation Rules', 'Enables configurable trigger-action automation rules that run on record changes.', 'Integrations', true, NULL, true),
      ('csv_export', 'CSV Export', 'Allows users to export CRM records as CSV files.', 'Data', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('csv_import', 'CSV Import', 'Allows bulk import of contacts, accounts, and deals from CSV files.', 'Data', true, NULL, true),
      ('custom_fields', 'Custom Fields', 'Allows admins to define custom data fields on contacts, accounts, and deals.', 'Productivity', true, NULL, true),
      ('demo_data', 'Demo Data', 'Allows loading and removing demo data for onboarding and evaluation purposes.', 'Data', false, NULL, true),
      ('duplicate_detection', 'Duplicate Detection', 'Warns users when creating records that may be duplicates of existing ones.', 'Productivity', true, NULL, true),
      ('email_sync', 'Email Sync', 'Lets each user connect a Gmail, Outlook, or IMAP mailbox to MiniCRM from their profile.', 'Integrations', false, NULL, true),
      ('email_templates', 'Email Templates', 'Provides a library of reusable email templates for use in sequences and activities.', 'Integrations', true, NULL, true),
      ('lead_scoring', 'Lead Scoring', 'Enables automated scoring of leads based on configurable criteria.', 'Productivity', true, NULL, true),
      ('mobile_access', 'Mobile Access', 'Enables access to the CRM from mobile devices.', 'Core CRM', false, NULL, true),
      ('multiple_pipelines', 'Multiple Pipelines', 'Enables management of more than one deal pipeline with independent stage sets.', 'Productivity', true, NULL, true),
      ('notes', 'Notes', 'Allows users to create and view notes on contacts, accounts, and deals.', 'Core CRM', true, NULL, true),
      ('reporting', 'Reporting & Dashboards', 'Provides access to built-in reports and the dashboard analytics view.', 'Data', true, '{"rep": true, "admin": true}'::jsonb, true),
      ('sequencing', 'Sequencing', 'Enables automated email cadence sequences for outbound sales outreach.', 'Productivity', true, NULL, true),
      ('tags', 'Tags', 'Allows users to tag contacts, accounts, and deals for categorization.', 'Core CRM', true, NULL, true),
      ('tasks', 'Tasks', 'Allows users to create and track tasks linked to CRM records.', 'Core CRM', true, NULL, true),
      ('webhooks', 'Webhooks', 'Allows admins to configure outbound webhook notifications to external systems.', 'Integrations', true, NULL, true)
    ON CONFLICT (flag_key) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.pipeline_stages
      (name, sort_order, probability, is_terminal, is_fixed, stage_exit_requirements, pipeline_id)
    SELECT seed.*, p.id
      FROM (VALUES
        ('Prospecting', 10, 10, false, false, '{}'::jsonb),
      ('Qualification', 20, 25, false, false, '{}'::jsonb),
      ('Proposal', 30, 50, false, false, '{}'::jsonb),
      ('Negotiation', 40, 75, false, false, '{}'::jsonb),
      ('Closed Won', 50, 100, true, true, '{}'::jsonb),
      ('Closed Lost', 60, 0, true, true, '{}'::jsonb)
      ) AS seed(name, sort_order, probability, is_terminal, is_fixed, stage_exit_requirements),
      public.pipelines p
     WHERE p.is_default = true
       AND NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE pipeline_id = p.id)
  `);
  pgm.sql(`
    INSERT INTO public.system_settings (key, value)
    SELECT 'sso_jit_default_role_id', r.id::text
      FROM public.custom_roles r
     WHERE r.name = 'rep' AND r.is_builtin = true
    ON CONFLICT (key) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, seed.capability
      FROM (VALUES
        ('admin', 'activities:create'),
      ('admin', 'activities:delete'),
      ('admin', 'activities:edit'),
      ('admin', 'activities:view'),
      ('admin', 'audit_log:view'),
      ('admin', 'bulk:operations'),
      ('admin', 'connected_accounts:manage'),
      ('admin', 'contacts:create'),
      ('admin', 'contacts:delete'),
      ('admin', 'contacts:edit'),
      ('admin', 'contacts:export'),
      ('admin', 'contacts:view'),
      ('admin', 'coverage:admin'),
      ('admin', 'dashboards:manage'),
      ('admin', 'dashboards:view'),
      ('admin', 'data:export'),
      ('admin', 'data:import'),
      ('admin', 'deals:create'),
      ('admin', 'deals:delete'),
      ('admin', 'deals:edit'),
      ('admin', 'deals:reassign'),
      ('admin', 'deals:view'),
      ('admin', 'feature_flags:manage'),
      ('admin', 'forecasting:edit'),
      ('admin', 'forecasting:view'),
      ('admin', 'integrations:manage'),
      ('admin', 'pipelines:manage'),
      ('admin', 'pipelines:view'),
      ('admin', 'reports:create'),
      ('admin', 'reports:delete'),
      ('admin', 'reports:edit'),
      ('admin', 'reports:export'),
      ('admin', 'reports:schedule'),
      ('admin', 'reports:view'),
      ('admin', 'sequences:create'),
      ('admin', 'sequences:delete'),
      ('admin', 'sequences:edit'),
      ('admin', 'sequences:enroll'),
      ('admin', 'sequences:view'),
      ('admin', 'settings:manage'),
      ('admin', 'teams:manage'),
      ('admin', 'users:create'),
      ('admin', 'users:delete'),
      ('admin', 'users:edit'),
      ('admin', 'users:view'),
      ('admin', 'workflows:activate'),
      ('admin', 'workflows:create'),
      ('admin', 'workflows:delete'),
      ('admin', 'workflows:edit'),
      ('admin', 'workflows:view'),
      ('manager', 'activities:create'),
      ('manager', 'activities:delete'),
      ('manager', 'activities:edit'),
      ('manager', 'activities:view'),
      ('manager', 'bulk:operations'),
      ('manager', 'connected_accounts:manage'),
      ('manager', 'contacts:create'),
      ('manager', 'contacts:delete'),
      ('manager', 'contacts:edit'),
      ('manager', 'contacts:export'),
      ('manager', 'contacts:view'),
      ('manager', 'dashboards:manage'),
      ('manager', 'dashboards:view'),
      ('manager', 'data:export'),
      ('manager', 'deals:create'),
      ('manager', 'deals:delete'),
      ('manager', 'deals:edit'),
      ('manager', 'deals:reassign'),
      ('manager', 'deals:view'),
      ('manager', 'forecasting:edit'),
      ('manager', 'forecasting:view'),
      ('manager', 'pipelines:view'),
      ('manager', 'reports:create'),
      ('manager', 'reports:edit'),
      ('manager', 'reports:export'),
      ('manager', 'reports:schedule'),
      ('manager', 'reports:view'),
      ('manager', 'sequences:create'),
      ('manager', 'sequences:edit'),
      ('manager', 'sequences:enroll'),
      ('manager', 'sequences:view'),
      ('manager', 'workflows:view'),
      ('rep', 'activities:create'),
      ('rep', 'activities:delete'),
      ('rep', 'activities:edit'),
      ('rep', 'activities:view'),
      ('rep', 'connected_accounts:manage'),
      ('rep', 'contacts:create'),
      ('rep', 'contacts:delete'),
      ('rep', 'contacts:edit'),
      ('rep', 'contacts:view'),
      ('rep', 'dashboards:view'),
      ('rep', 'deals:create'),
      ('rep', 'deals:delete'),
      ('rep', 'deals:edit'),
      ('rep', 'deals:view'),
      ('rep', 'forecasting:view'),
      ('rep', 'pipelines:view'),
      ('rep', 'reports:view'),
      ('rep', 'sequences:enroll'),
      ('rep', 'sequences:view'),
      ('service_account', 'activities:create'),
      ('service_account', 'activities:edit'),
      ('service_account', 'activities:view'),
      ('service_account', 'api:access'),
      ('service_account', 'contacts:create'),
      ('service_account', 'contacts:edit'),
      ('service_account', 'contacts:export'),
      ('service_account', 'contacts:view'),
      ('service_account', 'data:export'),
      ('service_account', 'data:import'),
      ('service_account', 'deals:create'),
      ('service_account', 'deals:edit'),
      ('service_account', 'deals:view'),
      ('service_account', 'pipelines:view'),
      ('service_account', 'sequences:enroll'),
      ('viewer', 'activities:view'),
      ('viewer', 'contacts:view'),
      ('viewer', 'dashboards:view'),
      ('viewer', 'deals:view'),
      ('viewer', 'forecasting:view'),
      ('viewer', 'pipelines:view'),
      ('viewer', 'reports:view')
      ) AS seed(role_name, capability)
      JOIN public.custom_roles r ON r.name = seed.role_name
    ON CONFLICT DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.user_custom_roles (user_id, role_id)
    SELECT u.id, r.id
      FROM public.users u
      JOIN public.custom_roles r ON r.name = u.role AND r.is_builtin = true
    ON CONFLICT (user_id, role_id) DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.account_health_scoring_config (id) VALUES (true)
    ON CONFLICT DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.ai_configuration (singleton) VALUES (true)
    ON CONFLICT DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.data_hygiene_scoring_config (id) VALUES (true)
    ON CONFLICT DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.lead_routing_scoring_config (id) VALUES (true)
    ON CONFLICT DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.rep_coaching_scoring_config (id) VALUES (true)
    ON CONFLICT DO NOTHING
  `);
  pgm.sql(`
    INSERT INTO public.smtp_configuration (singleton) VALUES (true)
    ON CONFLICT DO NOTHING
  `);
  // ── minicrm_app role (migration 092) ─────────────────────────────────────────
  // This cluster-level role is not captured by pg_dump --schema-only, so it must
  // be added here manually. It is used by rlsEnforcement.test.ts to connect as a
  // non-superuser so that RLS policies are evaluated (the primary minicrm role is
  // a superuser and bypasses RLS regardless of BYPASSRLS settings).
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'minicrm_app') THEN
        CREATE ROLE minicrm_app
          NOSUPERUSER
          NOCREATEDB
          NOCREATEROLE
          NOBYPASSRLS
          LOGIN
          PASSWORD 'minicrm_app';
      END IF;
    END
    $$
  `);
  pgm.sql(`GRANT USAGE ON SCHEMA public TO minicrm_app`);
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.contacts,
      public.accounts,
      public.deals,
      public.leads,
      public.activities
    TO minicrm_app
  `);
  pgm.sql(`GRANT SELECT ON TABLE public.users TO minicrm_app`);
  pgm.sql(`GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO minicrm_app`);
};

/**
 * Deliberately empty.
 *
 * A baseline is not a migration anyone rolls back: dropping the whole schema is what it
 * would have to do, and node-pg-migrate offers no safer down for it. Reverting a fresh
 * install means dropping the database.
 */
exports.down = () => {};
