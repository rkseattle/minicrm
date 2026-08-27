'use strict';

/**
 * Migration 170 — Seed the email_sync flag and grant connected_accounts:manage.
 *
 * The flag seeds disabled: a fresh install has no OAuth apps registered, so enabling it
 * by default would surface a panel whose every connect button fails.
 *
 * role_overrides stays NULL rather than naming every role. A key present there is read
 * BEFORE the org-wide enabled column, so a permissive map would make the flag impossible
 * to switch off for those roles — including in the tests that assert the disabled path.
 *
 * The capability is granted to non-builtin custom roles as well as the three built-ins.
 * userCapabilities() returns the union of a user's custom roles and falls back to their
 * built-in role only when they hold none, so a user carrying any custom role would
 * otherwise resolve to a set without this capability and be permanently refused their own
 * profile panel, with no way for an administrator to repair it until the role editor is
 * used. Migration 166 is the precedent.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO feature_flags (flag_key, label, description, category, enabled, role_overrides, system_flag)
    VALUES (
      'email_sync',
      'Email Sync',
      'Lets each user connect a Gmail, Outlook, or IMAP mailbox to MiniCRM from their profile.',
      'Integrations',
      false,
      NULL,
      true
    )
    ON CONFLICT (flag_key) DO NOTHING
  `);

  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, 'connected_accounts:manage'
    FROM public.custom_roles r
    WHERE r.name IN ('admin', 'manager', 'rep') OR r.is_builtin = false
    ON CONFLICT DO NOTHING
  `);
};

/**
 * Removes every grant this migration could have added. Deliberately broad, for the reason
 * migration 166 records: a role holding the capability for another reason is
 * indistinguishable from one this migration granted.
 */
/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`DELETE FROM public.role_capabilities WHERE capability = 'connected_accounts:manage'`);
  pgm.sql(`DELETE FROM feature_flags WHERE flag_key = 'email_sync'`);
};
