/**
 * Shared Zod schemas and types for the feature flag registry.
 * Imported by both the server (validation) and the client (form validation, display).
 * (MINCRM-463)
 */

import { z } from 'zod';
import { USER_ROLES } from './userSchema.js';

/** All valid feature flag keys — must match the seed rows in migration 066. */
export const FEATURE_FLAG_KEYS = [
  'notes',
  'tags',
  'activities',
  'tasks',
  'lead_scoring',
  'duplicate_detection',
  'custom_fields',
  'multiple_pipelines',
  'reporting',
  'sequencing',
  'csv_import',
  'csv_export',
  'automation_rules',
  'webhooks',
  'email_templates',
  'ai_features',
  'mobile_access',
  'demo_data',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/** Flag keys that support per-role overrides. */
export const ROLE_OVERRIDE_FLAG_KEYS: readonly FeatureFlagKey[] = ['reporting', 'csv_export'];

/** UI grouping categories — must match the category values in migration 066. */
export const FEATURE_FLAG_CATEGORIES = [
  'Core CRM',
  'Productivity',
  'Data',
  'Integrations',
  'AI',
] as const;

export type FeatureFlagCategory = (typeof FEATURE_FLAG_CATEGORIES)[number];

/** Per-role override map — keys are user roles, values are enable/disable overrides. */
export const roleOverridesSchema = z
  .object(
    Object.fromEntries(USER_ROLES.map((r) => [r, z.boolean().optional()])) as Record<
      (typeof USER_ROLES)[number],
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .nullable();

export type RoleOverrides = z.infer<typeof roleOverridesSchema>;

/** Request body for PATCH /api/v1/admin/feature-flags/:key */
export const updateFeatureFlagSchema = z.object({
  enabled: z.boolean({
    required_error: 'enabled is required',
    invalid_type_error: 'enabled must be a boolean',
  }),
  role_overrides: roleOverridesSchema.optional(),
});

export type UpdateFeatureFlagInput = z.infer<typeof updateFeatureFlagSchema>;

/** Shape of a feature flag row returned from the API. */
export interface FeatureFlagRow {
  flag_key: FeatureFlagKey;
  label: string;
  description: string;
  category: FeatureFlagCategory;
  enabled: boolean;
  role_overrides: RoleOverrides;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  system_flag: boolean;
  /** Count of distinct users who used this feature in the last 30 days. */
  active_user_count: number;
}
