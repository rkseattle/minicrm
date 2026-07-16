/**
 * Shared Zod schemas and types for the feature flag registry.
 * Imported by both the server (validation) and the client (form validation, display).
 * (MINCRM-463, MINCRM-490, MINCRM-492, MINCRM-565)
 */

import { z } from 'zod';

/**
 * All valid feature flag keys — must match the seed rows in migrations 066, 071, 140, 147-149,
 * and 151-152.
 * AI sub-feature keys (ai_nli_page through ai_stage_advancement) were added in
 * migration 071 (MINCRM-460). ai_win_loss_insights was added in migration 140 (MINCRM-464).
 * ai_meeting_brief, ai_warm_intro_path, and ai_sentiment_tracking were added in
 * migrations 147-149 (MINCRM-465, MINCRM-468, MINCRM-472). ai_relationship_health_score and
 * ai_followup_timing_suggestions were added in migrations 151-152 (MINCRM-467, MINCRM-470).
 * ai_rep_coaching_insights was added in migration 153 (MINCRM-474).
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
  'ai_lead_scoring',
  'ai_lead_score_narrative',
  'ai_deal_health_check',
  'ai_stage_advancement',
  'ai_win_loss_insights',
  'ai_champion_blocker_detection',
  'ai_churn_expansion_detection',
  'ai_objection_pattern_matching',
  'ai_proposal_draft_generation',
  'ai_meeting_brief',
  'ai_warm_intro_path',
  'ai_sentiment_tracking',
  'ai_relationship_health_score',
  'ai_followup_timing_suggestions',
  'ai_rep_coaching_insights',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/** UI grouping categories — must match the category values in migration 066. */
export const FEATURE_FLAG_CATEGORIES = [
  'Core CRM',
  'Productivity',
  'Data',
  'Integrations',
  'AI',
] as const;

export type FeatureFlagCategory = (typeof FEATURE_FLAG_CATEGORIES)[number];

/**
 * Per-role override map — keys are arbitrary role name strings (built-in or custom),
 * values are explicit enable/disable overrides. (MINCRM-565)
 */
export const roleOverridesSchema = z.record(z.string().min(1), z.boolean()).nullable();

export type RoleOverrides = z.infer<typeof roleOverridesSchema>;

// ── Rollout (MINCRM-490) ──────────────────────────────────────────────────────

/** A single scheduled rollout advancement step. */
export const rolloutStageSchema = z.object({
  percentage: z
    .number()
    .int()
    .min(0, { message: 'percentage must be between 0 and 100' })
    .max(100, { message: 'percentage must be between 0 and 100' }),
  scheduled_at: z.string().datetime({ message: 'scheduled_at must be a valid ISO 8601 datetime' }),
});

export type RolloutStage = z.infer<typeof rolloutStageSchema>;

/**
 * Validates an ordered array of rollout stages.
 * Each stage's scheduled_at must be strictly after the previous stage's scheduled_at.
 */
export const rolloutStagesSchema = z
  .array(rolloutStageSchema)
  .refine(
    (stages) =>
      stages.every(
        (stage, i) =>
          i === 0 || new Date(stage.scheduled_at) > new Date(stages[i - 1]!.scheduled_at),
      ),
    { message: 'rollout_stages must be ordered ascending by scheduled_at' },
  )
  .nullable();

// ── User overrides (MINCRM-492) ────────────────────────────────────────────────

/** Override directions for per-user feature flag overrides. */
export const OVERRIDE_DIRECTIONS = ['force_enabled', 'force_disabled'] as const;
export type OverrideDirection = (typeof OVERRIDE_DIRECTIONS)[number];

/** A single per-user override entry from GET /admin/feature-flags/:key/overrides. */
export interface UserOverrideEntry {
  id: string;
  flag_key: string;
  user_id: string;
  name: string;
  email: string;
  override: OverrideDirection;
  reason: string | null;
  added_at: string;
}

