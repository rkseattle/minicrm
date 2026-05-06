/**
 * Tag service — business logic for tag CRUD and entity attachment (MINCRM-186).
 * All database access for tags goes through this module.
 */

import pool from '../db.js';
import type {
  CreateTagInput,
  UpdateTagInput,
  AttachTagInput,
} from '@minicrm/shared/schemas/tagSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';

/** Shape of a tag row returned from the database */
export interface TagRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

/** Valid entity types that support tagging */
type TaggableEntity = 'contact' | 'account' | 'deal';

/** Maps entity type to its junction table and FK column name */
const ENTITY_TABLE: Record<TaggableEntity, { table: string; fkCol: string }> = {
  contact: { table: 'contact_tags', fkCol: 'contact_id' },
  account: { table: 'account_tags', fkCol: 'account_id' },
  deal: { table: 'deal_tags', fkCol: 'deal_id' },
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
 * Returns all tags attached to a given record.
 *
 * @param entity - Entity type ('contact' | 'account' | 'deal')
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
 * @returns The tag row
 */
export async function attachTag(
  entity: TaggableEntity,
  entityId: string,
  params: AttachTagInput,
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
    await client.query(
      `INSERT INTO ${table} (${fkCol}, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [entityId, tag.id],
    );

    await client.query('COMMIT');
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
 * @returns true if removed, false if the association did not exist
 */
export async function detachTag(
  entity: TaggableEntity,
  entityId: string,
  tagId: string,
): Promise<boolean> {
  const { table, fkCol } = ENTITY_TABLE[entity];
  const result = await pool.query(`DELETE FROM ${table} WHERE ${fkCol} = $1 AND tag_id = $2`, [
    entityId,
    tagId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
