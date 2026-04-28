/**
 * Custom field controller — request/response shaping for custom field endpoints. (MINCRM-276)
 * No business logic here; all DB access goes through customFieldService.
 */

import type { Request, Response } from 'express';
import {
  listDefinitions,
  createDefinition,
  updateDefinition,
  deleteDefinition,
  getValuesForRecord,
  upsertValues,
  toDefinitionResponse,
} from '../services/customFieldService.js';
import {
  createCustomFieldDefinitionSchema,
  updateCustomFieldDefinitionSchema,
  customFieldValueSchema,
  ENTITY_TYPES,
} from '@minicrm/shared/schemas/customFieldSchema.js';
import { z } from 'zod';

/** Validates that a string is a known entity type */
function isValidEntityType(value: string): value is (typeof ENTITY_TYPES)[number] {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * GET /api/custom-fields/definitions?entity_type=contact
 * Returns all definitions for the given entity type.
 */
export async function listCustomFieldDefinitionsHandler(req: Request, res: Response): Promise<void> {
  const entityType = String(req.query['entity_type'] ?? '');
  if (!isValidEntityType(entityType)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'entity_type must be contact, account, or deal' },
    });
    return;
  }

  const definitions = await listDefinitions(entityType);
  res.status(200).json({ definitions: definitions.map(toDefinitionResponse) });
}

/**
 * POST /api/custom-fields/definitions
 * Creates a new custom field definition. Admin only.
 */
export async function createCustomFieldDefinitionHandler(req: Request, res: Response): Promise<void> {
  const parsed = createCustomFieldDefinitionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  try {
    const definition = await createDefinition(parsed.data);
    res.status(201).json(toDefinitionResponse(definition));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'CUSTOM_FIELD_NAME_CONFLICT') {
      res.status(409).json({
        error: { code: 'CUSTOM_FIELD_NAME_CONFLICT', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * PATCH /api/custom-fields/definitions/:id
 * Updates a custom field definition. Admin only.
 */
export async function updateCustomFieldDefinitionHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const parsed = updateCustomFieldDefinitionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  try {
    const definition = await updateDefinition(id, parsed.data);
    if (!definition) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } });
      return;
    }
    res.status(200).json(toDefinitionResponse(definition));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'CUSTOM_FIELD_NAME_CONFLICT') {
      res.status(409).json({
        error: { code: 'CUSTOM_FIELD_NAME_CONFLICT', message: (err as Error).message },
      });
      return;
    }
    throw err;
  }
}

/**
 * DELETE /api/custom-fields/definitions/:id
 * Deletes a custom field definition and cascades to all values. Admin only.
 */
export async function deleteCustomFieldDefinitionHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);

  const definition = await deleteDefinition(id);
  if (!definition) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Custom field not found' } });
    return;
  }
  res.status(200).json({ id });
}

/**
 * GET /api/custom-fields/:entityType/:recordId/custom-fields
 * Returns all custom field values for a record. Authenticated.
 */
export async function getCustomFieldValuesHandler(req: Request, res: Response): Promise<void> {
  const entityType = String(req.params['entityType']);
  const recordId = String(req.params['recordId']);

  if (!isValidEntityType(entityType)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'entityType must be contact, account, or deal' },
    });
    return;
  }

  const valuesWithDefs = await getValuesForRecord(recordId);
  const values = valuesWithDefs.map((v) => ({
    definition_id: v.definition_id,
    record_id: v.record_id,
    value: v.value,
    definition: toDefinitionResponse(v.definition),
  }));

  res.status(200).json({ values });
}

/**
 * PUT /api/custom-fields/:entityType/:recordId/custom-fields
 * Upserts custom field values for a record. Authenticated.
 * Body: array of { definition_id, value }.
 */
export async function putCustomFieldValuesHandler(req: Request, res: Response): Promise<void> {
  const entityType = String(req.params['entityType']);
  const recordId = String(req.params['recordId']);

  if (!isValidEntityType(entityType)) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'entityType must be contact, account, or deal' },
    });
    return;
  }

  const parsed = z.array(customFieldValueSchema).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      },
    });
    return;
  }

  const actor = req.user
    ? { id: req.user.id, name: req.user.name }
    : { id: '00000000-0000-0000-0000-000000000000', name: 'System' };
  await upsertValues(recordId, parsed.data, actor, entityType);

  const valuesWithDefs = await getValuesForRecord(recordId);
  const values = valuesWithDefs.map((v) => ({
    definition_id: v.definition_id,
    record_id: v.record_id,
    value: v.value,
    definition: toDefinitionResponse(v.definition),
  }));

  res.status(200).json({ values });
}
