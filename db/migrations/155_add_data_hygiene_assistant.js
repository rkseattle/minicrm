'use strict';

/**
 * Migration 155: AI data hygiene assistant.
 *
 * Adds:
 *   1. ai_data_hygiene_assistant feature flag (child of the AI category).
 *   2. contacts.title_updated_at — nullable timestamptz, stamped only when
 *      contactService.updateContact detects params.title !== before.title.
 *      contacts.updated_at bumps on ANY field edit, so it can't express the
 *      AC's literal "job title not updated in 3 years" signal — a contact
 *      whose phone number was edited last week but whose title has been
 *      stale for 4 years would otherwise look fresh. NULL means "title has
 *      never been explicitly changed since this migration" — the scan
 *      treats NULL the same as "very stale" (falls back to created_at).
 *   3. data_hygiene_scoring_config — singleton admin-editable thresholds
 *      (inactivity windows, title-staleness window, dismiss suppression
 *      window). Per ADR-002, a fixed-column table, not a jsonb blob,
 *      mirroring account_health_scoring_config / rep_coaching_scoring_config
 *      / lead_routing_scoring_config (migrations 151/153/154).
 *   4. data_hygiene_findings — current queue, one row per flagged record per
 *      issue type (a record can have multiple simultaneous findings, e.g. a
 *      contact missing both email and phone). Mutated in place by
 *      update/merge/archive/dismiss actions rather than an append-only log —
 *      the queue reflects current state, not history. dismissed_until
 *      implements the AC's 90-day dismiss suppression.
 *
 * NOTE: unlike rep coaching insights (deliberately excluded from NLI for
 * privacy) this feature's findings ARE exposed as an NLI tool per the ticket's
 * explicit requirement ("Show me my contacts with no activity in the last
 * year") — see getDataHygieneFindings in server/src/ai/tools/adminTools.ts
 * (added alongside this migration, not part of the schema itself).
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
        'ai_data_hygiene_assistant',
        'AI Data Hygiene Assistant',
        'Nightly scan for stale, incomplete, and potentially invalid contact/account/opportunity records, surfaced as a prioritized, actionable queue.',
        'AI',
        true,
        '{"admin":true,"manager":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  // ── 2. Title-change timestamp ────────────────────────────────────────────
  pgm.sql(`ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS title_updated_at timestamptz`);
  pgm.sql(`
    COMMENT ON COLUMN public.contacts.title_updated_at IS
      'Timestamp of the most recent change to contacts.title specifically (MINCRM-476) — stamped only by contactService.updateContact when title actually changes, unlike updated_at which bumps on any field edit. NULL means never explicitly changed since this column was added; the hygiene scan treats NULL as "at least as stale as created_at."'
  `);

  // ── 3. data_hygiene_scoring_config (singleton) ──────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.data_hygiene_scoring_config (
      id                              boolean NOT NULL DEFAULT true,
      contact_inactivity_days         integer NOT NULL DEFAULT 365,
      account_inactivity_days         integer NOT NULL DEFAULT 365,
      title_staleness_days            integer NOT NULL DEFAULT 1095,
      opportunity_inactivity_days     integer NOT NULL DEFAULT 30,
      dismiss_suppression_days        integer NOT NULL DEFAULT 90,
      weekly_digest_enabled           boolean NOT NULL DEFAULT false,
      updated_at                      timestamptz NOT NULL DEFAULT now(),
      updated_by                      uuid REFERENCES public.users(id) ON DELETE SET NULL,
      CONSTRAINT data_hygiene_scoring_config_pkey PRIMARY KEY (id),
      CONSTRAINT data_hygiene_scoring_config_singleton CHECK (id = true),
      CONSTRAINT data_hygiene_scoring_config_contact_inactivity_check CHECK (contact_inactivity_days >= 1),
      CONSTRAINT data_hygiene_scoring_config_account_inactivity_check CHECK (account_inactivity_days >= 1),
      CONSTRAINT data_hygiene_scoring_config_title_staleness_check CHECK (title_staleness_days >= 1),
      CONSTRAINT data_hygiene_scoring_config_opportunity_inactivity_check CHECK (opportunity_inactivity_days >= 1),
      CONSTRAINT data_hygiene_scoring_config_dismiss_suppression_check CHECK (dismiss_suppression_days >= 1)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.data_hygiene_scoring_config IS
      'Singleton admin-editable thresholds for the data hygiene scan (MINCRM-476). id is a boolean-typed singleton key (id = true) following the single-row-config convention (see account_health_scoring_config, migration 151).'
  `);

  pgm.sql(`
    INSERT INTO public.data_hygiene_scoring_config (id) VALUES (true)
    ON CONFLICT (id) DO NOTHING
  `);

  // ── 4. data_hygiene_findings (current queue) ────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.data_hygiene_findings (
      id                uuid DEFAULT gen_random_uuid() NOT NULL,
      entity_type       text NOT NULL,
      entity_id         uuid NOT NULL,
      issue_type        text NOT NULL,
      -- Only populated for contact_duplicate findings: the matched counterpart
      -- contact's ID, so the queue's inline "merge" action knows the pair
      -- without re-running duplicate detection. NULL for every other issue type.
      related_entity_id uuid,
      owner_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      last_activity_at  timestamptz,
      suggested_action  text NOT NULL,
      status            text NOT NULL DEFAULT 'open',
      dismissed_until   timestamptz,
      dismissed_reason  text,
      detected_at       timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT data_hygiene_findings_pkey PRIMARY KEY (id),
      CONSTRAINT data_hygiene_findings_entity_issue_unique UNIQUE (entity_type, entity_id, issue_type),
      CONSTRAINT data_hygiene_findings_entity_type_check CHECK (entity_type IN ('contact', 'account', 'opportunity')),
      CONSTRAINT data_hygiene_findings_status_check CHECK (status IN ('open', 'dismissed'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.data_hygiene_findings IS
      'Current data hygiene queue (MINCRM-476), one row per flagged record per issue type. Upserted nightly by dataHygieneService; mutated in place by update/merge/archive/dismiss actions rather than appended — reflects current state, not a history log. A finding is cleared (deleted) once the nightly scan no longer detects the issue, or the underlying record is deleted/archived. dismissed_until implements the 90-day (admin-configurable) dismiss suppression window.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS data_hygiene_findings_owner_id_idx
      ON public.data_hygiene_findings USING btree (owner_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS data_hygiene_findings_entity_idx
      ON public.data_hygiene_findings USING btree (entity_type, entity_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.data_hygiene_findings`);
  pgm.sql(`DROP TABLE IF EXISTS public.data_hygiene_scoring_config`);
  pgm.sql(`ALTER TABLE public.contacts DROP COLUMN IF EXISTS title_updated_at`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_data_hygiene_assistant'`);
};
