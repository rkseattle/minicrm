/**
 * Migration 000: Schema baseline — squash of migrations 001–118 (MINCRM-528, MINCRM-542, MINCRM-540, MINCRM-541, MINCRM-488, MINCRM-489, MINCRM-490, MINCRM-492)
 *
 * PURPOSE
 * -------
 * Captures the full schema as it exists after all 118 migrations (001–118), so
 * fresh environments can bootstrap with a single `migrate:fresh` run instead of
 * replaying all 118 individual migrations.
 *
 * FRESH ENVIRONMENT SETUP
 * -----------------------
 * Do NOT use `npm run migrate` on a brand-new database — it will run all 119
 * files (000_baseline + 001–118) and fail because 001–118 re-create objects
 * that 000_baseline already created. Use the two-step bootstrap instead:
 *
 *   npm run migrate:fresh --workspace=minicrm-server
 *
 * This script:
 *   1. Runs ONLY `000_baseline` (count: 1) to create the full schema
 *   2. Marks 001–118 as applied via node-pg-migrate's `--fake` mode so they
 *      are never executed
 *   3. Future migrations (119+) run normally via `npm run migrate`
 *
 * EXISTING DEPLOYMENTS
 * --------------------
 * Existing databases that already have 001–N applied are NOT affected by this
 * migration's introduction. When `npm run migrate` runs on an existing DB, it
 * will execute `000_baseline` once (it is new and not yet in pgmigrations).
 * The IF NOT EXISTS guards on every CREATE statement make this a safe no-op —
 * all schema objects already exist and are skipped.
 *
 * All CREATE TRIGGER, CREATE POLICY, and ALTER TABLE ADD CONSTRAINT statements
 * are wrapped in DO/EXCEPTION blocks (duplicate_object) so this migration is
 * fully idempotent and safe to run on existing databases.
 *
 * DOWN MIGRATION
 * --------------
 * The down() is intentionally a no-op. Rolling back the baseline would mean
 * dropping the entire schema, which is equivalent to destroying the database.
 * The correct recovery path is to restore from a backup, not to run down().
 * A comment makes this explicit so it is not mistaken for an oversight.
 *
 * REGENERATING THIS FILE
 * ----------------------
 * See CLAUDE.md → "Migration Baseline Squash" for the documented process.
 * Generated from the live schema using:
 *   docker exec minicrm-db pg_dump --username=minicrm --dbname=minicrm \
 *     --schema-only --no-owner --no-acl --schema=public
 * with migrations 001–118 fully applied.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * Creates the full MiniCRM schema from scratch.
 * Safe to run against a pre-existing schema — every CREATE TABLE/INDEX/EXTENSION
 * uses IF NOT EXISTS. Called by `migrate:fresh` with count:1 so it runs alone.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // -------------------------------------------------------------------------
  // Extensions
  // -------------------------------------------------------------------------
  pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // -------------------------------------------------------------------------
  // Functions
  // -------------------------------------------------------------------------

  // Used by RLS policies to get the current app user without a session variable
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid
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
      $$
  `);

  // Prevents UPDATE and DELETE on audit_log (append-only enforcement)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.audit_log_immutable() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only: UPDATE and DELETE are not permitted';
      END;
      $$
  `);

  // Publishes audit_log inserts to the audit_events pg channel (gRPC streaming)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.audit_log_notify() RETURNS trigger
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
            'changed_by_name', NEW.changed_by_name,
            'source',          NEW.source,
            'created_at',      NEW.created_at
          )::text
        );
        RETURN NEW;
      END;
      $$
  `);

  // Validates that feature_flags.role_overrides has the correct structural shape.
  // Keys must be non-empty strings; values must be booleans.
  // Role name validity is enforced at the service layer against the live custom_roles table.
  // (Updated by migration 122 — MINCRM-565)
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.is_valid_role_overrides(overrides jsonb) RETURNS boolean
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
      $$
  `);

  // BEFORE UPDATE trigger function — stamps updated_at with the current clock
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        NEW.updated_at = clock_timestamp();
        RETURN NEW;
      END;
      $$
  `);

  // -------------------------------------------------------------------------
  // Grandfathered ENUM types (activities table — do not add new values)
  // Per CLAUDE.md: use varchar + CHECK for all new constrained-string columns.
  // -------------------------------------------------------------------------
  pgm.sql(`DO $$ BEGIN
    CREATE TYPE public.activity_direction AS ENUM ('Inbound', 'Outbound');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  pgm.sql(`DO $$ BEGIN
    CREATE TYPE public.activity_status AS ENUM ('open', 'complete');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  pgm.sql(`DO $$ BEGIN
    CREATE TYPE public.activity_type AS ENUM ('Note', 'Call', 'Email', 'Meeting', 'Task');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  pgm.sql(`DO $$ BEGIN
    CREATE TYPE public.automation_action_type AS ENUM ('create_task', 'send_notification');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  pgm.sql(`DO $$ BEGIN
    CREATE TYPE public.automation_log_outcome AS ENUM ('success', 'error');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  pgm.sql(`DO $$ BEGIN
    CREATE TYPE public.automation_trigger_type AS ENUM ('deal_stage_changed', 'deal_created', 'contact_created');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

  // -------------------------------------------------------------------------
  // Core tables (dependency order: no forward FK references)
  // -------------------------------------------------------------------------

  // users — authentication, roles, MFA, SSO, notification preferences
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.users (
      id                          uuid DEFAULT gen_random_uuid() NOT NULL,
      email                       character varying(255) NOT NULL,
      password_hash               text,
      name                        character varying(255) NOT NULL,
      role                        character varying(20) DEFAULT '''rep'''::character varying NOT NULL,
      status                      character varying(10) DEFAULT '''active'''::character varying NOT NULL,
      created_at                  timestamp with time zone DEFAULT now() NOT NULL,
      updated_at                  timestamp with time zone DEFAULT now() NOT NULL,
      must_change_password        boolean DEFAULT false NOT NULL,
      preferred_language          character varying(10) DEFAULT NULL::character varying,
      password_reset_token_hash   character varying(64) DEFAULT NULL::character varying,
      password_reset_expires_at   timestamp with time zone,
      password_changed_at         timestamp with time zone,
      notify_overdue_tasks        boolean DEFAULT true NOT NULL,
      notify_assignments          boolean DEFAULT true NOT NULL,
      notify_deal_stage_changes   boolean DEFAULT true NOT NULL,
      mfa_enabled                 boolean DEFAULT false NOT NULL,
      mfa_secret                  text,
      mfa_pending_secret          text,
      mfa_recovery_codes          text[] DEFAULT '{}'::text[] NOT NULL,
      onboarding_completed        boolean DEFAULT false NOT NULL,
      onboarding_completed_at     timestamp with time zone,
      sso_provider                character varying(20) DEFAULT NULL::character varying,
      sso_subject                 text,
      api_token_hash              text,
      api_token_issued_at         timestamp with time zone,
      scim_external_id            text,
      CONSTRAINT users_pkey PRIMARY KEY (id),
      CONSTRAINT users_email_key UNIQUE (email),
      CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'rep'::character varying, 'manager'::character varying, 'viewer'::character varying, 'service_account'::character varying])::text[]))),
      CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'invited'::character varying, 'inactive'::character varying])::text[]))),
      CONSTRAINT users_sso_provider_requires_subject CHECK (((sso_provider IS NULL) OR (sso_subject IS NOT NULL))),
      CONSTRAINT users_sso_subject_max_length CHECK (((sso_subject IS NULL) OR (length(sso_subject) <= 1024))),
      CONSTRAINT users_scim_external_id_key UNIQUE (scim_external_id)
    )
  `);
  pgm.sql(`COMMENT ON COLUMN public.users.sso_provider IS 'SSO protocol that provisioned this user: saml | oidc'`);
  pgm.sql(`COMMENT ON COLUMN public.users.sso_subject IS 'Stable external identity: SAML nameID or OIDC sub claim'`);

  // tags — shared tag registry used by contacts, accounts, deals, notes
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.tags (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      name       character varying(100) NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT tags_pkey PRIMARY KEY (id),
      CONSTRAINT tags_name_key UNIQUE (name)
    )
  `);

  // system_settings — key-value configuration store (MINCRM-520)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.system_settings (
      key        text NOT NULL,
      value      text NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_by uuid,
      CONSTRAINT system_settings_pkey PRIMARY KEY (key)
    )
  `);
  pgm.sql(`COMMENT ON COLUMN public.system_settings.updated_by IS 'User who last modified this setting — NULL for system/migration writes (MINCRM-520)'`);

  // currencies — multi-currency support with home-currency tracking
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.currencies (
      code           character varying(3) NOT NULL,
      name           character varying(64) NOT NULL,
      symbol         character varying(8) NOT NULL,
      rate_to_home   numeric(18,6) NOT NULL,
      is_home        boolean DEFAULT false NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT currencies_pkey PRIMARY KEY (code),
      CONSTRAINT currencies_rate_to_home_positive CHECK ((rate_to_home > (0)::numeric))
    )
  `);

  // pipelines — named deal pipelines (admin-configurable)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.pipelines (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      name       character varying(100) NOT NULL,
      is_default boolean DEFAULT false NOT NULL,
      created_by uuid,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT pipelines_pkey PRIMARY KEY (id)
    )
  `);

  // pipeline_stages — admin-configurable stages per pipeline (MINCRM-180)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.pipeline_stages (
      id                     uuid DEFAULT gen_random_uuid() NOT NULL,
      name                   character varying(100) NOT NULL,
      sort_order             integer NOT NULL,
      probability            integer DEFAULT 0 NOT NULL,
      is_terminal            boolean DEFAULT false NOT NULL,
      is_fixed               boolean DEFAULT false NOT NULL,
      created_at             timestamp with time zone DEFAULT now() NOT NULL,
      updated_at             timestamp with time zone DEFAULT now() NOT NULL,
      pipeline_id            uuid,
      stage_exit_requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
      CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id),
      CONSTRAINT pipeline_stages_probability_check CHECK (((probability >= 0) AND (probability <= 100)))
    )
  `);

  // leads — pre-conversion prospect records
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.leads (
      id                    uuid DEFAULT gen_random_uuid() NOT NULL,
      first_name            text NOT NULL,
      last_name             text,
      email                 text NOT NULL,
      phone                 text,
      company_name          text,
      lead_source           text,
      status                text DEFAULT 'New'::text NOT NULL,
      disqualification_reason text,
      notes                 text,
      owner_id              uuid NOT NULL,
      converted_at          timestamp with time zone,
      converted_contact_id  uuid,
      converted_account_id  uuid,
      converted_deal_id     uuid,
      created_at            timestamp with time zone DEFAULT now() NOT NULL,
      updated_at            timestamp with time zone DEFAULT now() NOT NULL,
      is_demo               boolean DEFAULT false NOT NULL,
      version               integer DEFAULT 1 NOT NULL,
      CONSTRAINT leads_pkey PRIMARY KEY (id),
      CONSTRAINT leads_lead_source_check CHECK ((lead_source = ANY (ARRAY['Web'::text, 'Referral'::text, 'Trade Show'::text, 'Cold Outreach'::text, 'Other'::text]))),
      CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['New'::text, 'Contacted'::text, 'Qualified'::text, 'Disqualified'::text])))
    )
  `);

  // accounts — company/organization records
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.accounts (
      id                 uuid DEFAULT gen_random_uuid() NOT NULL,
      name               character varying(255) NOT NULL,
      industry           character varying(255),
      website            character varying(255),
      employee_range     character varying(50),
      revenue_range      character varying(50),
      owner_id           uuid NOT NULL,
      created_at         timestamp with time zone DEFAULT now() NOT NULL,
      updated_at         timestamp with time zone DEFAULT now() NOT NULL,
      is_demo            boolean DEFAULT false NOT NULL,
      account_type       character varying(20),
      parent_account_id  uuid,
      version            integer DEFAULT 1 NOT NULL,
      CONSTRAINT accounts_pkey PRIMARY KEY (id),
      CONSTRAINT accounts_account_type_check CHECK (((account_type IS NULL) OR ((account_type)::text = ANY ((ARRAY['Prospect'::character varying, 'Customer'::character varying, 'Partner'::character varying, 'Vendor'::character varying, 'Competitor'::character varying, 'Other'::character varying])::text[]))))
    )
  `);

  // contacts — individual person records (may belong to an account)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.contacts (
      id               uuid DEFAULT gen_random_uuid() NOT NULL,
      first_name       character varying(255) NOT NULL,
      last_name        character varying(255) NOT NULL,
      email            character varying(255) NOT NULL,
      phone            character varying(50),
      title            character varying(255),
      department       character varying(255),
      owner_id         uuid NOT NULL,
      created_at       timestamp with time zone DEFAULT now() NOT NULL,
      updated_at       timestamp with time zone DEFAULT now() NOT NULL,
      account_id       uuid,
      is_demo          boolean DEFAULT false NOT NULL,
      source_lead_id   uuid,
      address_line1    character varying(255),
      address_line2    character varying(255),
      city             character varying(100),
      state_region     character varying(100),
      postal_code      character varying(20),
      country          character varying(100),
      linkedin_url     character varying(500),
      twitter_x_url    character varying(500),
      other_url        character varying(500),
      version          integer DEFAULT 1 NOT NULL,
      CONSTRAINT contacts_pkey PRIMARY KEY (id)
    )
  `);

  // contact_addresses — structured address rows (one-to-many, MINCRM-500)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.contact_addresses (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      contact_id     uuid NOT NULL,
      label          character varying(50),
      address_line1  character varying(255),
      address_line2  character varying(255),
      city           character varying(100),
      state_region   character varying(100),
      postal_code    character varying(20),
      country        character varying(100),
      is_default     boolean DEFAULT false NOT NULL,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT contact_addresses_pkey PRIMARY KEY (id)
    )
  `);

  // deals — sales opportunity records
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.deals (
      id                uuid DEFAULT gen_random_uuid() NOT NULL,
      name              character varying(255) NOT NULL,
      stage             character varying(50) NOT NULL,
      value             numeric(15,2),
      close_date        date,
      loss_reason       text,
      account_id        uuid,
      owner_id          uuid NOT NULL,
      created_at        timestamp with time zone DEFAULT now() NOT NULL,
      updated_at        timestamp with time zone DEFAULT now() NOT NULL,
      is_demo           boolean DEFAULT false NOT NULL,
      source_lead_id    uuid,
      probability       integer,
      currency          character varying(3) DEFAULT 'USD'::character varying NOT NULL,
      version           integer DEFAULT 1 NOT NULL,
      pipeline_id       uuid NOT NULL,
      pipeline_stage_id uuid NOT NULL,
      CONSTRAINT deals_pkey PRIMARY KEY (id),
      CONSTRAINT deals_probability_check CHECK (((probability IS NULL) OR ((probability >= 0) AND (probability <= 100))))
    )
  `);

  // activities — calls, emails, meetings, tasks, notes linked to CRM entities
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.activities (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      type       public.activity_type NOT NULL,
      subject    character varying(255) NOT NULL,
      notes      text,
      due_date   date,
      status     public.activity_status DEFAULT 'open'::public.activity_status NOT NULL,
      contact_id uuid,
      account_id uuid,
      deal_id    uuid,
      owner_id   uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      direction  public.activity_direction,
      outcome    text,
      is_demo    boolean DEFAULT false NOT NULL,
      version    integer DEFAULT 1 NOT NULL,
      metadata   jsonb,
      CONSTRAINT activities_pkey PRIMARY KEY (id),
      CONSTRAINT activities_has_parent CHECK (((contact_id IS NOT NULL) OR (account_id IS NOT NULL) OR (deal_id IS NOT NULL)))
    )
  `);

  // automation_rules — trigger/action rules evaluated on CRM events
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.automation_rules (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      name           character varying(255) NOT NULL,
      enabled        boolean DEFAULT true NOT NULL,
      trigger_type   public.automation_trigger_type NOT NULL,
      trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
      action_type    public.automation_action_type NOT NULL,
      action_config  jsonb DEFAULT '{}'::jsonb NOT NULL,
      created_by     uuid NOT NULL,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      is_demo        boolean DEFAULT false NOT NULL,
      CONSTRAINT automation_rules_pkey PRIMARY KEY (id)
    )
  `);

  // email_templates — reusable email templates for sequences and activities (MINCRM-422, MINCRM-437)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.email_templates (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      name        character varying(200) NOT NULL,
      category    character varying(50) NOT NULL,
      subject     character varying(500) NOT NULL,
      body        text NOT NULL,
      merge_tags  jsonb DEFAULT '[]'::jsonb NOT NULL,
      enabled     boolean DEFAULT true NOT NULL,
      created_by  uuid,
      created_at  timestamp with time zone DEFAULT now() NOT NULL,
      updated_at  timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT email_templates_pkey PRIMARY KEY (id),
      CONSTRAINT email_templates_name_key UNIQUE (name)
    )
  `);

  // automation_rule_logs — execution history for automation rules (MINCRM-516)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.automation_rule_logs (
      id                     uuid DEFAULT gen_random_uuid() NOT NULL,
      rule_id                uuid NOT NULL,
      triggered_at           timestamp with time zone DEFAULT now() NOT NULL,
      triggering_record_type character varying(50) NOT NULL,
      triggering_record_id   uuid NOT NULL,
      outcome                public.automation_log_outcome NOT NULL,
      error_message          text,
      action_config_snapshot jsonb,
      CONSTRAINT automation_rule_logs_pkey PRIMARY KEY (id)
    ) WITH (autovacuum_vacuum_scale_factor='0.05')
  `);
  pgm.sql(`COMMENT ON COLUMN public.automation_rule_logs.triggering_record_type IS 'Entity type that caused the automation rule to fire. Valid values: ''deal'', ''contact''. Enforced at the service layer via AutomationTriggerContext in server/src/services/automationService.ts. Not a CHECK constraint — see migration 083 for rationale (mirrors the audit_log approach from migration 076).'`);

  // attachments — file metadata for CRM entity records (polymorphic, MINCRM-510)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.attachments (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      record_type text NOT NULL,
      record_id   uuid NOT NULL,
      filename    text NOT NULL,
      file_size   bigint NOT NULL,
      mime_type   text NOT NULL,
      storage_key text NOT NULL,
      uploader_id uuid,
      uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT attachments_pkey PRIMARY KEY (id),
      CONSTRAINT attachments_storage_key_key UNIQUE (storage_key),
      CONSTRAINT attachments_record_type_check CHECK ((record_type = ANY (ARRAY['contact'::text, 'account'::text, 'deal'::text, 'lead'::text])))
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.attachments IS 'File attachment metadata for CRM entity records. record_type + record_id form a polymorphic reference — no FK constraint exists because PostgreSQL FKs cannot span multiple parent tables. Valid record_type values: ''contact'', ''account'', ''deal'', ''lead'' (extended in migration 047). Orphan cleanup is the application''s responsibility: rows whose record_id no longer exists in the referenced entity table should be deleted when the parent is removed. The physical file (storage_key) must be deleted from object storage before or alongside the row. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);

  // audit_log — append-only, monthly range-partitioned (MINCRM-521)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.audit_log (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      record_type    text NOT NULL,
      record_id      uuid,
      record_name    text,
      event_type     text NOT NULL,
      field_name     text,
      old_value      text,
      new_value      text,
      changed_by_id  uuid,
      changed_by_name text,
      source         varchar(20) DEFAULT NULL CONSTRAINT audit_log_source_check CHECK (source IN ('AI (NLI)', 'AI (context)')),
      created_at     timestamp with time zone DEFAULT now() NOT NULL
    ) PARTITION BY RANGE (created_at)
  `);
  pgm.sql(`COMMENT ON TABLE public.audit_log IS 'Append-only audit trail, partitioned monthly by created_at (MINCRM-521). Valid record_type values: contact, account, deal, lead, activity, user, system_settings, custom_report, sequence, sequence_enrollment, feature_flag, ai_settings. Valid event_type values: created, updated, deleted, login, logout, password_changed, role_changed, deactivated, reactivated, ownership_reassigned, merged, note_created, note_updated, note_deleted, note_visibility_changed, gdpr_erasure, mfa_enabled, mfa_disabled, sso_login, sso_provisioned, sso_linked, sso_unlinked. Enforced at service layer via AuditRecordType and AuditEventType TypeScript unions in server/src/services/auditService.ts. Partition naming: audit_log_y{YYYY}m{MM}. Default partition: audit_log_default. Future partitions created by auditPartitionService.ensureAuditLogPartitions().'`);

  // audit_log partitions — default + current calendar months
  // auditPartitionService.ensureAuditLogPartitions() manages future partitions at runtime
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

  // overdue_task_notifications — dedup guard for email digests
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.overdue_task_notifications (
      activity_id uuid NOT NULL,
      notified_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT overdue_task_notifications_pkey PRIMARY KEY (activity_id)
    )
  `);

  // notes — rich notes with soft-delete and polymorphic entity reference (MINCRM-510)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.notes (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      entity_type character varying(16) NOT NULL,
      entity_id   uuid NOT NULL,
      title       character varying(255),
      body        text NOT NULL,
      body_text   text,
      visibility  character varying(8) DEFAULT 'team'::character varying NOT NULL,
      tags        text[] DEFAULT '{}'::text[] NOT NULL,
      created_by  uuid NOT NULL,
      updated_by  uuid,
      created_at  timestamp with time zone DEFAULT now() NOT NULL,
      updated_at  timestamp with time zone DEFAULT now() NOT NULL,
      deleted_at  timestamp with time zone,
      CONSTRAINT notes_pkey PRIMARY KEY (id),
      CONSTRAINT notes_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['contact'::character varying, 'account'::character varying, 'deal'::character varying, 'lead'::character varying])::text[]))),
      CONSTRAINT notes_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'team'::character varying, 'public'::character varying])::text[])))
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.notes IS 'Rich notes attached to CRM entity records, with soft-delete support. entity_type + entity_id form a polymorphic reference — no FK constraint exists because PostgreSQL FKs cannot span multiple parent tables. Valid entity_type values: ''contact'', ''account'', ''deal'', ''lead''. Soft-deleted rows (deleted_at IS NOT NULL) are excluded from application queries but remain in the table; the partial GIN index on body_text also excludes them. Hard orphan cleanup (rows whose entity_id no longer exists) is the application''s responsibility. Soft-deleted orphans are harmless but may be purged by a periodic maintenance query. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);

  // note_tags — junction table linking notes to the shared tags registry (MINCRM-506)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.note_tags (
      note_id uuid NOT NULL,
      tag_id  uuid NOT NULL,
      CONSTRAINT note_tags_pkey PRIMARY KEY (note_id, tag_id)
    )
  `);

  // custom_field_definitions — admin-defined EAV schema (ADR-002)
  // pii_excluded added by migration 125 (MINCRM-422)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
      id           uuid DEFAULT gen_random_uuid() NOT NULL,
      entity_type  character varying(16) NOT NULL,
      name         character varying(100) NOT NULL,
      field_type   character varying(16) NOT NULL,
      options      jsonb,
      sort_order   integer DEFAULT 0 NOT NULL,
      pii_excluded boolean DEFAULT false NOT NULL,
      created_at   timestamp with time zone DEFAULT now() NOT NULL,
      updated_at   timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT custom_field_definitions_pkey PRIMARY KEY (id),
      CONSTRAINT custom_field_definitions_entity_type_name_key UNIQUE (entity_type, name),
      CONSTRAINT custom_field_definitions_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['contact'::character varying, 'account'::character varying, 'deal'::character varying])::text[]))),
      CONSTRAINT custom_field_definitions_field_type_check CHECK (((field_type)::text = ANY ((ARRAY['text'::character varying, 'number'::character varying, 'date'::character varying, 'boolean'::character varying, 'select'::character varying])::text[])))
    )
  `);

  // custom_field_values — EAV values (polymorphic record_id, MINCRM-510)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.custom_field_values (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      definition_id uuid NOT NULL,
      record_id     uuid NOT NULL,
      value         text,
      created_at    timestamp with time zone DEFAULT now() NOT NULL,
      updated_at    timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT custom_field_values_pkey PRIMARY KEY (id),
      CONSTRAINT custom_field_values_definition_id_record_id_key UNIQUE (definition_id, record_id)
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.custom_field_values IS 'Values for admin-defined custom fields on CRM entity records. record_id is a polymorphic reference to the entity row identified by the associated custom_field_definitions.entity_type — no FK constraint is possible because the parent table varies per definition. Valid entity_type values (on custom_field_definitions): ''contact'', ''account'', ''deal''. definition_id has a real FK with ON DELETE CASCADE — deleting a field definition removes all its values automatically. Orphan cleanup: rows whose record_id no longer exists in the parent entity table accumulate silently when the entity is deleted. Application must delete custom_field_values rows alongside entity deletion. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);

  // webhook_subscriptions — registered webhook endpoints
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      url         text NOT NULL,
      events      text[] NOT NULL,
      secret_hash text NOT NULL,
      status      character varying(16) DEFAULT 'active'::character varying NOT NULL,
      created_by  uuid,
      created_at  timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT webhook_subscriptions_pkey PRIMARY KEY (id),
      CONSTRAINT webhook_subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'failed'::character varying, 'disabled'::character varying])::text[])))
    )
  `);

  // webhook_delivery_logs — per-delivery attempt records (MINCRM-522, 30-day retention)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.webhook_delivery_logs (
      id              uuid DEFAULT gen_random_uuid() NOT NULL,
      subscription_id uuid,
      event_id        uuid NOT NULL,
      event_type      character varying(64) NOT NULL,
      attempt         integer DEFAULT 1 NOT NULL,
      status_code     integer,
      response_ms     integer,
      error           text,
      delivered_at    timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT webhook_delivery_logs_pkey PRIMARY KEY (id)
    ) WITH (autovacuum_vacuum_scale_factor='0.05')
  `);

  // import_jobs — CSV import tracking (MINCRM-522, 180-day retention for complete/failed)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.import_jobs (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      type           character varying(16) NOT NULL,
      status         character varying(16) DEFAULT 'pending'::character varying NOT NULL,
      total_rows     integer,
      processed_rows integer DEFAULT 0 NOT NULL,
      created_count  integer DEFAULT 0 NOT NULL,
      skipped_count  integer DEFAULT 0 NOT NULL,
      failed_count   integer DEFAULT 0 NOT NULL,
      error_csv      text,
      created_by     uuid,
      started_at     timestamp with time zone,
      completed_at   timestamp with time zone,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT import_jobs_pkey PRIMARY KEY (id)
    )
  `);

  // gdpr_deletion_log — Art. 17 erasure tracking (MINCRM-517, retained indefinitely)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.gdpr_deletion_log (
      id           uuid DEFAULT gen_random_uuid() NOT NULL,
      record_type  text NOT NULL,
      record_id    uuid NOT NULL,
      requested_by uuid NOT NULL,
      requested_at timestamp with time zone DEFAULT now() NOT NULL,
      completed_at timestamp with time zone,
      erasure_scope text[] NOT NULL,
      notes        text,
      CONSTRAINT gdpr_deletion_log_pkey PRIMARY KEY (id)
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.gdpr_deletion_log IS 'Append-only log of GDPR Art. 17 erasure requests (one row per erased record). The UNIQUE index on (record_type, record_id) is safe because all record_id values are UUIDs generated by gen_random_uuid() at row-creation time — re-imports always receive a new UUID. If deterministic external IDs are ever introduced this constraint must be revisited. See migration 084 for full rationale. (MINCRM-517) No FK constraint on record_id — the referenced row is hard-deleted during erasure. Rows are retained indefinitely by design; orphan cleanup does not apply. See CLAUDE.md — Polymorphic FK Pattern. (MINCRM-510)'`);
  pgm.sql(`COMMENT ON COLUMN public.gdpr_deletion_log.record_id IS 'UUID of the erased record. References the PK of the entity identified by record_type. No FK constraint — the referenced row will have been hard-deleted before or during erasure. UNIQUE constraint assumption: safe only while all record IDs are gen_random_uuid() UUIDs. See migration 084 if deterministic external IDs are introduced.'`);

  // lead_status_history — audit trail for lead status transitions
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.lead_status_history (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      lead_id        uuid NOT NULL,
      from_status    text,
      to_status      text NOT NULL,
      changed_by_id  uuid,
      changed_by_name text,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT lead_status_history_pkey PRIMARY KEY (id)
    )
  `);

  // junction tables — contact_tags, account_tags, deal_tags, deal_contacts
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.contact_tags (
      contact_id uuid NOT NULL,
      tag_id     uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT contact_tags_pkey PRIMARY KEY (contact_id, tag_id)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.account_tags (
      account_id uuid NOT NULL,
      tag_id     uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT account_tags_pkey PRIMARY KEY (account_id, tag_id)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.deal_tags (
      deal_id    uuid NOT NULL,
      tag_id     uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT deal_tags_pkey PRIMARY KEY (deal_id, tag_id)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.deal_contacts (
      deal_id    uuid NOT NULL,
      contact_id uuid NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT deal_contacts_pkey PRIMARY KEY (deal_id, contact_id)
    )
  `);

  // custom_reports — user-saved report configurations
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.custom_reports (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      name        character varying(200) NOT NULL,
      entity_type character varying(16) NOT NULL,
      config      jsonb NOT NULL,
      created_by  uuid,
      created_at  timestamp with time zone DEFAULT now() NOT NULL,
      updated_at  timestamp with time zone DEFAULT now() NOT NULL,
      visibility  character varying(16) DEFAULT 'public'::character varying NOT NULL,
      CONSTRAINT custom_reports_pkey PRIMARY KEY (id),
      CONSTRAINT custom_reports_name_key UNIQUE (name),
      CONSTRAINT custom_reports_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['contact'::character varying, 'account'::character varying, 'deal'::character varying, 'lead'::character varying, 'activity'::character varying])::text[]))),
      CONSTRAINT custom_reports_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'public_read_only'::character varying, 'public'::character varying])::text[])))
    )
  `);

  // sales_sequences — outreach sequence definitions
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.sales_sequences (
      id          uuid DEFAULT gen_random_uuid() NOT NULL,
      name        character varying(200) NOT NULL,
      description text,
      enabled     boolean DEFAULT true NOT NULL,
      created_by  uuid,
      created_at  timestamp with time zone DEFAULT now() NOT NULL,
      updated_at  timestamp with time zone DEFAULT now() NOT NULL,
      is_demo     boolean DEFAULT false NOT NULL,
      CONSTRAINT sales_sequences_pkey PRIMARY KEY (id)
    )
  `);

  // sales_sequence_steps — ordered steps within a sequence
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.sales_sequence_steps (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      sequence_id   uuid NOT NULL,
      sort_order    integer NOT NULL,
      action_type   character varying(32) NOT NULL,
      action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
      delay_days    integer DEFAULT 0 NOT NULL,
      created_at    timestamp with time zone DEFAULT now() NOT NULL,
      updated_at    timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sales_sequence_steps_pkey PRIMARY KEY (id),
      CONSTRAINT uq_sequence_sort_order UNIQUE (sequence_id, sort_order),
      CONSTRAINT sales_sequence_steps_action_type_check CHECK (((action_type)::text = ANY ((ARRAY['send_email'::character varying, 'log_call_reminder'::character varying, 'create_task'::character varying])::text[]))),
      CONSTRAINT sales_sequence_steps_delay_days_check CHECK ((delay_days >= 0))
    )
  `);

  // sequence_enrollments — contact enrollment in a sequence
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
      id              uuid DEFAULT gen_random_uuid() NOT NULL,
      sequence_id     uuid NOT NULL,
      contact_id      uuid NOT NULL,
      enrolled_by_id  uuid,
      enrolled_at     timestamp with time zone DEFAULT now() NOT NULL,
      status          character varying(16) DEFAULT '''active'''::character varying NOT NULL,
      current_step_id uuid,
      next_action_at  timestamp with time zone,
      unenrolled_at   timestamp with time zone,
      created_at      timestamp with time zone DEFAULT now() NOT NULL,
      updated_at      timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT sequence_enrollments_pkey PRIMARY KEY (id),
      CONSTRAINT sequence_enrollments_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'unenrolled'::character varying])::text[])))
    )
  `);

  // sequence_enrollment_logs — per-step execution log (retained indefinitely)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.sequence_enrollment_logs (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      enrollment_id uuid NOT NULL,
      step_id       uuid,
      executed_at   timestamp with time zone DEFAULT now() NOT NULL,
      action_type   character varying(32) NOT NULL,
      outcome       character varying(8) NOT NULL,
      error_message text,
      CONSTRAINT sequence_enrollment_logs_pkey PRIMARY KEY (id),
      CONSTRAINT sequence_enrollment_logs_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['success'::character varying, 'skipped'::character varying, 'error'::character varying])::text[])))
    )
  `);

  // feature_flags — feature gating with per-role overrides (MINCRM-511)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.feature_flags (
      flag_key           character varying(100) NOT NULL,
      label              character varying(100) NOT NULL,
      description        text NOT NULL,
      category           character varying(50) NOT NULL,
      enabled            boolean DEFAULT true NOT NULL,
      role_overrides     jsonb,
      enable_at          timestamp with time zone,
      rollout_percentage smallint,
      rollout_stages     jsonb,
      updated_by         uuid,
      updated_at         timestamp with time zone DEFAULT now() NOT NULL,
      system_flag        boolean DEFAULT true NOT NULL,
      CONSTRAINT feature_flags_pkey PRIMARY KEY (flag_key),
      CONSTRAINT feature_flags_role_overrides_valid_shape CHECK (public.is_valid_role_overrides(role_overrides)),
      CONSTRAINT feature_flags_rollout_percentage_range CHECK (rollout_percentage BETWEEN 0 AND 100)
    )
  `);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.role_overrides IS 'Per-role enable/disable overrides. Keys are arbitrary role name strings (built-in or custom); values are booleans. Role name validity enforced at service layer against custom_roles table. (MINCRM-565)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.enable_at IS 'When set and <= now(), the flag is treated as enabled regardless of the enabled column. Evaluated lazily at resolution time — no background job required. (MINCRM-488)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.rollout_percentage IS 'When non-null, gates users via stableHash(userId+flagKey)%100 < rollout_percentage. null skips rollout gating entirely. 100 means all users are enabled. (MINCRM-490)'`);
  pgm.sql(`COMMENT ON COLUMN public.feature_flags.rollout_stages IS 'Ordered array of {percentage, scheduled_at} objects. Background scheduler advances rollout_percentage when scheduled_at <= now(). (MINCRM-490)'`);

  // feature_flag_usage — per-user flag usage tracking
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.feature_flag_usage (
      flag_key character varying(100) NOT NULL,
      user_id  uuid NOT NULL,
      used_at  timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT pk_feature_flag_usage PRIMARY KEY (flag_key, user_id)
    )
  `);

  // feature_flag_beta_users — user-level targeting for feature flags (MINCRM-489)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.feature_flag_beta_users (
      id        uuid DEFAULT gen_random_uuid() NOT NULL,
      flag_key  character varying(100) NOT NULL,
      user_id   uuid NOT NULL,
      added_by  uuid,
      added_at  timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT feature_flag_beta_users_pkey PRIMARY KEY (id),
      CONSTRAINT feature_flag_beta_users_flag_key_user_id_unique UNIQUE (flag_key, user_id)
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_beta_users_flag_key_index ON public.feature_flag_beta_users USING btree (flag_key)`);

  // feature_flag_user_overrides — absolute per-user force-on / force-off overrides (MINCRM-492)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.feature_flag_user_overrides (
      id        uuid DEFAULT gen_random_uuid() NOT NULL,
      flag_key  character varying(100) NOT NULL,
      user_id   uuid NOT NULL,
      override  character varying(20) NOT NULL,
      reason    text,
      added_by  uuid,
      added_at  timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT feature_flag_user_overrides_pkey PRIMARY KEY (id),
      CONSTRAINT feature_flag_user_overrides_flag_key_user_id_unique UNIQUE (flag_key, user_id),
      CONSTRAINT feature_flag_user_overrides_override_check CHECK (override IN ('force_enabled', 'force_disabled'))
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_user_overrides_flag_key_index ON public.feature_flag_user_overrides USING btree (flag_key)`);

  // ai_configuration — singleton AI provider config (MINCRM-519 key versioning)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_configuration (
      singleton                        boolean DEFAULT true NOT NULL,
      provider                         character varying(50) DEFAULT 'anthropic'::character varying NOT NULL,
      model                            character varying(100) DEFAULT 'claude-sonnet-4-20250514'::character varying NOT NULL,
      api_key_encrypted                text DEFAULT ''::text NOT NULL,
      deployment_mode                  character varying(30) DEFAULT 'cloud_api'::character varying NOT NULL,
      base_url                         text DEFAULT ''::text NOT NULL,
      enabled                          boolean DEFAULT false NOT NULL,
      enabled_updated_at               timestamp with time zone,
      dpa_acknowledged                 boolean DEFAULT false NOT NULL,
      dpa_acknowledged_by              uuid,
      dpa_acknowledged_at              timestamp with time zone,
      dpa_acknowledged_for_provider    character varying(50) DEFAULT ''::character varying NOT NULL,
      custom_dpa_url                   text DEFAULT ''::text NOT NULL,
      updated_at                       timestamp with time zone DEFAULT now() NOT NULL,
      updated_by                       uuid,
      api_key_key_version              smallint DEFAULT 1 NOT NULL,
      CONSTRAINT ai_configuration_singleton CHECK (singleton),
      CONSTRAINT ai_configuration_singleton_unique UNIQUE (singleton)
    )
  `);
  pgm.sql(`COMMENT ON COLUMN public.ai_configuration.api_key_key_version IS 'Key version used to encrypt api_key_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)'`);

  // smtp_configuration — singleton SMTP config (MINCRM-519 key versioning)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.smtp_configuration (
      singleton         boolean DEFAULT true NOT NULL,
      host              character varying(255) DEFAULT ''::character varying NOT NULL,
      port              integer DEFAULT 587 NOT NULL,
      username          character varying(255) DEFAULT ''::character varying NOT NULL,
      pass_encrypted    text DEFAULT ''::text NOT NULL,
      enabled           boolean DEFAULT false NOT NULL,
      updated_at        timestamp with time zone DEFAULT now() NOT NULL,
      pass_key_version  smallint DEFAULT 1 NOT NULL,
      CONSTRAINT smtp_configuration_singleton CHECK (singleton),
      CONSTRAINT smtp_configuration_singleton_unique UNIQUE (singleton)
    )
  `);
  pgm.sql(`COMMENT ON COLUMN public.smtp_configuration.pass_key_version IS 'Key version used to encrypt pass_encrypted. References ENCRYPTION_KEY_V<n> env var (MINCRM-519)'`);

  // ai_token_budgets — per-user or org-level AI token limits
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_token_budgets (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id       uuid,
      monthly_limit bigint NOT NULL,
      created_at    timestamp with time zone DEFAULT now() NOT NULL,
      updated_at    timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT ai_token_budgets_pkey PRIMARY KEY (id)
    )
  `);

  // ai_token_usage — monthly token usage aggregates per user
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_token_usage (
      user_id      uuid NOT NULL,
      year_month   character(7) NOT NULL,
      input_tokens  bigint DEFAULT 0 NOT NULL,
      output_tokens bigint DEFAULT 0 NOT NULL,
      updated_at   timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT ai_token_usage_pkey PRIMARY KEY (user_id, year_month)
    )
  `);

  // ai_sessions — multi-session AI conversation persistence (MINCRM-421)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_sessions (
      id         uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id    uuid NOT NULL,
      name       character varying(255),
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT ai_sessions_pkey PRIMARY KEY (id)
    )
  `);

  // ai_messages — ordered message log for each ai_session (MINCRM-421, MINCRM-423, MINCRM-431)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.ai_messages (
      id           uuid DEFAULT gen_random_uuid() NOT NULL,
      session_id   uuid NOT NULL,
      role         character varying(20) NOT NULL,
      content      text NOT NULL,
      tool_results jsonb DEFAULT NULL,
      created_at   timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT ai_messages_pkey PRIMARY KEY (id),
      CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant'))
    )
  `);

  // currency_rate_history — immutable rate audit log (MINCRM-526)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.currency_rate_history (
      id              uuid DEFAULT gen_random_uuid() NOT NULL,
      code            character varying(3) NOT NULL,
      rate_to_home    numeric(18,6) NOT NULL,
      effective_from  timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT currency_rate_history_pkey PRIMARY KEY (id),
      CONSTRAINT currency_rate_history_rate_positive CHECK ((rate_to_home > (0)::numeric))
    )
  `);

  // -------------------------------------------------------------------------
  // Additional constraints (added after all tables exist to avoid FK ordering)
  // Each is wrapped in DO/EXCEPTION so the baseline is safe to run on existing
  // databases where the constraint already exists (duplicate_object = sqlstate 42710).
  // -------------------------------------------------------------------------

  const constraints = [
    // audit_log PK — omit ONLY so the constraint propagates to all existing partitions automatically
    `ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id, created_at)`,
    `ALTER TABLE ONLY public.system_settings ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.pipelines ADD CONSTRAINT pipelines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.pipeline_stages ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_converted_contact_id_fkey FOREIGN KEY (converted_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_converted_account_id_fkey FOREIGN KEY (converted_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_converted_deal_id_fkey FOREIGN KEY (converted_deal_id) REFERENCES public.deals(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.deals ADD CONSTRAINT deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.deals ADD CONSTRAINT deals_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.deals ADD CONSTRAINT deals_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.deals ADD CONSTRAINT deals_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.deals ADD CONSTRAINT deals_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.activities ADD CONSTRAINT activities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.activities ADD CONSTRAINT activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.activities ADD CONSTRAINT activities_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.activities ADD CONSTRAINT activities_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.email_templates ADD CONSTRAINT email_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.automation_rules ADD CONSTRAINT automation_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE RESTRICT`,
    `ALTER TABLE ONLY public.automation_rule_logs ADD CONSTRAINT automation_rule_logs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.attachments ADD CONSTRAINT attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.contact_addresses ADD CONSTRAINT contact_addresses_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.contact_tags ADD CONSTRAINT contact_tags_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.contact_tags ADD CONSTRAINT contact_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.account_tags ADD CONSTRAINT account_tags_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.account_tags ADD CONSTRAINT account_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.deal_tags ADD CONSTRAINT deal_tags_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.deal_tags ADD CONSTRAINT deal_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.deal_contacts ADD CONSTRAINT deal_contacts_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.deal_contacts ADD CONSTRAINT deal_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)`,
    `ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id)`,
    `ALTER TABLE ONLY public.note_tags ADD CONSTRAINT note_tags_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.note_tags ADD CONSTRAINT note_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.custom_field_values ADD CONSTRAINT custom_field_values_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.overdue_task_notifications ADD CONSTRAINT overdue_task_notifications_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.webhook_delivery_logs ADD CONSTRAINT webhook_delivery_logs_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.import_jobs ADD CONSTRAINT import_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.gdpr_deletion_log ADD CONSTRAINT gdpr_deletion_log_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id)`,
    `ALTER TABLE ONLY public.lead_status_history ADD CONSTRAINT lead_status_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.custom_reports ADD CONSTRAINT custom_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.sales_sequences ADD CONSTRAINT sales_sequences_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.sales_sequence_steps ADD CONSTRAINT sales_sequence_steps_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sales_sequences(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sales_sequences(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_enrolled_by_id_fkey FOREIGN KEY (enrolled_by_id) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_current_step_id_fkey FOREIGN KEY (current_step_id) REFERENCES public.sales_sequence_steps(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.sequence_enrollment_logs ADD CONSTRAINT sequence_enrollment_logs_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.sequence_enrollment_logs ADD CONSTRAINT sequence_enrollment_logs_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.sales_sequence_steps(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.feature_flags ADD CONSTRAINT feature_flags_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.feature_flag_usage ADD CONSTRAINT feature_flag_usage_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES public.feature_flags(flag_key) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.feature_flag_usage ADD CONSTRAINT feature_flag_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.feature_flag_beta_users ADD CONSTRAINT feature_flag_beta_users_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES public.feature_flags(flag_key) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.feature_flag_beta_users ADD CONSTRAINT feature_flag_beta_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.feature_flag_beta_users ADD CONSTRAINT feature_flag_beta_users_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.feature_flag_user_overrides ADD CONSTRAINT feature_flag_user_overrides_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES public.feature_flags(flag_key) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.feature_flag_user_overrides ADD CONSTRAINT feature_flag_user_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.feature_flag_user_overrides ADD CONSTRAINT feature_flag_user_overrides_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.ai_configuration ADD CONSTRAINT ai_configuration_dpa_acknowledged_by_fkey FOREIGN KEY (dpa_acknowledged_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.ai_configuration ADD CONSTRAINT ai_configuration_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL`,
    `ALTER TABLE ONLY public.ai_token_budgets ADD CONSTRAINT ai_token_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.ai_token_usage ADD CONSTRAINT ai_token_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.ai_sessions ADD CONSTRAINT ai_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    `ALTER TABLE ONLY public.ai_messages ADD CONSTRAINT ai_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_sessions(id) ON DELETE CASCADE`,
  ];

  for (const constraint of constraints) {
    pgm.sql(`DO $$ BEGIN ${constraint}; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$`);
  }

  // -------------------------------------------------------------------------
  // Indexes
  // -------------------------------------------------------------------------

  // users
  pgm.sql(`CREATE INDEX IF NOT EXISTS users_email_index ON public.users USING btree (email)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS users_password_reset_token_hash_idx ON public.users USING btree (password_reset_token_hash) WHERE (password_reset_token_hash IS NOT NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS users_sso_provider_sso_subject_unique ON public.users USING btree (sso_provider, sso_subject) WHERE (sso_subject IS NOT NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS users_api_token_hash_unique ON public.users USING btree (api_token_hash) WHERE (api_token_hash IS NOT NULL)`);

  // contacts
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique_index ON public.contacts USING btree (email)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_owner_id_index ON public.contacts USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_account_id_index ON public.contacts USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_is_demo_index ON public.contacts USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_first_name_trgm_idx ON public.contacts USING gin (first_name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_last_name_trgm_idx ON public.contacts USING gin (last_name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS contacts_email_trgm_idx ON public.contacts USING gin (email public.gin_trgm_ops)`);

  // contact_addresses
  pgm.sql(`CREATE INDEX IF NOT EXISTS contact_addresses_contact_id_index ON public.contact_addresses USING btree (contact_id)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS contact_addresses_one_default_per_contact ON public.contact_addresses USING btree (contact_id) WHERE (is_default = true)`);

  // accounts
  pgm.sql(`CREATE INDEX IF NOT EXISTS accounts_owner_id_index ON public.accounts USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS accounts_is_demo_index ON public.accounts USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS accounts_name_trgm_idx ON public.accounts USING gin (name public.gin_trgm_ops)`);

  // deals
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_owner_id_index ON public.deals USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_account_id_index ON public.deals USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_is_demo_index ON public.deals USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_stage_index ON public.deals USING btree (stage)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_close_date_index ON public.deals USING btree (close_date)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_stage_close_date_idx ON public.deals USING btree (stage, close_date)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_name_trgm_idx ON public.deals USING gin (name public.gin_trgm_ops)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_pipeline_id_idx ON public.deals USING btree (pipeline_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deals_pipeline_stage_id_idx ON public.deals USING btree (pipeline_stage_id)`);

  // leads
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_owner_id_index ON public.leads USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_email_index ON public.leads USING btree (email)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_status_index ON public.leads USING btree (status)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_is_demo_index ON public.leads USING btree (is_demo)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_created_at_index ON public.leads USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS leads_converted_at_idx ON public.leads USING btree (converted_at) WHERE (converted_at IS NOT NULL)`);

  // activities
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_owner_id_index ON public.activities USING btree (owner_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_contact_id_index ON public.activities USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_account_id_index ON public.activities USING btree (account_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_deal_id_index ON public.activities USING btree (deal_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS activities_is_demo_index ON public.activities USING btree (is_demo)`);

  // pipeline_stages
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_pipeline_name_lower_unique ON public.pipeline_stages USING btree (pipeline_id, lower((name)::text))`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_pipeline_sort_order_unique ON public.pipeline_stages USING btree (pipeline_id, sort_order)`);

  // pipelines
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipelines_name_lower_unique ON public.pipelines USING btree (lower((name)::text))`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS pipelines_single_default_idx ON public.pipelines USING btree (is_default) WHERE (is_default = true)`);

  // automation_rules
  // email_templates indexes
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_templates_category_index ON public.email_templates USING btree (category)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS email_templates_enabled_index ON public.email_templates USING btree (enabled)`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rules_enabled_index ON public.automation_rules USING btree (enabled)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rules_trigger_type_index ON public.automation_rules USING btree (trigger_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rules_is_demo_index ON public.automation_rules USING btree (is_demo)`);

  // automation_rule_logs (MINCRM-082 autovacuum tuning)
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rule_logs_rule_id_triggered_at_index ON public.automation_rule_logs USING btree (rule_id, triggered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rule_logs_triggered_at_idx ON public.automation_rule_logs USING btree (triggered_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS automation_rule_logs_outcome_idx ON public.automation_rule_logs USING btree (outcome) WHERE (outcome = 'error'::public.automation_log_outcome)`);

  // attachments
  pgm.sql(`CREATE INDEX IF NOT EXISTS attachments_record_type_record_id_index ON public.attachments USING btree (record_type, record_id)`);

  // audit_log (partitioned indexes — parent + per-partition clones)
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_record_type_record_id_index ON ONLY public.audit_log USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_event_type_index ON ONLY public.audit_log USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_created_at_index ON ONLY public.audit_log USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_changed_by_id_index ON ONLY public.audit_log USING btree (changed_by_id)`);

  // audit_log partition indexes and attachments
  for (const [suffix, month] of [
    ['y2026m06', '2026m06'], ['y2026m07', '2026m07'], ['y2026m08', '2026m08'],
    ['y2026m09', '2026m09'], ['y2026m10', '2026m10'], ['y2026m11', '2026m11'],
  ]) {
    pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_${suffix}_record_type_record_id_idx ON public.audit_log_${suffix} USING btree (record_type, record_id)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_${suffix}_event_type_idx ON public.audit_log_${suffix} USING btree (event_type)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_${suffix}_created_at_idx ON public.audit_log_${suffix} USING btree (created_at)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_${suffix}_changed_by_id_idx ON public.audit_log_${suffix} USING btree (changed_by_id)`);
    pgm.sql(`ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_${suffix}_record_type_record_id_idx`);
    pgm.sql(`ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_${suffix}_event_type_idx`);
    pgm.sql(`ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_${suffix}_created_at_idx`);
    pgm.sql(`ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_${suffix}_changed_by_id_idx`);
  }
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_record_type_record_id_idx ON public.audit_log_default USING btree (record_type, record_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_event_type_idx ON public.audit_log_default USING btree (event_type)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_created_at_idx ON public.audit_log_default USING btree (created_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS audit_log_default_changed_by_id_idx ON public.audit_log_default USING btree (changed_by_id)`);
  pgm.sql(`ALTER INDEX public.audit_log_record_type_record_id_index ATTACH PARTITION public.audit_log_default_record_type_record_id_idx`);
  pgm.sql(`ALTER INDEX public.audit_log_event_type_index ATTACH PARTITION public.audit_log_default_event_type_idx`);
  pgm.sql(`ALTER INDEX public.audit_log_created_at_index ATTACH PARTITION public.audit_log_default_created_at_idx`);
  pgm.sql(`ALTER INDEX public.audit_log_changed_by_id_index ATTACH PARTITION public.audit_log_default_changed_by_id_idx`);

  // notes
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_entity_idx ON public.notes USING btree (entity_type, entity_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_entity_active_idx ON public.notes USING btree (entity_type, entity_id) WHERE (deleted_at IS NULL)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_created_by_idx ON public.notes USING btree (created_by)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS notes_body_text_trgm_idx ON public.notes USING gin (body_text public.gin_trgm_ops) WHERE (deleted_at IS NULL)`);

  // note_tags
  pgm.sql(`CREATE INDEX IF NOT EXISTS note_tags_tag_id_index ON public.note_tags USING btree (tag_id)`);

  // tags (junction tables)
  pgm.sql(`CREATE INDEX IF NOT EXISTS contact_tags_tag_id_index ON public.contact_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS account_tags_tag_id_index ON public.account_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_tags_tag_id_index ON public.deal_tags USING btree (tag_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS deal_contacts_contact_id_index ON public.deal_contacts USING btree (contact_id)`);

  // currencies
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS currencies_home_idx ON public.currencies USING btree (is_home) WHERE (is_home = true)`);

  // custom_field_values
  pgm.sql(`CREATE INDEX IF NOT EXISTS custom_field_values_record_id_index ON public.custom_field_values USING btree (record_id)`);

  // webhook_delivery_logs (MINCRM-082 autovacuum tuning)
  pgm.sql(`CREATE INDEX IF NOT EXISTS webhook_delivery_logs_subscription_id_index ON public.webhook_delivery_logs USING btree (subscription_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS webhook_delivery_logs_event_id_index ON public.webhook_delivery_logs USING btree (event_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS webhook_delivery_logs_delivered_at_idx ON public.webhook_delivery_logs USING btree (delivered_at)`);

  // import_jobs
  pgm.sql(`CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON public.import_jobs USING btree (status)`);

  // gdpr_deletion_log (MINCRM-517 unique constraint assumption)
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS gdpr_deletion_log_record_idx ON public.gdpr_deletion_log USING btree (record_type, record_id)`);

  // lead_status_history
  pgm.sql(`CREATE INDEX IF NOT EXISTS lead_status_history_lead_id_index ON public.lead_status_history USING btree (lead_id)`);

  // custom_reports
  pgm.sql(`CREATE INDEX IF NOT EXISTS custom_reports_created_by_index ON public.custom_reports USING btree (created_by)`);

  // sales_sequences
  pgm.sql(`CREATE INDEX IF NOT EXISTS sales_sequences_created_by_index ON public.sales_sequences USING btree (created_by)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sales_sequence_steps_sequence_id_index ON public.sales_sequence_steps USING btree (sequence_id)`);

  // sequence_enrollments
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_sequence_id_index ON public.sequence_enrollments USING btree (sequence_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_contact_id_index ON public.sequence_enrollments USING btree (contact_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_next_action_at_index ON public.sequence_enrollments USING btree (next_action_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollments_status_next_action_idx ON public.sequence_enrollments USING btree (next_action_at) WHERE ((status)::text = 'active'::text)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS uq_active_enrollment ON public.sequence_enrollments USING btree (sequence_id, contact_id) WHERE ((status)::text = 'active'::text)`);

  // sequence_enrollment_logs
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollment_logs_enrollment_id_index ON public.sequence_enrollment_logs USING btree (enrollment_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS sequence_enrollment_logs_executed_at_idx ON public.sequence_enrollment_logs USING btree (executed_at)`);

  // feature_flags / feature_flag_usage / feature_flag_user_overrides
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flags_category_index ON public.feature_flags USING btree (category)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_usage_flag_key_used_at_idx ON public.feature_flag_usage USING btree (flag_key, used_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS feature_flag_usage_used_at_index ON public.feature_flag_usage USING btree (used_at)`);

  // ai_token_budgets
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS ai_token_budgets_user_id_idx ON public.ai_token_budgets USING btree (user_id) WHERE (user_id IS NOT NULL)`);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS ai_token_budgets_org_default_idx ON public.ai_token_budgets USING btree (((user_id IS NULL))) WHERE (user_id IS NULL)`);

  // ai_token_usage
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_token_usage_year_month_index ON public.ai_token_usage USING btree (year_month)`);

  // ai_sessions / ai_messages (MINCRM-421)
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_sessions_user_id_idx ON public.ai_sessions USING btree (user_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_sessions_user_id_updated_at_idx ON public.ai_sessions USING btree (user_id, updated_at)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_messages_session_id_idx ON public.ai_messages USING btree (session_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS ai_messages_session_id_created_at_idx ON public.ai_messages USING btree (session_id, created_at)`);

  // currency_rate_history
  pgm.sql(`CREATE INDEX IF NOT EXISTS currency_rate_history_code_effective_from_idx ON public.currency_rate_history USING btree (code, effective_from DESC)`);

  // teams (migration 103 — MINCRM-537)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.teams (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      name           text NOT NULL,
      manager_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
      parent_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
      scim_group_id  text,
      created_at     timestamp with time zone DEFAULT now() NOT NULL,
      updated_at     timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT teams_pkey PRIMARY KEY (id),
      CONSTRAINT teams_name_key UNIQUE (name),
      CONSTRAINT teams_scim_group_id_key UNIQUE (scim_group_id)
    )
  `);
  pgm.sql(`CREATE UNIQUE INDEX IF NOT EXISTS teams_name_lower_idx ON public.teams (lower(name))`);

  // team_memberships (migration 103 — MINCRM-537)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.team_memberships (
      team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      role    text NOT NULL,
      CONSTRAINT team_memberships_pkey PRIMARY KEY (team_id, user_id),
      CONSTRAINT team_memberships_role_check CHECK (role IN ('lead', 'member'))
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS team_memberships_user_id_idx ON public.team_memberships (user_id)`);

  // -------------------------------------------------------------------------
  // Triggers — wrapped in DO/EXCEPTION so baseline is safe on existing databases
  // -------------------------------------------------------------------------

  // set_updated_at triggers on all mutable tables (migration 077)
  for (const table of [
    'accounts', 'activities', 'ai_token_budgets', 'ai_token_usage',
    'automation_rules', 'contact_addresses', 'contacts', 'currencies',
    'custom_field_definitions', 'custom_field_values', 'custom_reports',
    'deals', 'email_templates', 'feature_flags', 'import_jobs', 'leads', 'notes',
    'pipeline_stages', 'pipelines', 'sales_sequence_steps', 'sales_sequences',
    'sequence_enrollments', 'system_settings', 'tags', 'teams', 'users',
  ]) {
    pgm.sql(`
      DO $$ BEGIN
        CREATE TRIGGER ${table}_set_updated_at
          BEFORE UPDATE ON public.${table}
          FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  // audit_log triggers — append-only + pg_notify
  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER audit_log_no_modify
        BEFORE DELETE OR UPDATE ON public.audit_log
        FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER audit_log_after_insert
        AFTER INSERT ON public.audit_log
        FOR EACH ROW EXECUTE FUNCTION public.audit_log_notify();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // -------------------------------------------------------------------------
  // Row-Level Security (migration 092) — ENABLE/FORCE are idempotent in PG;
  // policies are wrapped in DO/EXCEPTION to handle existing databases.
  // -------------------------------------------------------------------------
  for (const table of ['accounts', 'activities', 'contacts', 'deals', 'leads']) {
    pgm.sql(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    pgm.sql(`ALTER TABLE ONLY public.${table} FORCE ROW LEVEL SECURITY`);

    // admin: full access
    pgm.sql(`DO $$ BEGIN CREATE POLICY rls_admin_select ON public.${table} FOR SELECT USING (((( SELECT users.role FROM public.users WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text)); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    pgm.sql(`DO $$ BEGIN CREATE POLICY rls_admin_update ON public.${table} FOR UPDATE USING (((( SELECT users.role FROM public.users WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text)); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    pgm.sql(`DO $$ BEGIN CREATE POLICY rls_admin_delete ON public.${table} FOR DELETE USING (((( SELECT users.role FROM public.users WHERE (users.id = public.app_current_user_id())))::text = 'admin'::text)); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);

    // rep: own records only
    pgm.sql(`DO $$ BEGIN CREATE POLICY rls_owner_select ON public.${table} FOR SELECT USING ((owner_id = public.app_current_user_id())); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    pgm.sql(`DO $$ BEGIN CREATE POLICY rls_owner_update ON public.${table} FOR UPDATE USING ((owner_id = public.app_current_user_id())); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    pgm.sql(`DO $$ BEGIN CREATE POLICY rls_owner_delete ON public.${table} FOR DELETE USING ((owner_id = public.app_current_user_id())); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }

  // ---------------------------------------------------------------------------
  // Seed data — rows required for the application to function on a fresh install.
  // Mirrors the INSERT statements from migrations 008, 014, 017, 021, 035, 038,
  // 039, 054, 056, 066, 071, 086, 087. All inserts use ON CONFLICT DO NOTHING
  // so this section is safe to run on existing databases that already have rows.
  // ---------------------------------------------------------------------------

  pgm.sql(`
    INSERT INTO public.system_settings (key, value, updated_at) VALUES
      ('default_language',            'en',    now()),
      ('nav_layout',                  'top',   now()),
      ('email_notifications_enabled', 'true',  now()),
      ('tags_restrict_creation',      'false', now()),
      ('onboarding_completed',        'false', now()),
      ('require_mfa',                 'false', now()),
      ('default_currency',            'USD',   now()),
      ('pipeline_stages_reviewed',    'false', now())
    ON CONFLICT (key) DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.currencies (code, name, symbol, rate_to_home, is_home)
    VALUES ('USD', 'US Dollar', '$', 1.000000, true)
    ON CONFLICT (code) DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.pipelines (name, is_default)
    VALUES ('Default', true)
    ON CONFLICT DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.pipeline_stages (name, sort_order, probability, is_terminal, is_fixed, pipeline_id)
    SELECT name, sort_order, probability, is_terminal, is_fixed, (SELECT id FROM public.pipelines WHERE is_default = true)
    FROM (VALUES
      ('Prospecting',  10, 10,  false, false),
      ('Qualification',20, 25,  false, false),
      ('Proposal',     30, 50,  false, false),
      ('Negotiation',  40, 75,  false, false),
      ('Closed Won',   50, 100, true,  true),
      ('Closed Lost',  60, 0,   true,  true)
    ) AS stages(name, sort_order, probability, is_terminal, is_fixed)
    WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_stages)
  `);

  pgm.sql(`
    INSERT INTO public.feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      ('notes',               'Notes',                    'Allows users to create and view notes on contacts, accounts, and deals.',              'Core CRM',     true,  NULL,                          true),
      ('tags',                'Tags',                     'Allows users to tag contacts, accounts, and deals for categorization.',                'Core CRM',     true,  NULL,                          true),
      ('activities',          'Activities',               'Enables activity logging (calls, emails, meetings) on CRM records.',                  'Core CRM',     true,  NULL,                          true),
      ('tasks',               'Tasks',                    'Allows users to create and track tasks linked to CRM records.',                       'Core CRM',     true,  NULL,                          true),
      ('lead_scoring',        'Lead Scoring',             'Enables automated scoring of leads based on configurable criteria.',                   'Productivity', true,  NULL,                          true),
      ('duplicate_detection', 'Duplicate Detection',      'Warns users when creating records that may be duplicates of existing ones.',          'Productivity', true,  NULL,                          true),
      ('custom_fields',       'Custom Fields',            'Allows admins to define custom data fields on contacts, accounts, and deals.',        'Productivity', true,  NULL,                          true),
      ('multiple_pipelines',  'Multiple Pipelines',       'Enables management of more than one deal pipeline with independent stage sets.',      'Productivity', true,  NULL,                          true),
      ('reporting',           'Reporting & Dashboards',   'Provides access to built-in reports and the dashboard analytics view.',               'Data',         true,  '{"admin":true,"rep":true}',   true),
      ('sequencing',          'Sequencing',               'Enables automated email cadence sequences for outbound sales outreach.',              'Productivity', true,  NULL,                          true),
      ('csv_import',          'CSV Import',               'Allows bulk import of contacts, accounts, and deals from CSV files.',                 'Data',         true,  NULL,                          true),
      ('csv_export',          'CSV Export',               'Allows users to export CRM records as CSV files.',                                   'Data',         true,  '{"admin":true,"rep":true}',   true),
      ('automation_rules',    'Automation Rules',         'Enables configurable trigger-action automation rules that run on record changes.',    'Integrations', true,  NULL,                          true),
      ('webhooks',            'Webhooks',                 'Allows admins to configure outbound webhook notifications to external systems.',      'Integrations', true,  NULL,                          true),
      ('email_templates',     'Email Templates',          'Provides a library of reusable email templates for use in sequences and activities.','Integrations', true,  NULL,                          true),
      ('ai_features',         'AI Features',              'Master toggle for all AI-powered features in the CRM.',                              'AI',           true,  NULL,                          true),
      ('mobile_access',       'Mobile Access',            'Enables access to the CRM from mobile devices.',                                     'Core CRM',     false, NULL,                          true),
      ('demo_data',           'Demo Data',                'Allows loading and removing demo data for onboarding and evaluation purposes.',       'Data',         false, NULL,                          true),
      ('ai_nli_page',              'NLI Page',                    'Provides the natural language interface page where users can query CRM data in plain English.',          'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_activity_summarizer',   'Activity Summarizer',         'Generates AI summaries of recent activity on contact, account, and deal record timelines.',             'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_email_draft',           'Email Draft',                 'Assists users with drafting outbound emails in the activity composer using AI.',                         'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_task_suggestions',      'Task Suggestions',            'Suggests follow-up tasks based on recent activity and deal context.',                                    'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_contact_enrichment',    'Contact Enrichment',          'Automatically enriches contact records with additional data from AI-powered inference.',                 'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_duplicate_explanation', 'Duplicate Explanation',       'Provides a natural language explanation of why two records were flagged as potential duplicates.',       'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_lead_score_narrative',  'Lead Score Narrative',        'Generates a plain-English explanation of the factors contributing to a lead score.',                    'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_deal_health_check',     'Deal Health Check',           'Assesses overall deal health and surfaces risk signals using AI analysis of deal activity.',             'AI', true, '{"admin":true,"rep":true}', true),
      ('ai_stage_advancement',     'Stage Advancement Suggestion','Suggests when a deal is ready to advance to the next pipeline stage based on activity signals.',         'AI', true, '{"admin":true,"rep":true}', true)
    ON CONFLICT (flag_key) DO NOTHING
  `);

  // Seed stage exit requirements for fixed terminal stages (migration 096)
  pgm.sql(`
    UPDATE public.pipeline_stages
    SET stage_exit_requirements = '{"required_fields":["close_date"],"warning_fields":[]}'
    WHERE is_fixed = true
  `);

  pgm.sql(`
    INSERT INTO public.ai_configuration (singleton)
    VALUES (TRUE)
    ON CONFLICT ON CONSTRAINT ai_configuration_singleton_unique DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.smtp_configuration (singleton)
    VALUES (TRUE)
    ON CONFLICT ON CONSTRAINT smtp_configuration_singleton_unique DO NOTHING
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
  // org_visibility_settings (migration 105 — MINCRM-538)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.org_visibility_settings (
      object_type  text        NOT NULL,
      policy       text        NOT NULL DEFAULT 'org',
      updated_at   timestamptz NOT NULL DEFAULT now(),
      updated_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT org_visibility_settings_pkey PRIMARY KEY (object_type),
      CONSTRAINT org_visibility_settings_policy_check
        CHECK (policy IN ('private', 'team', 'org')),
      CONSTRAINT org_visibility_settings_object_type_check
        CHECK (object_type IN ('contact', 'deal', 'activity'))
    )
  `);
  pgm.sql(`
    INSERT INTO public.org_visibility_settings (object_type, policy)
    VALUES ('contact', 'org'), ('deal', 'org'), ('activity', 'org')
    ON CONFLICT (object_type) DO NOTHING
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

  // custom_roles / role_capabilities / user_custom_roles (migration 106 — MINCRM-542)
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.custom_roles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      description TEXT,
      is_builtin  BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT custom_roles_name_key UNIQUE (name)
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.custom_roles IS 'Named role definitions for capability-based RBAC (MINCRM-542). Rows with is_builtin = true correspond to the five built-in roles and cannot be deleted or renamed via the REST API.'`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.role_capabilities (
      role_id    UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
      capability TEXT NOT NULL,
      PRIMARY KEY (role_id, capability)
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.role_capabilities IS 'Capability strings granted to a role (MINCRM-542). The TypeScript Capability enum is the source of truth for valid strings; the DB stores assignments only.'`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.user_custom_roles (
      user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    )
  `);
  pgm.sql(`COMMENT ON TABLE public.user_custom_roles IS 'Assignment of custom roles to users (MINCRM-542). Effective capabilities are the union of all capabilities from all assigned roles.'`);

  pgm.sql(`CREATE INDEX IF NOT EXISTS user_custom_roles_user_id_idx ON public.user_custom_roles (user_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS user_custom_roles_role_id_idx ON public.user_custom_roles (role_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS role_capabilities_role_id_idx ON public.role_capabilities (role_id)`);

  pgm.sql(`
    DO $$ BEGIN
      CREATE TRIGGER custom_roles_set_updated_at
        BEFORE UPDATE ON public.custom_roles
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  pgm.sql(`
    INSERT INTO public.custom_roles (name, description, is_builtin) VALUES
      ('admin',           'Full administrative access to all capabilities',        true),
      ('manager',         'Team management with broad record access',              true),
      ('rep',             'Standard sales representative access',                  true),
      ('viewer',          'Read-only access across the organisation',              true),
      ('service_account', 'Machine-to-machine API access via bearer token',        true)
    ON CONFLICT (name) DO NOTHING
  `);

  // sso_jit_default_role_id — must be after custom_roles is seeded above (migration 110 — MINCRM-540)
  pgm.sql(`
    INSERT INTO public.system_settings (key, value, updated_at)
    SELECT 'sso_jit_default_role_id', r.id::text, now()
    FROM public.custom_roles r
    WHERE r.name = 'rep' AND r.is_builtin = true
    ON CONFLICT (key) DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    JOIN (VALUES
      ('admin','contacts:view'),('admin','contacts:create'),('admin','contacts:edit'),
      ('admin','contacts:delete'),('admin','contacts:export'),
      ('manager','contacts:view'),('manager','contacts:create'),('manager','contacts:edit'),('manager','contacts:delete'),('manager','contacts:export'),
      ('rep','contacts:view'),('rep','contacts:create'),('rep','contacts:edit'),('rep','contacts:delete'),
      ('viewer','contacts:view'),
      ('admin','deals:view'),('admin','deals:create'),('admin','deals:edit'),
      ('admin','deals:delete'),('admin','deals:reassign'),
      ('manager','deals:view'),('manager','deals:create'),('manager','deals:edit'),('manager','deals:delete'),('manager','deals:reassign'),
      ('rep','deals:view'),('rep','deals:create'),('rep','deals:edit'),('rep','deals:delete'),
      ('viewer','deals:view'),
      ('admin','activities:view'),('admin','activities:create'),('admin','activities:edit'),
      ('admin','activities:delete'),
      ('manager','activities:view'),('manager','activities:create'),('manager','activities:edit'),('manager','activities:delete'),
      ('rep','activities:view'),('rep','activities:create'),('rep','activities:edit'),('rep','activities:delete'),
      ('viewer','activities:view'),
      ('admin','pipelines:view'),('admin','pipelines:manage'),
      ('manager','pipelines:view'),('rep','pipelines:view'),('viewer','pipelines:view'),
      ('admin','sequences:view'),('admin','sequences:create'),('admin','sequences:edit'),
      ('admin','sequences:delete'),('admin','sequences:enroll'),
      ('manager','sequences:view'),('manager','sequences:create'),('manager','sequences:edit'),
      ('manager','sequences:enroll'),('rep','sequences:view'),('rep','sequences:enroll'),
      ('admin','workflows:view'),('admin','workflows:create'),('admin','workflows:edit'),
      ('admin','workflows:delete'),('admin','workflows:activate'),
      ('manager','workflows:view'),
      ('admin','reports:view'),('admin','reports:create'),('admin','reports:edit'),
      ('admin','reports:delete'),('admin','reports:export'),('admin','reports:schedule'),
      ('manager','reports:view'),('manager','reports:create'),('manager','reports:edit'),
      ('manager','reports:export'),('manager','reports:schedule'),
      ('rep','reports:view'),('viewer','reports:view'),
      ('admin','dashboards:view'),('admin','dashboards:manage'),
      ('manager','dashboards:view'),('manager','dashboards:manage'),
      ('rep','dashboards:view'),('viewer','dashboards:view'),
      ('admin','forecasting:view'),('admin','forecasting:edit'),
      ('manager','forecasting:view'),('manager','forecasting:edit'),
      ('rep','forecasting:view'),('viewer','forecasting:view'),
      ('admin','data:import'),('admin','data:export'),('manager','data:export'),
      ('admin','users:view'),('admin','users:create'),('admin','users:edit'),
      ('admin','users:delete'),('admin','teams:manage'),('admin','integrations:manage'),
      ('admin','settings:manage'),('admin','feature_flags:manage'),
      ('admin','audit_log:view'),
      ('admin','bulk:operations'),('manager','bulk:operations'),
      ('service_account','api:access'),
      ('service_account','contacts:view'),('service_account','contacts:create'),
      ('service_account','contacts:edit'),('service_account','contacts:export'),
      ('service_account','deals:view'),('service_account','deals:create'),
      ('service_account','deals:edit'),
      ('service_account','activities:view'),('service_account','activities:create'),
      ('service_account','activities:edit'),
      ('service_account','pipelines:view'),('service_account','sequences:enroll'),
      ('service_account','data:import'),('service_account','data:export')
    ) AS c(role_name, capability) ON r.name = c.role_name
    ON CONFLICT (role_id, capability) DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.user_custom_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM public.users u
    JOIN public.custom_roles r ON r.name = u.role AND r.is_builtin = true
    ON CONFLICT (user_id, role_id) DO NOTHING
  `);

  // scim_tokens (migration 111 — MINCRM-541)
  // Must be after users table; placed here (after custom_roles) for grouping consistency.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.scim_tokens (
      id           uuid DEFAULT gen_random_uuid() NOT NULL,
      token_hash   text NOT NULL,
      created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
      created_at   timestamp with time zone DEFAULT now() NOT NULL,
      last_used_at timestamp with time zone,
      CONSTRAINT scim_tokens_pkey PRIMARY KEY (id),
      CONSTRAINT scim_tokens_token_hash_key UNIQUE (token_hash)
    )
  `);

  // scim_group_role_mappings (migration 111 — MINCRM-541)
  // FK to custom_roles — must be after custom_roles is created above.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.scim_group_role_mappings (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      scim_group_id text NOT NULL,
      group_name    text NOT NULL,
      role_id       uuid NOT NULL REFERENCES public.custom_roles(id) ON DELETE RESTRICT,
      created_at    timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT scim_group_role_mappings_pkey PRIMARY KEY (id),
      CONSTRAINT scim_group_role_mappings_scim_group_id_key UNIQUE (scim_group_id)
    )
  `);

  // feature_flag_groups (migration 119 — MINCRM-491)
  // Gate layer above individual flags — disabling a group blocks all member flags for
  // non-beta users. Must be after users table.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.feature_flag_groups (
      group_key   varchar(100) NOT NULL,
      label       varchar(100) NOT NULL,
      description text NOT NULL DEFAULT '',
      enabled     boolean NOT NULL DEFAULT true,
      enable_at   timestamp with time zone,
      updated_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
      updated_at  timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT feature_flag_groups_pkey PRIMARY KEY (group_key)
    )
  `);

  // feature_flag_group_beta_users (migration 120 — MINCRM-491)
  // Users in a group's beta list bypass the group gate even when the group is disabled.
  // Must be after feature_flag_groups and users tables.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.feature_flag_group_beta_users (
      group_key varchar(100) NOT NULL REFERENCES public.feature_flag_groups(group_key) ON DELETE CASCADE,
      user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      added_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
      added_at  timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT feature_flag_group_beta_users_pkey PRIMARY KEY (group_key, user_id)
    )
  `);

  // group_key column on feature_flags (migration 121 — MINCRM-491)
  // A flag may belong to at most one group. ON DELETE SET NULL so deleting a group
  // ungroups its flags without data loss. Must be after feature_flag_groups.
  pgm.sql(`
    ALTER TABLE public.feature_flags
      ADD COLUMN IF NOT EXISTS group_key varchar(100) REFERENCES public.feature_flag_groups(group_key) ON DELETE SET NULL
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS feature_flags_group_key_index ON public.feature_flags USING btree (group_key)
  `);

};

/**
 * The baseline cannot be reversed with SQL — rolling back would drop the
 * entire schema, which is equivalent to destroying the database. Restore
 * from a backup instead. This is intentionally a no-op, not an oversight.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} _pgm
 */
exports.down = (_pgm) => {
  // intentional no-op — see header comment
};
