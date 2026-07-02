'use strict';

/**
 * Migration 142: AI churn and expansion signal detection. (MINCRM-469)
 *
 * Adds:
 *   1. ai_churn_expansion_detection feature flag (child of ai_features).
 *   2. account_churn_expansion_signals table — nightly-refreshed signals per
 *      closed-won account. cleared_at is set when new positive activity
 *      contradicts an active signal, per the ticket's "Signals are cleared
 *      when new positive activity is logged that contradicts them" AC.
 *   3. ai_configuration.churn_expansion_confidence_threshold — admin-
 *      configurable confidence floor below which signals are suppressed.
 *   4. notifications table — minimal in-app notification infrastructure.
 *      Does not exist anywhere in this codebase prior to this migration
 *      (only batched email notifications exist, in notificationService.ts).
 *      Scoped to what this ticket needs: a per-user notification feed with
 *      read/unread state, generic enough for other features to reuse later,
 *      but not a full notification-center feature build-out.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_churn_expansion_detection',
        'Churn/Expansion Detection',
        'Nightly AI monitoring of closed-won accounts for churn risk and expansion opportunity signals.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.account_churn_expansion_signals (
      id                    uuid DEFAULT gen_random_uuid() NOT NULL,
      account_id            uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
      signal_type           text NOT NULL,
      confidence            numeric(3,2) NOT NULL DEFAULT 0,
      contributing_factors  jsonb NOT NULL DEFAULT '[]',
      detected_at           timestamp with time zone DEFAULT now() NOT NULL,
      cleared_at            timestamp with time zone,
      CONSTRAINT account_churn_expansion_signals_pkey PRIMARY KEY (id),
      CONSTRAINT account_churn_expansion_signals_signal_type_check
        CHECK (signal_type IN ('churn_risk', 'expansion')),
      CONSTRAINT account_churn_expansion_signals_confidence_range
        CHECK (confidence BETWEEN 0 AND 1)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.account_churn_expansion_signals IS
      'Nightly AI churn/expansion signals per closed-won account (MINCRM-469). A new row is inserted per detection run; cleared_at is set (not deleted) when contradicted by new positive activity.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS account_churn_expansion_signals_account_id_idx
      ON public.account_churn_expansion_signals USING btree (account_id)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS account_churn_expansion_signals_active_idx
      ON public.account_churn_expansion_signals USING btree (signal_type)
      WHERE cleared_at IS NULL
  `);

  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS churn_expansion_confidence_threshold numeric(3,2) NOT NULL DEFAULT 0.70
        CONSTRAINT ai_configuration_churn_expansion_confidence_threshold_range
          CHECK (churn_expansion_confidence_threshold BETWEEN 0 AND 1)
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.churn_expansion_confidence_threshold IS
      'Minimum confidence for a churn/expansion signal to be surfaced; lower-confidence signals are suppressed. (MINCRM-469)'
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.notifications (
      id           uuid DEFAULT gen_random_uuid() NOT NULL,
      user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      type         text NOT NULL,
      title        text NOT NULL,
      body         text,
      link_path    text,
      read_at      timestamp with time zone,
      created_at   timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT notifications_pkey PRIMARY KEY (id)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.notifications IS
      'Minimal in-app notification feed (MINCRM-469). type is free text (not a DB enum) so new notification-producing features can start writing rows without a migration, same convention as ai_token_usage_daily.feature.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
      ON public.notifications USING btree (user_id, created_at DESC)
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS notifications_user_id_unread_idx
      ON public.notifications USING btree (user_id)
      WHERE read_at IS NULL
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.notifications`);
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS churn_expansion_confidence_threshold
  `);
  pgm.sql(`DROP TABLE IF EXISTS public.account_churn_expansion_signals`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_churn_expansion_detection'`);
};
