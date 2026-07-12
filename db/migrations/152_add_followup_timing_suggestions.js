'use strict';

/**
 * Migration 152: AI smart follow-up timing suggestions. (MINCRM-470)
 *
 * Adds:
 *   1. ai_followup_timing_suggestions feature flag (child of the AI category).
 *   2. contact_followup_timing_suggestions — cached suggestion per contact,
 *      recomputed lazily when stale (per AC: "updates as new interaction
 *      data accumulates — not a one-time calculation"). Read by three
 *      consumers: Contact detail view, pre-meeting brief, and the NLI tool.
 *      day_of_week/hour_start/hour_end are stored as UTC-anchored buckets
 *      (derived from timestamptz interaction data) — never as localized
 *      wall-clock strings — so a later change to the org's default_timezone
 *      setting re-projects correctly at read time with no backfill needed.
 *   3. default_timezone system_settings row — org-wide display timezone
 *      (IANA identifier), used to render suggested times in local terms
 *      per the AC. No per-contact timezone exists in this schema.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_followup_timing_suggestions',
        'AI Follow-Up Timing Suggestions',
        'Suggests the optimal day/time to follow up with a contact based on historical engagement patterns.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.contact_followup_timing_suggestions (
      contact_id       uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
      day_of_week      smallint NOT NULL,
      hour_start_utc   smallint NOT NULL,
      hour_end_utc     smallint NOT NULL,
      sample_size      integer NOT NULL,
      computed_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT contact_followup_timing_suggestions_pkey PRIMARY KEY (contact_id),
      CONSTRAINT contact_followup_timing_suggestions_day_check
        CHECK (day_of_week BETWEEN 0 AND 6),
      CONSTRAINT contact_followup_timing_suggestions_hour_start_check
        CHECK (hour_start_utc BETWEEN 0 AND 23),
      CONSTRAINT contact_followup_timing_suggestions_hour_end_check
        CHECK (hour_end_utc BETWEEN 1 AND 24),
      CONSTRAINT contact_followup_timing_suggestions_hour_order_check
        CHECK (hour_end_utc > hour_start_utc),
      CONSTRAINT contact_followup_timing_suggestions_sample_size_check
        CHECK (sample_size >= 5)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.contact_followup_timing_suggestions IS
      'Cached best-time-to-contact suggestion per contact (MINCRM-470). day_of_week/hour_start_utc/hour_end_utc are UTC-anchored; project to a display timezone at read time, never store localized values. Absence of a row means fewer than 5 logged interactions (insufficient data).'
  `);

  pgm.sql(`
    INSERT INTO system_settings (key, value)
    VALUES ('default_timezone', 'UTC')
    ON CONFLICT (key) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'default_timezone'`);
  pgm.sql(`DROP TABLE IF EXISTS public.contact_followup_timing_suggestions`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_followup_timing_suggestions'`);
};
