'use strict';

/**
 * Migration 166 — Backfill dashboards:view and reports:view onto existing custom roles.
 *
 * GET /api/v1/dashboard/summary and the custom-report read routes now require these
 * capabilities. userCapabilities() returns the union of a user's custom roles and only
 * falls back to their built-in role when they hold none, so a user carrying a custom role
 * created before this enforcement resolves to a set without them — and lands on a broken
 * dashboard, which is the application's landing route, with no way for an administrator to
 * repair it from the role editor for dashboards:view.
 *
 * Both are read-only and every built-in role except service_account already holds them, so
 * granting them to existing custom roles restores the access those roles had rather than
 * widening it. New roles pick them up from the role editor.
 *
 * ON CONFLICT DO NOTHING because a role may already hold either one.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    CROSS JOIN (VALUES ('dashboards:view'), ('reports:view')) AS c(capability)
    WHERE r.is_builtin = false
    ON CONFLICT DO NOTHING
  `);
};

/**
 * Removes only the pairs this migration could have added — a role that legitimately holds
 * either capability for another reason is indistinguishable, so down() is deliberately
 * broad rather than trying to guess provenance.
 */
/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.role_capabilities rc
    USING public.custom_roles r
    WHERE rc.role_id = r.id
      AND r.is_builtin = false
      AND rc.capability IN ('dashboards:view', 'reports:view')
  `);
};
