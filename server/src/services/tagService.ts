/**
 * Tag service — business logic for tag CRUD and entity attachment (MINCRM-186).
 * All database access for tags goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateTagInput,
  UpdateTagInput,
  AttachTagInput,
} from '@minicrm/shared/schemas/tagSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { writeAuditEntryBestEffort } from './auditService.js';
import type { AuditActor, AuditRecordType } from './auditService.js';

/** Shape of a tag row returned from the database */
export interface TagRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

/** Valid entity types that support tagging */
export type TaggableEntity = 'contact' | 'account' | 'deal' | 'lead' | 'note';

/** Entity types that support standalone attach/detach tag operations.
 * 'note' is excluded: note tags are managed atomically via syncEntityTagsWithinTransaction. */
export type AttachableEntity = Exclude<TaggableEntity, 'note'>;

/** Per-entity usage counts returned by getTagUsageSummary (MINCRM-433) */
export interface TagUsageSummary {
  tag_id: string;
  tag_name: string;
  contacts: number;
  accounts: number;
  deals: number;
  leads: number;
  total: number;
}

/** Maps attachable entity type to its AuditRecordType for audit log entries */
const ENTITY_AUDIT_TYPE: Record<AttachableEntity, AuditRecordType> = {
  contact: 'contact',
  account: 'account',
  deal: 'deal',
  lead: 'lead',
};

/** Maps entity type to its junction table and FK column name */
const ENTITY_TABLE: Record<TaggableEntity, { table: string; fkCol: string }> = {
  contact: { table: 'contact_tags', fkCol: 'contact_id' },
  account: { table: 'account_tags', fkCol: 'account_id' },
  deal: { table: 'deal_tags', fkCol: 'deal_id' },
  lead: { table: 'lead_tags', fkCol: 'lead_id' },
  note: { table: 'note_tags', fkCol: 'note_id' },
};

/**
 * Returns a paginated list of tags ordered by name.
 *
 * @param page - 1-based page number (default 1)
 * @param limit - Records per page (default 25)
 * @returns Paginated response with tag rows and total count
 */
export async function listTags(page = 1, limit = 25): Promise<PaginatedResponse<TagRow>> {
  const offset = (page - 1) * limit;
  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM tags`),
    pool.query<TagRow>(
      `SELECT id, name, created_at, updated_at FROM tags ORDER BY name ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);
  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Returns a single tag by ID, or null if not found.
 *
 * @param id - Tag UUID
 */