/** Request body for PUT /admin/feature-flags/:key/overrides/:userId */
export const upsertUserOverrideSchema = z.object({
  override: z.enum(OVERRIDE_DIRECTIONS, {
    required_error: 'override is required',
    invalid_type_error: "override must be 'force_enabled' or 'force_disabled'",
  }),
  reason: z.string().max(1000).nullable().optional(),
});

export type UpsertUserOverrideInput = z.infer<typeof upsertUserOverrideSchema>;

/** Override counts per direction, included in FeatureFlagRow. */
export interface OverrideCount {
  force_enabled: number;
  force_disabled: number;
}

// ── PATCH request body ─────────────────────────────────────────────────────────

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
  rollout_percentage: z
    .number()
    .int()
    .min(0, { message: 'rollout_percentage must be between 0 and 100' })
    .max(100, { message: 'rollout_percentage must be between 0 and 100' })
    .nullable()
    .optional(),
  rollout_stages: rolloutStagesSchema.optional(),
  /** Assign flag to a group (string key) or unassign (null). (MINCRM-491) */
  group_key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_-]+$/, { message: 'group_key must be lowercase alphanumeric with _ or -' })
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
  /** 0–100 percentage of users who see this flag as enabled via rollout bucketing. null = no rollout. (MINCRM-490) */
  rollout_percentage: number | null;
  /** Scheduled rollout advancement steps, ordered ascending by scheduled_at. (MINCRM-490) */
  rollout_stages: RolloutStage[] | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  system_flag: boolean;
  /** Count of distinct users who used this feature in the last 30 days. */
  active_user_count: number;
  /** Count of users explicitly enrolled in the beta for this flag. */
  beta_user_count: number;
  /** Count of per-user forced overrides by direction. (MINCRM-492) */
  override_count: OverrideCount;
  /** Group this flag belongs to, or null if ungrouped. (MINCRM-491) */
  group_key: string | null;
}

// ── Flag Groups (MINCRM-491) ──────────────────────────────────────────────────

/** Validation pattern for group_key values — lowercase alphanumeric with _ or -. */
export const GROUP_KEY_PATTERN = /^[a-z0-9_-]+$/;

/** Request body for POST /admin/feature-flags/groups */
export const createFlagGroupSchema = z.object({
  group_key: z
    .string()
    .min(1, { message: 'group_key is required' })
    .max(100, { message: 'group_key must be at most 100 characters' })
    .regex(GROUP_KEY_PATTERN, {
      message: 'group_key must be lowercase alphanumeric with _ or -',
    }),
  label: z
    .string()
    .min(1, { message: 'label is required' })
    .max(100, { message: 'label must be at most 100 characters' }),
  description: z
    .string()
    .max(1000, { message: 'description must be at most 1000 characters' })
    .optional()
    .default(''),
});

export type CreateFlagGroupInput = z.input<typeof createFlagGroupSchema>;

/** Request body for PATCH /admin/feature-flags/groups/:key */
export const updateFlagGroupSchema = z.object({
  enabled: z.boolean({ invalid_type_error: 'enabled must be a boolean' }).optional(),
  label: z
    .string()
    .min(1, { message: 'label must be non-empty' })
    .max(100, { message: 'label must be at most 100 characters' })
    .optional(),
  description: z
    .string()
    .max(1000, { message: 'description must be at most 1000 characters' })
    .optional(),
  enable_at: z
    .string()
    .datetime({ message: 'enable_at must be a valid ISO 8601 datetime string' })
    .refine((val) => new Date(val) > new Date(), {
      message: 'enable_at must be a future date',
    })
    .nullable()
    .optional(),
});

export type UpdateFlagGroupInput = z.infer<typeof updateFlagGroupSchema>;

/** A single enrolled beta user entry for a group. */
export interface GroupBetaUserEntry {
  group_key: string;
  user_id: string;
  name: string;
  email: string;
  added_at: string;
}

/** Shape of a flag group row returned from the API. */
export interface FlagGroupRow {
  group_key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** ISO 8601 datetime; when set and <= now(), the group gate is treated as passing. */
  enable_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
  /** Number of feature flags assigned to this group. */
  member_count: number;
  /** Number of users enrolled in this group's beta list. */
  beta_user_count: number;
}
