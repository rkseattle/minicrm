/**
 * Migration 039 — add onboarding_completed to system_settings (MINCRM-256)
 *
 * Inserts a default row so the setting is always readable without a missing-row
 * fallback path. Default is 'false' — fresh installs start with onboarding active.
 */

'use strict';

exports.up = async (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('onboarding_completed', 'false', now())
    ON CONFLICT (key) DO NOTHING
  `);
};

exports.down = async (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'onboarding_completed'`);
};
