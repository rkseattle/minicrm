'use strict';

/**
 * Migration 164 — Revoke privileged built-in roles that were granted automatically.
 *
 * Two automated paths could grant a built-in role before guards were added: a SCIM
 * group-to-role mapping naming a built-in, and the sso_jit_default_role_id setting
 * naming one. Both are now refused on write and ignored on read, but rows already
 * created keep granting the role, because effective capabilities are the union across
 * every assigned role.
 *
 * Provenance is recoverable rather than guessed. assignRoleToUser writes a
 * custom_role_assigned audit entry in the same transaction as the INSERT and only when
 * a row was actually created, so a deliberate admin grant always has one; the SCIM and
 * SSO paths write member_added and sso_provisioned instead and never write it. audit_log
 * is append-only by trigger and is not purged by retention, so the absence of that entry
 * is reliable evidence rather than an artifact of trimming.
 *
 * Three exclusions keep legitimate access:
 *   - rep is never revoked; it is the base role both paths already assign.
 *   - A role matching users.role is never revoked, which preserves the baseline backfill
 *     rows — the only legitimate grants that carry no audit entry at all.
 *   - Any pair with a custom_role_assigned entry is an administrator's own decision.
 *
 * Irreversible by nature: down() cannot recreate rows it cannot identify, and restoring
 * them would re-grant the privilege this removes. The revocations are listed in the
 * audit log under role_revoked so an operator can review and re-grant deliberately.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TEMP TABLE revoked_builtin_grants ON COMMIT DROP AS
    SELECT ucr.user_id, ucr.role_id, cr.name AS role_name
      FROM public.user_custom_roles ucr
      JOIN public.custom_roles cr ON cr.id = ucr.role_id
     WHERE cr.is_builtin = true
       AND cr.name <> 'rep'
       AND cr.name IS DISTINCT FROM (SELECT u.role FROM public.users u WHERE u.id = ucr.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.audit_log a
          WHERE a.record_type = 'user'
            AND a.record_id = ucr.user_id
            AND a.field_name = 'custom_role_assigned'
            AND a.new_value = cr.name
       )
  `);

  pgm.sql(`
    DELETE FROM public.user_custom_roles ucr
     USING revoked_builtin_grants r
     WHERE ucr.user_id = r.user_id AND ucr.role_id = r.role_id
  `);

  // Recorded per user so an operator can see who lost what and re-grant deliberately.
  pgm.sql(`
    INSERT INTO public.audit_log
      (record_type, record_id, record_name, event_type, field_name, old_value,
       changed_by_id, changed_by_name)
    SELECT 'user', r.user_id, u.name, 'role_changed', 'role_revoked', r.role_name,
           '00000000-0000-0000-0000-000000000000', 'System'
      FROM revoked_builtin_grants r
      JOIN public.users u ON u.id = r.user_id
  `);
};

exports.down = () => {
  // Deliberately empty: the removed grants cannot be distinguished from ones that were
  // never present, and restoring them would reinstate the privilege escalation.
};
