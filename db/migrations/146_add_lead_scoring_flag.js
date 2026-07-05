'use strict';

/**
 * Migration 146: Seed the ai_lead_scoring feature flag.
 *
 * Gates the rule-based lead score display on the Lead detail page
 * (MINCRM-441 prerequisite). This is a deterministic scoring engine, not an
 * AI call — but it is gated as an AI sub-feature category flag alongside
 * ai_lead_score_narrative (seeded in migration 071), which explains the
 * score this flag exposes. Follows the same row shape and role-override
 * convention as migration 071.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_lead_scoring',
        'Lead Scoring',
        'Computes a rule-based quality score for leads, shown on the Lead detail page.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags WHERE flag_key = 'ai_lead_scoring';
  `);
};
