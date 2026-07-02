'use strict';

/**
 * Migration 141: AI champion and blocker detection. (MINCRM-466)
 *
 * Adds:
 *   1. ai_champion_blocker_detection feature flag (child of ai_features).
 *   2. contact_champion_blocker_signals table — one row per contact holding
 *      the current classification, contributing signals, and an optional
 *      rep override/dismissal. Recency-weighted decay is computed at read
 *      time from contributing_signals' timestamps, not stored.
 *   3. ai_configuration.champion_blocker_deal_value_threshold — admin-
 *      configurable deal value above which the "single-threaded risk"
 *      warning applies (ticket: "configurable deal value threshold").
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_champion_blocker_detection',
        'Champion/Blocker Detection',
        'AI-inferred champion and blocker signals detected from activity notes, shown as badges on contacts.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.contact_champion_blocker_signals (
      id                    uuid DEFAULT gen_random_uuid() NOT NULL,
      contact_id            uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
      status                text NOT NULL DEFAULT 'neutral',
      confidence            numeric(3,2) NOT NULL DEFAULT 0,
      contributing_signals  jsonb NOT NULL DEFAULT '[]',
      last_activity_id      uuid REFERENCES public.activities(id) ON DELETE SET NULL,
      -- Rep override: manually corrects the AI classification until new signals shift it.
      override_status       text,
      override_reason       text,
      overridden_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
      overridden_at         timestamp with time zone,
      -- "Not accurate" dismissal feed-back (distinct from override — a dismissal without a
      -- replacement status simply suppresses the badge until new signals arrive).
      dismissed_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
      dismissed_at          timestamp with time zone,
      created_at            timestamp with time zone DEFAULT now() NOT NULL,
      updated_at            timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT contact_champion_blocker_signals_pkey PRIMARY KEY (id),
      CONSTRAINT contact_champion_blocker_signals_contact_id_unique UNIQUE (contact_id),
      CONSTRAINT contact_champion_blocker_signals_status_check
        CHECK (status IN ('champion', 'likely_champion', 'neutral', 'likely_blocker', 'blocker')),
      CONSTRAINT contact_champion_blocker_signals_override_status_check
        CHECK (override_status IS NULL OR override_status IN ('champion', 'likely_champion', 'neutral', 'likely_blocker', 'blocker'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.contact_champion_blocker_signals IS
      'Per-contact AI champion/blocker classification (MINCRM-466). One row per contact — replaced/updated after each new activity, not appended.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS contact_champion_blocker_signals_status_idx
      ON public.contact_champion_blocker_signals USING btree (status)
  `);

  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS champion_blocker_deal_value_threshold numeric(15,2) NOT NULL DEFAULT 10000
        CONSTRAINT ai_configuration_champion_blocker_threshold_nonnegative
          CHECK (champion_blocker_deal_value_threshold >= 0)
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.champion_blocker_deal_value_threshold IS
      'Deal value above which the single-threaded-risk warning applies when only one contact is engaged. (MINCRM-466)'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS champion_blocker_deal_value_threshold
  `);
  pgm.sql(`DROP TABLE IF EXISTS public.contact_champion_blocker_signals`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_champion_blocker_detection'`);
};
