'use strict';

/**
 * Migration 144: AI proposal draft generation from a deal. (MINCRM-473)
 *
 * Adds the ai_proposal_draft_generation feature flag (child of ai_features).
 * No persistence table — the ticket states the draft is not saved
 * automatically; the rep must explicitly export (copy/markdown/DOCX) or
 * dismiss, so generation is purely request/response.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES
      (
        'ai_proposal_draft_generation',
        'Proposal Draft Generation',
        'AI-generated first-draft proposal documents from a deal, editable before export as Markdown or DOCX.',
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
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'ai_proposal_draft_generation'`);
};
