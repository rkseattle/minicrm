/**
 * Custom field service — business logic for custom field definitions and values.
 * All database access for custom_field_definitions and custom_field_values goes here. (MINCRM-276)
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateCustomFieldDefinitionInput,
  UpdateCustomFieldDefinitionInput,
  CustomFieldValueInput,
} from '@minicrm/shared/schemas/customFieldSchema.js';
import {
  writeAuditEntry,
  writeAuditEntryBestEffort,
} from './auditService.js';
import type { AuditRecordType } from './auditService.js';

/** Actor info required to write audit entries on write operations */
export interface AuditActor {
  id: string;
  name: string;
}

/** Fallback actor used when no user context is available */
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/** Shape of a custom_field_definitions row as stored in the database */
export interface CustomFieldDefinitionRow {
  id: string;
  entity_type: string;
  name: string;
  field_type: string;
  options: string[] | null;
  sort_order: number;
  created_at: Date;
}

/** Shape of a custom_field_values row as stored in the database */
export interface CustomFieldValueRow {
  id: string;
  definition_id: string;
  record_id: string;
  value: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Value row joined with its definition */
export interface CustomFieldValueWithDefinition extends CustomFieldValueRow {
  definition: CustomFieldDefinitionRow;
}

const DEFINITION_SELECT = 'id, entity_type, name, field_type, options, sort_order, created_at';

/**
 * Returns all custom field definitions for the given entity type.
 *
 * @param entityType - 'contact', 'account', or 'deal'
 * @returns Array of definition rows ordered by sort_order ASC, name ASC
 */
export async function listDefinitions(entityType: string): Promise<CustomFieldDefinitionRow[]> {
  const result = await pool.query<CustomFieldDefinitionRow>(
    `SELECT ${DEFINITION_SELECT}
     FROM custom_field_definitions
     WHERE entity_type = $1
     ORDER BY sort_order ASC, name ASC`,
    [entityType],
  );
  return result.rows;
}

/**
 * Creates a new custom field definition.
 *
 * Name uniqueness is enforced per entity_type by the DB unique constraint.
 * A 23505 violation is caught and re-thrown as CUSTOM_FIELD_NAME_CONFLICT.
 *
 * @param input - Definition fields from the validated request
 * @returns The inserted definition row
 * @throws Error with code CUSTOM_FIELD_NAME_CONFLICT if name already exists for entity_type
 */
export async function createDefinition(
  input: CreateCustomFieldDefinitionInput,
): Promise<CustomFieldDefinitionRow> {
  const { entity_type, name, field_type, options, sort_order } = input;

  try {
    const result = await pool.query<CustomFieldDefinitionRow>(
      `INSERT INTO custom_field_definitions (entity_type, name, field_type, options, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${DEFINITION_SELECT}`,
      [entity_type, name, field_type, options != null ? JSON.stringify(options) : null, sort_order ?? 0],
    );
    return result.rows[0];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const e = new Error(`A custom field named "${name}" already exists for ${entity_type}`);
      (e as NodeJS.ErrnoException).code = 'CUSTOM_FIELD_NAME_CONFLICT';
      throw e;
    }
    throw err;
  }
}

/**
 * Updates an existing custom field definition.
 * field_type cannot be changed after creation.
 *
 * @param id - Definition UUID
 * @param input - Fields to update
 * @returns The updated definition row, or null if not found
 * @throws Error with code CUSTOM_FIELD_NAME_CONFLICT if the new name already exists
 */
export async function updateDefinition(
  id: string,
  input: UpdateCustomFieldDefinitionInput,
): Promise<CustomFieldDefinitionRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [id];

  if (input.name !== undefined) {
    values.push(input.name);
    setClauses.push(`name = $${values.length}`);
  }
  if (input.options !== undefined) {
    values.push(input.options ? JSON.stringify(input.options) : null);
    setClauses.push(`options = $${values.length}`);
  }
  if (input.sort_order !== undefined) {
    values.push(input.sort_order);
    setClauses.push(`sort_order = $${values.length}`);
  }

  if (setClauses.length === 0) return null;

  try {
    const result = await pool.query<CustomFieldDefinitionRow>(
      `UPDATE custom_field_definitions
       SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING ${DEFINITION_SELECT}`,
      values,
    );
    return result.rows[0] ?? null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === '23505') {
      const e = new Error(`A custom field named "${input.name}" already exists for this entity type`);
      (e as NodeJS.ErrnoException).code = 'CUSTOM_FIELD_NAME_CONFLICT';
      throw e;
    }
    throw err;
  }
}

