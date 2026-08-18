/**
 * Shared Zod schemas and types for AI field exclusion configuration.
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';
import { ENTITY_TYPES } from './customFieldSchema.js';

/** Request body for PATCH /api/v1/admin/ai/field-exclusions. */
export const setFieldExclusionSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  field_name: z.string().min(1),
  excluded: z.boolean(),
});

export type SetFieldExclusionInput = z.infer<typeof setFieldExclusionSchema>;

/** Response shape for PATCH /api/v1/admin/ai/field-exclusions. */
export interface SetFieldExclusionResponse {
  entity_type: string;
  field_name: string;
  excluded: boolean;
}

/** A single standard-field row in the effective exclusion list. */
export interface StandardFieldExclusionEntry {
  entity_type: string;
  field_name: string;
  excluded: boolean;
}

/** A single custom-field row in the effective exclusion list (read-only). */
export interface CustomFieldExclusionEntry {
  entity_type: string;
  field_name: string;
  excluded: boolean;
}

/** Response shape for GET /api/v1/admin/ai/field-exclusions. */
export interface EffectiveExclusionListResponse {
  always_excluded: string[];
  standard_fields: StandardFieldExclusionEntry[];
  custom_fields: CustomFieldExclusionEntry[];
}
