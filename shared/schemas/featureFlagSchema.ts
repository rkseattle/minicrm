/**
 * Shared Zod schemas and types for the feature flag registry.
 * Imported by both the server (validation) and the client (form validation, display).
 * (MINCRM-463)
 */

import { z } from 'zod';
import { USER_ROLES } from './userSchema.js';

/**
 * All valid feature flag keys — must match the seed rows in migrations 066 and 071.
 * AI sub-feature keys (ai_nli_page through ai_stage_advancement) were added in
 * migration 071 (MINCRM-460).
 */
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
  // AI sub-feature flags (MINCRM-460) — child flags of the 'ai_features' master toggle.
  'ai_nli_page',
  'ai_activity_summarizer',
  'ai_email_draft',
  'ai_task_suggestions',
  'ai_contact_enrichment',
  'ai_duplicate_explanation',
  'ai_lead_score_narrative',
  'ai_deal_health_check',
  'ai_stage_advancement',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/**
 * Flag keys that support per-role overrides (admin/rep toggles in the admin UI).
 * AI sub-feature flags (MINCRM-460) all support role overrides so admins can
 * enable/disable each AI capability independently per role.
 */
export const ROLE_OVERRIDE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  'reporting',
  'csv_export',
  'ai_nli_page',
  'ai_activity_summarizer',
  'ai_email_draft',
  'ai_task_suggestions',
  'ai_contact_enrichment',
  'ai_duplicate_explanation',
  'ai_lead_score_narrative',
  'ai_deal_health_check',
  'ai_stage_advancement',
];

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
  enable_at: z
    .string()
    .datetime({ message: 'enable_at must be a valid ISO 8601 datetime string' })
    .refine((val) => new Date(val) > new Date(), {
      message: 'enable_at must be a future date',
    })
    .nullable()
    .optional(),
});

export type UpdateFeatureFlagInput = z.infer<typeof updateFeatureFlagSchema>;

/** Response from GET /api/v1/feature-flags/me — resolved enabled state per calling user's role. */
export type MyFeatureFlagsResponse = Record<FeatureFlagKey, boolean>;

/** A single enrolled beta user entry from GET /admin/feature-flags/:key/beta-users. */
export interface BetaUserEntry {
  id: string;
  user_id: string;
  name: string;
  email: string;
  added_at: string;
}

/** Request body for POST /admin/feature-flags/:key/beta-users */
export const enrollBetaUserSchema = z.object({
  userId: z.string().uuid({ message: 'userId must be a valid UUID' }),
});

export type EnrollBetaUserInput = z.infer<typeof enrollBetaUserSchema>;

/** Shape of a feature flag row returned from the API. */
export interface FeatureFlagRow {
  flag_key: FeatureFlagKey;
  label: string;
  description: string;
  category: FeatureFlagCategory;
  enabled: boolean;
  role_overrides: RoleOverrides;
  /** ISO 8601 datetime; when set and <= now(), the flag is treated as enabled. */
  enable_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  system_flag: boolean;
  /** Count of distinct users who used this feature in the last 30 days. */
  active_user_count: number;
  /** Count of users explicitly enrolled in the beta for this flag. */
  beta_user_count: number;
}
