/**
 * Shared Zod schemas for org-level data visibility policy settings. (MINCRM-538)
 * Imported by both the server (validation + service layer) and the client (API types).
 */

import { z } from 'zod';

/** Object types that have configurable visibility policies */
export const VISIBILITY_OBJECT_TYPES = ['contact', 'deal', 'activity', 'account'] as const;
export type VisibilityObjectType = (typeof VISIBILITY_OBJECT_TYPES)[number];

/** Visibility policy levels, from most to least restrictive */
export const VISIBILITY_POLICIES = ['private', 'team', 'org'] as const;
export type VisibilityPolicy = (typeof VISIBILITY_POLICIES)[number];

/** A single object-type → policy mapping as stored in org_visibility_settings */
export const visibilitySettingSchema = z.object({
  object_type: z.enum(VISIBILITY_OBJECT_TYPES),
  policy: z.enum(VISIBILITY_POLICIES),
  updated_at: z.string(),
  updated_by: z.string().uuid().nullable(),
});
export type VisibilitySetting = z.infer<typeof visibilitySettingSchema>;

/** Full org visibility config — one entry per object type */
export const visibilityConfigSchema = z.object({
  contact: z.enum(VISIBILITY_POLICIES),
  deal: z.enum(VISIBILITY_POLICIES),
  activity: z.enum(VISIBILITY_POLICIES),
  account: z.enum(VISIBILITY_POLICIES),
});
export type VisibilityConfig = z.infer<typeof visibilityConfigSchema>;

/** Request body for PUT /api/settings/visibility */
export const updateVisibilityConfigSchema = visibilityConfigSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one visibility policy must be provided',
  });
export type UpdateVisibilityConfigInput = z.infer<typeof updateVisibilityConfigSchema>;