/**
 * Deletes a custom field definition.
 * Cascades to custom_field_values via the DB foreign key constraint.
 *
 * @param id - Definition UUID
 * @returns The deleted definition row, or null if not found
 */
export async function deleteDefinition(
  id: string,
): Promise<CustomFieldDefinitionRow | null> {
  const result = await pool.query<CustomFieldDefinitionRow>(
    `DELETE FROM custom_field_definitions WHERE id = $1 RETURNING ${DEFINITION_SELECT}`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns all custom field values for a given record, joined with their definitions.
 *
 * @param recordId - UUID of the record (contact, account, or deal)
 * @returns Array of value rows with embedded definitions, ordered by sort_order ASC, name ASC
 */
export async function getValuesForRecord(
  recordId: string,
): Promise<CustomFieldValueWithDefinition[]> {
  const result = await pool.query<
    CustomFieldValueRow & {
      def_id: string;
      def_entity_type: string;
      def_name: string;
      def_field_type: string;
      def_options: string[] | null;
      def_sort_order: number;
      def_created_at: Date;
    }
  >(
    `SELECT
       v.id, v.definition_id, v.record_id, v.value, v.created_at, v.updated_at,
       d.id AS def_id,
       d.entity_type AS def_entity_type,
       d.name AS def_name,
       d.field_type AS def_field_type,
       d.options AS def_options,
       d.sort_order AS def_sort_order,
       d.created_at AS def_created_at
     FROM custom_field_values v
     JOIN custom_field_definitions d ON d.id = v.definition_id
     WHERE v.record_id = $1
     ORDER BY d.sort_order ASC, d.name ASC`,
    [recordId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    definition_id: row.definition_id,
    record_id: row.record_id,
    value: row.value,
    created_at: row.created_at,
    updated_at: row.updated_at,
    definition: {
      id: row.def_id,
      entity_type: row.def_entity_type,
      name: row.def_name,
      field_type: row.def_field_type,
      options: row.def_options,
      sort_order: row.def_sort_order,
      created_at: row.def_created_at,
    },
  }));
}

/**
 * Upserts custom field values for a record.
 *
 * For each value in the input array, performs INSERT ... ON CONFLICT DO UPDATE.
 * Writes an audit entry per upserted value. If a transaction client is provided,
 * runs queries and audit writes within that transaction; otherwise uses the pool
 * directly and writes best-effort audit entries.
 *
 * @param recordId - UUID of the record being updated
 * @param values - Array of { definition_id, value } inputs
 * @param actor - User performing the action
 * @param recordType - Audit record type matching the entity ('contact', 'account', 'deal')
 * @param txClient - Optional active PoolClient for transactional use
 */
export async function upsertValues(
  recordId: string,
  values: CustomFieldValueInput[],
  actor: AuditActor = SYSTEM_ACTOR,
  recordType: AuditRecordType,
  txClient?: PoolClient,
): Promise<void> {
  if (values.length === 0) return;

  // Load definition names once to use in audit entries
  const defIds = values.map((v) => v.definition_id);
  const defResult = await (txClient ?? pool).query<{ id: string; name: string }>(
    `SELECT id, name FROM custom_field_definitions WHERE id = ANY($1)`,
    [defIds],
  );
  const defNameMap = new Map(defResult.rows.map((r) => [r.id, r.name]));

  for (const { definition_id, value } of values) {
    await (txClient ?? pool).query(
      `INSERT INTO custom_field_values (definition_id, record_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (definition_id, record_id)
       DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [definition_id, recordId, value],
    );

    const fieldName = defNameMap.get(definition_id) ?? definition_id;

    if (txClient) {
      await writeAuditEntry(txClient, {
        recordType,
        recordId,
        recordName: recordId,
        eventType: 'updated',
        fieldName,
        newValue: value,
        changedById: actor.id,
        changedByName: actor.name,
      });
    } else {
      void writeAuditEntryBestEffort({
        recordType,
        recordId,
        recordName: recordId,
        eventType: 'updated',
        fieldName,
        newValue: value,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }
  }
}

/**
 * Maps a CustomFieldDefinitionRow to the API response shape.
 */
export function toDefinitionResponse(row: CustomFieldDefinitionRow): {
  id: string;
  entity_type: string;
  name: string;
  field_type: string;
  options: string[] | null;
  sort_order: number;
  created_at: string;
} {
  return {
    id: row.id,
    entity_type: row.entity_type,
    name: row.name,
    field_type: row.field_type,
    options: row.options,
    sort_order: row.sort_order,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}
