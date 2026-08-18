'use strict';

/**
 * Migration 060: Extend audit_log event_type CHECK constraint with SSO events.
 *
 * sso_login     — user authenticated via an external IdP (SAML / OIDC)
 * sso_provisioned — new user account created automatically on first SSO login (JIT)
 * sso_linked    — existing user account bound to an SSO identity
 * sso_unlinked  — SSO binding removed (e.g. admin disables SSO)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_event_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_event_type_check
      CHECK (event_type IN (
        'created','updated','deleted','login','logout',
        'password_changed','role_changed','deactivated','reactivated',
        'ownership_reassigned','merged',
        'note_created','note_updated','note_deleted','note_visibility_changed',
        'gdpr_erasure',
        'mfa_enabled','mfa_disabled',
        'sso_login','sso_provisioned','sso_linked','sso_unlinked'
      ));
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP CONSTRAINT IF EXISTS audit_log_event_type_check;

    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_event_type_check
      CHECK (event_type IN (
        'created','updated','deleted','login','logout',
        'password_changed','role_changed','deactivated','reactivated',
        'ownership_reassigned','merged',
        'note_created','note_updated','note_deleted','note_visibility_changed',
        'gdpr_erasure',
        'mfa_enabled','mfa_disabled'
      ));
  `);
};
