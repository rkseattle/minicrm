'use strict';

/**
 * Migration 147: AI pre-meeting brief generation.
 *
 * Adds:
 *   1. ai_meeting_brief feature flag (child of the AI category).
 *   2. activity_meeting_briefs table — one row per activity holding the most
 *      recently generated brief. Overwritten on regenerate (not append-only):
 *      the brief is explicitly "regenerated each time Generate Brief is
 *      clicked, not cached between requests" per the ticket, but the last
 *      generated brief must still be readable at a stable URL for the
 *      shareable-link requirement, so the latest result is persisted.
 *   3. ai_configuration.web_search_enabled — admin toggle gating the optional
 *      "news hook" section of the brief. No web-search integration exists
 *      anywhere in this codebase yet; this column is new ground, not an
 *      extension of an existing capability flag.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_meeting_brief',
        'AI Meeting Brief',
        'Generates an AI pre-meeting brief for upcoming call and meeting activities.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.activity_meeting_briefs (
      id             uuid DEFAULT gen_random_uuid() NOT NULL,
      activity_id    uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
      brief_json     jsonb NOT NULL,
      generated_by   uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
      generated_at   timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT activity_meeting_briefs_pkey PRIMARY KEY (id),
      CONSTRAINT activity_meeting_briefs_activity_id_unique UNIQUE (activity_id)
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.activity_meeting_briefs IS
      'Most recently generated AI pre-meeting brief per activity (MINCRM-465). One row per activity — replaced on regenerate, not appended.'
  `);

  pgm.sql(`
    ALTER TABLE public.ai_configuration
      ADD COLUMN IF NOT EXISTS web_search_enabled boolean NOT NULL DEFAULT false
  `);
  pgm.sql(`
    COMMENT ON COLUMN public.ai_configuration.web_search_enabled IS
      'Admin toggle for the optional news-hook section of AI meeting briefs. (MINCRM-465)'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.ai_configuration
      DROP COLUMN IF EXISTS web_search_enabled
  `);
  pgm.sql(`DROP TABLE IF EXISTS public.activity_meeting_briefs`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_meeting_brief'`);
};
