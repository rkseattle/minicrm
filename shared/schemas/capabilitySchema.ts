/**
 * Capability-based RBAC — capability enum and Zod schemas
 *
 * The Capability enum is the single source of truth for all valid capability
 * strings in the system. The database stores which roles have which capabilities;
 * the TypeScript enum defines what strings are valid.
 *
 * To add a new capability:
 *   1. Add a value to the Capability enum below
 *   2. Write a migration that inserts it into role_capabilities for the relevant built-in roles
 *   3. Add requireCapability() guards to the relevant routes/service methods
 *
 * Future capabilities are defined and seeded but have no enforcing routes yet.
 * This allows custom roles to be pre-configured before the feature ships.
 */

import { z } from 'zod';

/** All discrete capability strings in the system. */
export enum Capability {
  // Contacts
  ContactsView = 'contacts:view',
  ContactsCreate = 'contacts:create',
  ContactsEdit = 'contacts:edit',
  ContactsDelete = 'contacts:delete',
  ContactsExport = 'contacts:export',

  // Deals
  DealsView = 'deals:view',
  DealsCreate = 'deals:create',
  DealsEdit = 'deals:edit',
  DealsDelete = 'deals:delete',
  DealsReassign = 'deals:reassign',

  // Activities
  ActivitiesView = 'activities:view',
  ActivitiesCreate = 'activities:create',
  ActivitiesEdit = 'activities:edit',
  ActivitiesDelete = 'activities:delete',

  // Pipelines
  PipelinesView = 'pipelines:view',
  PipelinesManage = 'pipelines:manage',

  // Sequences
  SequencesView = 'sequences:view',
  SequencesCreate = 'sequences:create',
  SequencesEdit = 'sequences:edit',
  SequencesDelete = 'sequences:delete',
  SequencesEnroll = 'sequences:enroll',

  // Workflows / Automation (future — no enforcing routes yet)
  WorkflowsView = 'workflows:view',
  WorkflowsCreate = 'workflows:create',
  WorkflowsEdit = 'workflows:edit',
  WorkflowsDelete = 'workflows:delete',
  WorkflowsActivate = 'workflows:activate',

  // Reports
  ReportsView = 'reports:view',
  ReportsCreate = 'reports:create',
  ReportsEdit = 'reports:edit',
  ReportsDelete = 'reports:delete',
  ReportsExport = 'reports:export',
  ReportsSchedule = 'reports:schedule',

  // Dashboards (future — enforce when dashboard builder ships)
  DashboardsView = 'dashboards:view',
  DashboardsManage = 'dashboards:manage',

  // Forecasting (future — no enforcing routes yet)
  ForecastingView = 'forecasting:view',
  ForecastingEdit = 'forecasting:edit',

  // Bulk operations gate — required for all bulk endpoints and bulk selection UI
  BulkOperations = 'bulk:operations',

  // Bulk Data
  DataImport = 'data:import',
  DataExport = 'data:export',

  // Admin / User Management
  UsersView = 'users:view',
  UsersCreate = 'users:create',
  UsersEdit = 'users:edit',
  UsersDelete = 'users:delete',
  TeamsManage = 'teams:manage',
  IntegrationsManage = 'integrations:manage',
  SettingsManage = 'settings:manage',
  FeatureFlagsManage = 'feature_flags:manage',

  // Audit Log (future — enforce when audit log viewer ships)
  AuditLogView = 'audit_log:view',

  // Billing (future — reserved for super_admin; no built-in role has these)
  BillingView = 'billing:view',
  BillingManage = 'billing:manage',

  // API access — required for service account bearer token requests
  ApiAccess = 'api:access',

  // Coverage/TIA framework — internal CI/dev tooling admin access
  // Deliberately NOT exposed in RolesSettings.tsx's
  // CAPABILITY_GROUPS picker — assignable only via direct API/migration,
  // matching the precedent of keeping internal coverage tooling
  // out of the customer-facing admin UI. See docs/dev/coverage.md.
  CoverageAdmin = 'coverage:admin',
}

/** All valid capability string values derived from the enum. */
export const CAPABILITY_VALUES = Object.values(Capability) as [Capability, ...Capability[]];

/** Zod schema that validates a capability string against the enum. */
export const capabilitySchema = z.enum(CAPABILITY_VALUES);

/** Zod schema for the custom_roles response shape. */
export const customRoleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  is_builtin: z.boolean(),
  capabilities: z.array(capabilitySchema),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

/** Zod schema for POST /api/v1/custom-roles request body. */
export const createCustomRoleSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer')
    .trim(),
  description: z.string().max(500, 'Description must be 500 characters or fewer').trim().optional(),
  capabilities: z
    .array(capabilitySchema, { required_error: 'Capabilities are required' })
    .min(1, 'At least one capability is required'),
});

/** Zod schema for PUT /api/v1/custom-roles/:id request body. */
export const updateCustomRoleSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer')
    .trim()
    .optional(),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or fewer')
    .trim()
    .nullable()
    .optional(),
  capabilities: z.array(capabilitySchema).min(1, 'At least one capability is required').optional(),
});

/** Zod schema for POST /api/v1/users/:id/roles request body. */
export const assignUserRoleSchema = z.object({
  roleId: z.string({ required_error: 'roleId is required' }).uuid('roleId must be a valid UUID'),
});

export type CustomRoleResponse = z.infer<typeof customRoleResponseSchema>;
export type CreateCustomRoleInput = z.infer<typeof createCustomRoleSchema>;
export type UpdateCustomRoleInput = z.infer<typeof updateCustomRoleSchema>;
export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;
