/**
 * AI field exclusion service — admin-configurable standard-field AI payload
 * exclusions, plus the merged "effective exclusion list" view. (MINCRM-461)
 *
 * Three sources are merged into one effective view, but only one of them is
 * ever written by this service:
 *   1. ALWAYS_EXCLUDED_FIELDS (piiFilter.ts) — hardcoded, immutable, never
 *      written here; surfaced read-only as "locked" entries.
 *   2. ai_field_exclusions — admin-configurable standard-field toggles; this
 *      service owns all reads/writes for this table.
 *   3. custom_field_definitions.pii_excluded — owned by customFieldService.ts;
 *      surfaced here read-only for the "effective exclusion list" summary.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { writeAuditEntry, type AuditActor } from './auditService.js';
import { invalidateFieldExclusionCache } from '../ai/piiFilter.js';
import { ALWAYS_EXCLUDED_FIELDS } from '../ai/piiFilter.js';
import { STANDARD_FIELDS_BY_ENTITY, isKnownStandardField } from '../ai/standardFieldRegistry.js';
import type { EntityType } from '@minicrm/shared/schemas/customFieldSchema.js';

// ── Internal types ─────────────────────────────────────────────────────────────

interface FieldExclusionRow {
  entity_type: string;
  field_name: string;
  excluded: boolean;
}

interface CustomFieldPiiRow {
  entity_type: string;
  name: string;
  pii_excluded: boolean;
}

/** A single standard-field row in the effective exclusion list. */
export interface StandardFieldExclusionEntry {
  entity_type: EntityType;
  field_name: string;
  excluded: boolean;
}

/** A single custom-field row in the effective exclusion list (read-only here). */
export interface CustomFieldExclusionEntry {
  entity_type: EntityType;
  field_name: string;
  excluded: boolean;
}

/** The full effective exclusion list: defaults + admin overrides + custom fields. */
export interface EffectiveExclusionList {
  /** Immutable field names excluded from every AI payload regardless of configuration. */
  always_excluded: string[];
  /** Admin-configurable standard fields, with their current excluded state. */
  standard_fields: StandardFieldExclusionEntry[];
  /** Custom fields' current pii_excluded state — managed via the custom fields admin UI. */
  custom_fields: CustomFieldExclusionEntry[];
}

// ── Read operations ────────────────────────────────────────────────────────────

/**
 * Returns the effective AI field exclusion list: the hardcoded always-excluded
 * set, every admin-configurable standard field (defaulting to excluded=false
 * when no override row exists), and every custom field's current pii_excluded
 * state.
 */
export async function getEffectiveExclusionList(): Promise<EffectiveExclusionList> {
  const [overridesResult, customFieldsResult] = await Promise.all([
    pool.query<FieldExclusionRow>(
      `SELECT entity_type, field_name, excluded FROM ai_field_exclusions`,
    ),
    pool.query<CustomFieldPiiRow>(
      `SELECT entity_type, name, pii_excluded FROM custom_field_definitions`,
    ),
  ]);

  const overrideMap = new Map<string, boolean>();
  for (const row of overridesResult.rows) {
    overrideMap.set(`${row.entity_type}:${row.field_name}`, row.excluded);
  }

  const standardFields: StandardFieldExclusionEntry[] = [];
  for (const [entityType, fields] of Object.entries(STANDARD_FIELDS_BY_ENTITY) as Array<
    [EntityType, readonly string[]]
  >) {
    for (const fieldName of fields) {
      standardFields.push({
        entity_type: entityType,
        field_name: fieldName,
        excluded: overrideMap.get(`${entityType}:${fieldName}`) ?? false,
      });
    }
  }

  const customFields: CustomFieldExclusionEntry[] = customFieldsResult.rows.map((row) => ({
    entity_type: row.entity_type as EntityType,
    field_name: row.name,
    excluded: row.pii_excluded,
  }));

  return {
    always_excluded: Array.from(ALWAYS_EXCLUDED_FIELDS).sort(),
    standard_fields: standardFields,
    custom_fields: customFields,
  };
}

// ── Write operations ───────────────────────────────────────────────────────────

/**
 * Sets a standard field's AI payload exclusion state.
 * Rejects unknown entity_type/field_name combinations to prevent arbitrary
 * field-name injection into ai_field_exclusions.
 *
 * Writes an audit entry and invalidates piiFilter's in-memory cache in the same
 * request so the change takes effect on the next AI request — no restart required.
 */
export async function setFieldExclusion(
  entityType: string,
  fieldName: string,
  excluded: boolean,
  actor: AuditActor,
): Promise<void> {
  if (!isKnownStandardField(entityType, fieldName)) {
    const e = new Error(`Unknown standard field "${fieldName}" for entity type "${entityType}"`);
    (e as NodeJS.ErrnoException).code = 'UNKNOWN_FIELD';
    throw e;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<{ excluded: boolean }>(
      `SELECT excluded FROM ai_field_exclusions WHERE entity_type = $1 AND field_name = $2 FOR UPDATE`,
      [entityType, fieldName],
    );
    const previousExcluded = before.rows[0]?.excluded ?? false;

    await client.query(
      `INSERT INTO ai_field_exclusions (entity_type, field_name, excluded)
       VALUES ($1, $2, $3)
       ON CONFLICT (entity_type, field_name) DO UPDATE
         SET excluded = $3, updated_at = now()`,
      [entityType, fieldName, excluded],
    );

    await writeAuditEntry(client, {
      recordType: 'ai_field_exclusion',
      recordId: null,
      recordName: `${entityType}.${fieldName}`,
      eventType: 'updated',
      fieldName: 'excluded',
      oldValue: String(previousExcluded),
      newValue: String(excluded),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  invalidateFieldExclusionCache();
}
