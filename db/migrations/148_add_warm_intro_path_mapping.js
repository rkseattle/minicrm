'use strict';

/**
 * Migration 148: AI warm introduction path mapping.
 *
 * Adds only the ai_warm_intro_path feature flag. No new table: warm-path
 * results are read-only suggestions computed at request time from existing
 * relationship data (accounts.parent_account_id, deal_contacts,
 * contacts.account_id, and full-text note search) — nothing is persisted.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_warm_intro_path',
        'AI Warm Introduction Paths',
        'Surfaces warm introduction paths through a rep''s contact network on the Contact detail view and via NLI queries.',
        'AI',
        true,
        '{"admin":true,"rep":true}',
        true
      )
    ON CONFLICT (flag_key) DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM feature_flags WHERE flag_key = 'ai_warm_intro_path';
  `);
};
