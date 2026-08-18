'use strict';

/**
 * Migration 143: AI objection pattern matching from won deals.
 *
 * Adds:
 *   1. ai_objection_pattern_matching feature flag (child of ai_features).
 *   2. activity_objection_signals table — one row per objection-classified
 *      activity. A dedicated table (not activities.metadata jsonb) per the
 *      ADR-002 convention already established by migrations 141/142: category
 *      needs to be queried/joined across many activities to find precedents,
 *      which is exactly the O(n) jsonb-scan anti-pattern ADR-002 warns
 *      against. A real column + B-tree index makes precedent search a plain
 *      indexed query.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_objection_pattern_matching',
        'Objection Pattern Matching',
        'AI classification of objections in activity notes, with precedent matching against how similar objections were handled in past won deals.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.activity_objection_signals (
      id            uuid DEFAULT gen_random_uuid() NOT NULL,
      activity_id   uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
      category      text NOT NULL,
      classified_at timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT activity_objection_signals_pkey PRIMARY KEY (id),
      CONSTRAINT activity_objection_signals_activity_id_unique UNIQUE (activity_id),
      CONSTRAINT activity_objection_signals_category_check
        CHECK (category IN ('Price', 'Timing', 'Competitor', 'Product Fit', 'Authority', 'Risk', 'Other'))
    )
  `);

  pgm.sql(`
    COMMENT ON TABLE public.activity_objection_signals IS
      'AI objection classification per activity (MINCRM-471). One row per classified activity — classification runs on-demand, not pre-computed, so this table is populated lazily as reps view objection-logged activities.'
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS activity_objection_signals_category_idx
      ON public.activity_objection_signals USING btree (category)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS public.activity_objection_signals`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_objection_pattern_matching'`);
};
