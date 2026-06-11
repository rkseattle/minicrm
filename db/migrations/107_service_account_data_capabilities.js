/**
 * Migration 107: Grant data CRUD capabilities to the service_account built-in role (MINCRM-542)
 *
 * Service accounts are API-only principals that authenticate via bearer token.
 * They need full data CRUD access (contacts, accounts, deals, activities, leads)
 * so that integration tools can read and write CRM data — the primary use case
 * for machine-to-machine tokens.
 *
 * Admin capabilities (settings:manage, users:*, feature_flags:manage, etc.) are
 * intentionally excluded because service accounts must not alter system configuration.
 *
 * The requireCapability() middleware already enforces SERVICE_ACCOUNT_UI_BLOCKED for
 * any capability other than api:access that is attempted via a UI-style cookie session
 * (MINCRM-542), so granting these capabilities here only affects bearer-token paths
 * where the service_account role is explicitly permitted.
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.sql(`
    INSERT INTO public.role_capabilities (role_id, capability)
    SELECT r.id, c.capability
    FROM public.custom_roles r
    JOIN (VALUES
      ('contacts:view'),
      ('contacts:create'),
      ('contacts:edit'),
      ('contacts:export'),
      ('deals:view'),
      ('deals:create'),
      ('deals:edit'),
      ('activities:view'),
      ('activities:create'),
      ('activities:edit'),
      ('pipelines:view'),
      ('sequences:enroll'),
      ('data:import'),
      ('data:export')
    ) AS c(capability) ON true
    WHERE r.name = 'service_account' AND r.is_builtin = true
    ON CONFLICT (role_id, capability) DO NOTHING
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM public.role_capabilities
    WHERE role_id = (
      SELECT id FROM public.custom_roles WHERE name = 'service_account' AND is_builtin = true
    )
    AND capability IN (
      'contacts:view', 'contacts:create', 'contacts:edit', 'contacts:export',
      'deals:view', 'deals:create', 'deals:edit',
      'activities:view', 'activities:create', 'activities:edit',
      'pipelines:view', 'sequences:enroll',
      'data:import', 'data:export'
    )
  `);
};
