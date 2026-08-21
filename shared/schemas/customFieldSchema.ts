/**
 * Shared Zod schemas for custom field definitions and values.
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';

export const ENTITY_TYPES = ['contact', 'account', 'deal'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'select'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Shape of a custom_field_definitions row as returned by GET /api/v1/custom-fields/definitions.
 */
export const customFieldDefinitionResponseSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.enum(ENTITY_TYPES),
  name: z.string(),
  field_type: z.enum(FIELD_TYPES),
  options: z.array(z.string()).nullable(),
  sort_order: z.number().int(),
  /** Excludes this field's value from AI payloads via the data minimization layer. */
  pii_excluded: z.boolean(),
  created_at: z.string(),
});

export type CustomFieldDefinitionResponse = z.infer<typeof customFieldDefinitionResponseSchema>;

/**
 * Request body for creating a new custom field definition.
 */
export const createCustomFieldDefinitionSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  name: z
    .string({ required_error: 'Field name is required' })
    .min(1, 'Field name is required')
    .max(100, 'Field name must be 100 characters or fewer')
    .trim(),
  field_type: z.enum(FIELD_TYPES),
  options: z.array(z.string().min(1).max(100)).max(50).nullable().optional(),
  sort_order: z.number().int().nonnegative().optional(),
});

export type CreateCustomFieldDefinitionInput = z.infer<typeof createCustomFieldDefinitionSchema>;

/**
 * Request body for updating a custom field definition.
 * field_type cannot be changed after creation.
 */
export const updateCustomFieldDefinitionSchema = z
  .object({
    name: z.string().min(1).max(100).trim().optional(),
    options: z.array(z.string().min(1).max(100)).max(50).nullable().optional(),
    sort_order: z.number().int().nonnegative().optional(),
    pii_excluded: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateCustomFieldDefinitionInput = z.infer<typeof updateCustomFieldDefinitionSchema>;

/**
 * A single custom field value input — used in PUT /:entityType/:recordId/custom-fields.
 */
export const customFieldValueSchema = z.object({
  definition_id: z.string().uuid(),
  value: z.string().nullable(),
});

export type CustomFieldValueInput = z.infer<typeof customFieldValueSchema>;

/**
 * Shape of a custom field value as returned by GET /:entityType/:recordId/custom-fields.
 */
export const customFieldValueResponseSchema = z.object({
  definition_id: z.string().uuid(),
  record_id: z.string().uuid(),
  value: z.string().nullable(),
  definition: customFieldDefinitionResponseSchema,
});

export type CustomFieldValueResponse = z.infer<typeof customFieldValueResponseSchema>;