export async function findTagById(id: string): Promise<TagRow | null> {
  const result = await pool.query<TagRow>(
    `SELECT id, name, created_at, updated_at FROM tags WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates a new tag with the given name (lowercased, trimmed by schema).
 * Returns the existing tag if one with that name already exists (idempotent).
 *
 * @param params - Tag fields
 */
export async function createTag(params: CreateTagInput): Promise<TagRow> {
  const result = await pool.query<TagRow>(
    `INSERT INTO tags (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET updated_at = now()
     RETURNING id, name, created_at, updated_at`,
    [params.name],
  );
  return result.rows[0];
}

/**
 * Renames a tag. Returns the updated row, or null if not found.
 * The new name is already lowercased/trimmed by the schema.
 *
 * @param id - Tag UUID
 * @param params - Fields to update
 */
export async function updateTag(id: string, params: UpdateTagInput): Promise<TagRow | null> {
  if (!params.name) {
    return findTagById(id);
  }
  const result = await pool.query<TagRow>(
    `UPDATE tags SET name = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, name, created_at, updated_at`,
    [params.name, id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns the count of records tagged with a given tag, broken down by entity type.
 * Used to populate the rename/delete confirmation summary in the NLI. (MINCRM-433)
 *
 * @param tagId - Tag UUID
 */
export async function getTagUsageSummary(tagId: string): Promise<TagUsageSummary | null> {
  const tagRow = await findTagById(tagId);
  if (!tagRow) return null;

  const result = await pool.query<{
    contacts: string;
    accounts: string;
    deals: string;
    leads: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM contact_tags WHERE tag_id = $1)::int AS contacts,
       (SELECT COUNT(*) FROM account_tags WHERE tag_id = $1)::int AS accounts,
       (SELECT COUNT(*) FROM deal_tags    WHERE tag_id = $1)::int AS deals,
       (SELECT COUNT(*) FROM lead_tags    WHERE tag_id = $1)::int AS leads`,
    [tagId],
  );

  const row = result.rows[0]!;
  const contacts = parseInt(row.contacts, 10);
  const accounts = parseInt(row.accounts, 10);
  const deals = parseInt(row.deals, 10);
  const leads = parseInt(row.leads, 10);

  return {
    tag_id: tagRow.id,
    tag_name: tagRow.name,
    contacts,
    accounts,
    deals,
    leads,
    total: contacts + accounts + deals + leads,
  };
}

/**
 * Renames a tag by looking it up by name, then updating it.
 * Returns the updated tag row and usage summary for confirmation display, or null if not found.
 * The rename propagates automatically to all junction tables via shared tag rows. (MINCRM-433)
 *
 * @param currentName - Existing tag name (case-insensitive lookup)
 * @param newName - Desired new tag name
 */
export async function renameTagByName(
  currentName: string,
  newName: string,
): Promise<{ tag: TagRow; summary: TagUsageSummary } | null> {
  const existing = await pool.query<TagRow>(
    `SELECT id, name, created_at, updated_at FROM tags WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [currentName],
  );
  const tag = existing.rows[0];
  if (!tag) return null;

  const updated = await updateTag(tag.id, { name: newName });
  if (!updated) return null;

  const summary = await getTagUsageSummary(updated.id);
  if (!summary) return null;

  // Reflect the new name in the summary returned to the caller
  summary.tag_name = updated.name;

  return { tag: updated, summary };
}

/**
 * Deletes a tag by ID. Junction table rows are removed via ON DELETE CASCADE.
 * Returns true if a row was deleted, false if not found.
 *
 * @param id - Tag UUID
 */
export async function deleteTag(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM tags WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Upserts a tag by name within an existing transaction client.
 * Returns the tag ID. Intended for use inside service transactions.
 *
 * @param client - Pool client already inside a BEGIN block
 * @param name - Tag name (should be pre-lowercased/trimmed)
 */
export async function upsertTagByName(client: PoolClient, name: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tags (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

/**
 * Replaces the full set of tags for an entity within an existing transaction.
 * Deletes all current junction rows, then inserts new ones for each tag name.
 * Tag rows in the tags table are upserted idempotently.
 *
 * Use this inside service transactions where you need atomic tag replacement
 * (e.g. note create/update).
 *
 * @param client - Pool client already inside a BEGIN block
 * @param entity - Entity type
 * @param entityId - UUID of the record
 * @param tagNames - New complete set of tag names (lowercased/trimmed by schema)
 */
export async function syncEntityTagsWithinTransaction(
  client: PoolClient,
  entity: TaggableEntity,
  entityId: string,
  tagNames: string[],
): Promise<void> {
  const { table, fkCol } = ENTITY_TABLE[entity];

  // Remove all existing tag associations
  await client.query(`DELETE FROM ${table} WHERE ${fkCol} = $1`, [entityId]);

  // Upsert each tag and insert junction rows
  for (const name of tagNames) {
    const trimmed = name.toLowerCase().trim();
    if (!trimmed) continue;
    const tagId = await upsertTagByName(client, trimmed);
    await client.query(
      `INSERT INTO ${table} (${fkCol}, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [entityId, tagId],
    );
  }
}

/**
 * Returns all tags attached to a given record.
 *
 * @param entity - Entity type ('contact' | 'account' | 'deal' | 'note')
 * @param entityId - UUID of the record
 */
export async function listEntityTags(entity: TaggableEntity, entityId: string): Promise<TagRow[]> {
  const { table, fkCol } = ENTITY_TABLE[entity];
  const result = await pool.query<TagRow>(
    `SELECT t.id, t.name, t.created_at, t.updated_at
     FROM tags t
     INNER JOIN ${table} jt ON jt.tag_id = t.id
     WHERE jt.${fkCol} = $1
     ORDER BY t.name ASC`,
    [entityId],
  );
  return result.rows;
}

/**
 * Attaches a tag to a record, creating the tag if it does not exist.
 * Idempotent — attaching a tag that is already attached is a no-op.
 *
 * @param entity - Entity type
 * @param entityId - UUID of the record
 * @param params - Tag name (lowercased, trimmed by schema)
 * @param actor - Optional user performing the action (for audit log)
 * @returns The tag row
 */
export async function attachTag(
  entity: AttachableEntity,
  entityId: string,
  params: AttachTagInput,
  actor?: AuditActor,
): Promise<TagRow> {
  const { table, fkCol } = ENTITY_TABLE[entity];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert the tag by name
    const tagResult = await client.query<TagRow>(
      `INSERT INTO tags (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET updated_at = now()
       RETURNING id, name, created_at, updated_at`,
      [params.name],
    );
    const tag = tagResult.rows[0];

    // Attach to entity (idempotent)
    const attachResult = await client.query<{ rowcount: string }>(
      `INSERT INTO ${table} (${fkCol}, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [entityId, tag.id],
    );

    await client.query('COMMIT');

    if (actor && (attachResult.rowCount ?? 0) > 0) {
      void writeAuditEntryBestEffort({
        recordType: ENTITY_AUDIT_TYPE[entity],
        recordId: entityId,
        eventType: 'updated',
        fieldName: 'tags',
        newValue: tag.name,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    return tag;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Detaches a tag from a record. No-op if the tag is not attached.
 *
 * @param entity - Entity type
 * @param entityId - UUID of the record
 * @param tagId - Tag UUID
 * @param actor - Optional user performing the action (for audit log)
 * @returns true if removed, false if the association did not exist
 */
export async function detachTag(
  entity: AttachableEntity,
  entityId: string,
  tagId: string,
  actor?: AuditActor,
): Promise<boolean> {
  const { table, fkCol } = ENTITY_TABLE[entity];

  // Fetch tag name before deletion for the audit entry
  const tagRow = actor
    ? await pool.query<{ name: string }>('SELECT name FROM tags WHERE id = $1 LIMIT 1', [tagId])
    : null;
  const tagName = tagRow?.rows[0]?.name ?? null;

  const result = await pool.query(`DELETE FROM ${table} WHERE ${fkCol} = $1 AND tag_id = $2`, [
    entityId,
    tagId,
  ]);
  const removed = (result.rowCount ?? 0) > 0;

  if (actor && removed && tagName) {
    void writeAuditEntryBestEffort({
      recordType: ENTITY_AUDIT_TYPE[entity],
      recordId: entityId,
      eventType: 'updated',
      fieldName: 'tags',
      oldValue: tagName,
      changedById: actor.id,
      changedByName: actor.name,
    });
  }

  return removed;
}
