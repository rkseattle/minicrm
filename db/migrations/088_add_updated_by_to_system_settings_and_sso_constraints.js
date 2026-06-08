'use strict';

/**
 * Migration 088: Add updated_by to system_settings and CHECK constraints to
 * users.sso_subject. (MINCRM-520)
 *
 * Issue 1 — system_settings.updated_by:
 *   Settings with security implications (require_mfa, tags_restrict_creation, etc.)
 *   have updated_at but no updated_by, making sensitive changes unattributable.
 *   The column is nullable so existing rows remain valid without backfill.
 *
 * Issue 2 — users.sso_subject constraints:
 *   sso_subject is bare text with no length or co-presence validation.
 *   OIDC sub claims and SAML NameIDs are bounded strings; 1024 chars is a
 *   generous safe limit that covers all known IdP formats.
 *   When sso_provider is set, sso_subject must also be set — the partial unique
 *   index already assumes this invariant; the CHECK makes it DB-enforced.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ── system_settings.updated_by ─────────────────────────────────────────────
  pgm.addColumn('system_settings', {
    updated_by: {
      type: 'uuid',
      notNull: false,
      default: null,
      references: '"users"(id)',
      onDelete: 'SET NULL',
      comment: 'User who last modified this setting — NULL for system/migration writes (MINCRM-520)',
    },
  });

  // ── users.sso_subject length constraint ────────────────────────────────────
  // OIDC sub claims and SAML NameIDs are bounded; 1024 covers all known formats.
  pgm.sql(`
    ALTER TABLE users
      ADD CONSTRAINT users_sso_subject_max_length
        CHECK (sso_subject IS NULL OR LENGTH(sso_subject) <= 1024)
  `);

  // ── users.sso_provider/sso_subject co-presence constraint ──────────────────
  // The partial unique index on (sso_provider, sso_subject) already assumes
  // that a bound user has both columns set; this CHECK makes it DB-enforced.
  pgm.sql(`
    ALTER TABLE users
      ADD CONSTRAINT users_sso_provider_requires_subject
        CHECK (sso_provider IS NULL OR sso_subject IS NOT NULL)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_sso_provider_requires_subject;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_sso_subject_max_length;
  `);
  pgm.dropColumn('system_settings', 'updated_by');
};
