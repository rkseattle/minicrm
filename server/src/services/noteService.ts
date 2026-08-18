/**
 * Note service — business logic and all DB access for the notes feature.
 *
 * Visibility rules enforced here:
 *   - private: body/title returned only to the creator
 *   - team: visible to all authenticated users (default)
 *   - public: same as team for now (forward-compat)
 *
 * Soft-delete: rows are never hard-deleted; deleted_at is set instead.
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { syncEntityTagsWithinTransaction } from './tagService.js';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  NoteEntityType,
  NoteVisibility,
  NoteResponse,
} from '@minicrm/shared/schemas/noteSchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';

/** Maximum characters for body_text in audit log previews */
const AUDIT_BODY_TEXT_MAX = 200;

/** Placeholder shown in audit log for private note content */
const PRIVATE_NOTE_AUDIT_VALUE = '[private note]';

/** Columns selected when fetching notes with creator/updater display names.
 * Tags are aggregated from note_tags → tags instead of the dropped text[] column. */
const SELECT_COLS = `
  n.id,
  n.entity_type,
  n.entity_id,
  n.title,
  n.body,
  n.body_text,
  n.visibility,
  COALESCE(
    (SELECT array_agg(t.name ORDER BY t.name)
     FROM note_tags nt
     JOIN tags t ON t.id = nt.tag_id
     WHERE nt.note_id = n.id),
    ARRAY[]::text[]
  ) AS tags,
  n.created_by,
  creator.name  AS created_by_name,
  n.updated_by,
  updater.name  AS updated_by_name,
  n.created_at,
  n.updated_at
`;

/** Raw row as returned by PostgreSQL before masking */
interface NoteRow {
  id: string;
  entity_type: NoteEntityType;
  entity_id: string;
  title: string | null;
  body: string;
  body_text: string | null;
  visibility: NoteVisibility;
  tags: string[];
  created_by: string;
  created_by_name: string;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Extracts plain text from a Lexical or Tiptap/ProseMirror editor state JSON document.
 * Walks the node tree collecting text from all relevant node types:
 * - `text` nodes (standard text, inline code via format bitmask)
 * - `mention` nodes (display text from `text` or `value` field depending on plugin)
 * - element nodes with `children` (Lexical: link, autolink, code block, paragraph, etc.)
 * - element nodes with `content` (Tiptap/ProseMirror style)
 * Returns empty string on parse failure or non-object input.
 */
export function extractBodyText(json: string): string {
  try {
    const doc: unknown = JSON.parse(json);
    const parts: string[] = [];

    function walk(node: Record<string, unknown>): void {
      if (node['type'] === 'text' && typeof node['text'] === 'string') {
        parts.push(node['text']);
        return; // text nodes have no meaningful children
      }
      if (node['type'] === 'mention') {
        // Mention nodes store display text in `text` or `value` depending on the plugin.
        // Return early to avoid also walking child text nodes that some plugins co-emit,
        // which would duplicate the label in body_text.
        const label = node['text'] ?? node['value'];
        if (typeof label === 'string') parts.push(label);
        return;
      }
      // Descend into well-known structural keys only — avoids recursing into metadata
      // (url, attrs, etc.).  `root` is Lexical's document wrapper; `children`/`content`
      // are the child-array keys used by Lexical and Tiptap/ProseMirror respectively.
      for (const key of ['root', 'children', 'content'] as const) {
        const val = node[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          walk(val as Record<string, unknown>);
        } else if (Array.isArray(val)) {
          for (const child of val as Record<string, unknown>[]) {
            if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
              walk(child as Record<string, unknown>);
            }
          }
        }
      }
    }

    if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
      walk(doc as Record<string, unknown>);
    }
    return parts.join(' ').trim();
  } catch {
    return '';
  }
}

/** Truncates body_text to the audit preview length, appending "…" if truncated */
function auditBodyText(bodyText: string | null): string {
  if (!bodyText) return '';
  return bodyText.length > AUDIT_BODY_TEXT_MAX
    ? bodyText.slice(0, AUDIT_BODY_TEXT_MAX) + '…'
    : bodyText;
}

/** Applies visibility masking to a raw note row from the caller's perspective */
function maskNote(row: NoteRow, callerId: string): NoteResponse {
  const isMasked = row.visibility === 'private' && row.created_by !== callerId;
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    title: isMasked ? null : row.title,
    body: isMasked ? null : row.body,
    body_text: isMasked ? null : row.body_text,
    visibility: row.visibility,
    tags: row.tags,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    updated_by: row.updated_by,
    updated_by_name: row.updated_by_name,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    is_masked: isMasked,
  };
}

/**
 * Fetches a raw note row by ID within an existing transaction client.
 * Does not apply soft-delete filter so callers can inspect deleted notes for audit.
 */
async function fetchNoteRow(client: PoolClient, noteId: string): Promise<NoteRow | null> {
  const result = await client.query<NoteRow>(
    `SELECT ${SELECT_COLS}
     FROM notes n
     JOIN users creator ON creator.id = n.created_by
     LEFT JOIN users updater ON updater.id = n.updated_by
     WHERE n.id = $1
     LIMIT 1`,
    [noteId],
  );
  return result.rows[0] ?? null;
}

/**
 * Verifies the parent entity exists. Throws with code ENTITY_NOT_FOUND if missing.
 * Used before write operations so callers receive a 404 rather than a FK violation.
 */
async function assertEntityExists(
  client: PoolClient,
  entityType: NoteEntityType,
  entityId: string,
): Promise<void> {
  const tableMap: Record<NoteEntityType, string> = {
    contact: 'contacts',
    account: 'accounts',
    deal: 'deals',
    lead: 'leads',
  };
  const table = tableMap[entityType];
  const result = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = $1 LIMIT 1`,
    [entityId],
  );
  if (!result.rows[0]) {
    const error = new Error(`${entityType} ${entityId} not found`) as Error & { code: string };
    error.code = 'ENTITY_NOT_FOUND';
    throw error;
  }
}

/**
 * Returns a paginated list of notes for an entity.
 * Visibility rules: team/public are always included; private notes are only
 * included when created_by === callerId (bodies of others' private notes are masked).
 *
 * @param entityType - One of: contact | account | deal | lead
 * @param entityId - UUID of the parent entity
 * @param callerId - UUID of the authenticated user
 * @param page - 1-based page number
 * @param limit - Records per page
 */
export async function listNotes(
  entityType: NoteEntityType,
  entityId: string,
  callerId: string,
  page: number,
  limit: number,
): Promise<PaginatedResponse<NoteResponse>> {
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM notes n
       WHERE n.entity_type = $1
         AND n.entity_id   = $2
         AND n.deleted_at IS NULL`,
      [entityType, entityId],
    ),
    pool.query<NoteRow>(
      `SELECT ${SELECT_COLS}
       FROM notes n
       JOIN  users creator ON creator.id = n.created_by
       LEFT JOIN users updater ON updater.id = n.updated_by
       WHERE n.entity_type = $1
         AND n.entity_id   = $2
         AND n.deleted_at IS NULL
       ORDER BY n.created_at DESC
       LIMIT $3 OFFSET $4`,
      [entityType, entityId, limit, offset],
    ),
  ]);

  return {
    data: dataResult.rows.map((row) => maskNote(row, callerId)),
    total: parseInt(countResult.rows[0]!.count, 10),
    page,
    limit,
  };
}

/**
 * Returns a single note by ID, or null if not found, deleted, or not visible.
 * Private notes from other users are treated as not found (returns null) — use
 * listNotes to obtain masked placeholders for private notes in a list view.
 *
 * @param entityType - Expected entity type (for validation)
 * @param entityId - Expected entity ID (for validation)
 * @param noteId - UUID of the note
 * @param callerId - UUID of the authenticated user
 */
export async function getNoteById(
  entityType: NoteEntityType,
  entityId: string,
  noteId: string,
  callerId: string,
): Promise<NoteResponse | null> {
  const result = await pool.query<NoteRow>(
    `SELECT ${SELECT_COLS}
     FROM notes n
     JOIN  users creator ON creator.id = n.created_by
     LEFT JOIN users updater ON updater.id = n.updated_by
     WHERE n.id          = $1
       AND n.entity_type = $2
       AND n.entity_id   = $3
       AND n.deleted_at IS NULL
     LIMIT 1`,
    [noteId, entityType, entityId],
  );
  const row = result.rows[0];
  if (!row) return null;
  // Private notes from other users are not accessible via the single-note endpoint
  if (row.visibility === 'private' && row.created_by !== callerId) return null;
  return maskNote(row, callerId);
}

/**
 * Creates a new note on the given entity.
 * Validates entity existence, extracts body_text, writes audit entry in same transaction.
 *
 * @param entityType - Parent entity type
 * @param entityId - Parent entity UUID
 * @param params - Note fields from the validated request
 * @param actor - Authenticated user performing the action
 */
export async function createNote(
  entityType: NoteEntityType,
  entityId: string,
  params: CreateNoteInput,
  actor: AuditActor,
): Promise<NoteResponse> {
  const bodyText = extractBodyText(params.body);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await assertEntityExists(client, entityType, entityId);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO notes (entity_type, entity_id, title, body, body_text, visibility, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        entityType,
        entityId,
        params.title ?? null,
        params.body,
        bodyText || null,
        params.visibility ?? 'team',
        actor.id,
      ],
    );

    const noteId = insertResult.rows[0]!.id;

    // Sync tags via note_tags junction
    if (params.tags && params.tags.length > 0) {
      await syncEntityTagsWithinTransaction(client, 'note', noteId, params.tags);
    }

    const note = await fetchNoteRow(client, noteId);
    if (!note) throw new Error('Note insert succeeded but fetch returned nothing');

    const isPrivate = note.visibility === 'private';
    await writeAuditEntry(client, {
      recordType: entityType,
      recordId: entityId,
      eventType: 'note_created',
      fieldName: 'note',
      newValue: isPrivate ? PRIVATE_NOTE_AUDIT_VALUE : auditBodyText(note.body_text),
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    await client.query('COMMIT');
    return maskNote(note, actor.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates a note. Only the creator or an admin may update.
 * Visibility changes are only allowed for the creator — admins cannot override this.
 *
 * @param entityType - Parent entity type (for validation)
 * @param entityId - Parent entity UUID (for validation)
 * @param noteId - UUID of the note to update
 * @param params - Fields to update
 * @param actor - Authenticated user performing the action
 * @param callerRole - 'admin' | 'rep' — gates write permission
 * @returns The updated (possibly masked) note, or null if not found
 */
export async function updateNote(
  entityType: NoteEntityType,
  entityId: string,
  noteId: string,
  params: UpdateNoteInput,
  actor: AuditActor,
  callerRole: string,
): Promise<NoteResponse | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const before = await client.query<NoteRow>(
      `SELECT ${SELECT_COLS}
       FROM notes n
       JOIN  users creator ON creator.id = n.created_by
       LEFT JOIN users updater ON updater.id = n.updated_by
       WHERE n.id          = $1
         AND n.entity_type = $2
         AND n.entity_id   = $3
         AND n.deleted_at IS NULL`,
      [noteId, entityType, entityId],
    );

    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const beforeRow = before.rows[0];
    const isCreator = beforeRow.created_by === actor.id;
    const isAdmin = callerRole === 'admin';

    if (!isCreator && !isAdmin) {
      const error = new Error('Forbidden') as Error & { code: string };
      error.code = 'FORBIDDEN';
      throw error;
    }

    // Visibility changes are creator-only — admins cannot override
    if (
      params.visibility !== undefined &&
      params.visibility !== beforeRow.visibility &&
      !isCreator
    ) {
      const error = new Error('Only the note creator can change visibility') as Error & {
        code: string;
      };
      error.code = 'VISIBILITY_CHANGE_FORBIDDEN';
      throw error;
    }

    const newBodyText =
      params.body !== undefined ? extractBodyText(params.body) : beforeRow.body_text;

    await client.query(
      `UPDATE notes
       SET title      = CASE WHEN $2::text IS NOT NULL THEN $2::varchar(255) ELSE title END,
           body       = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE body END,
           body_text  = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE body_text END,
           visibility = CASE WHEN $5::text IS NOT NULL THEN $5::varchar(8) ELSE visibility END,
           updated_by = $6,
           updated_at = now()
       WHERE id = $1`,
      [
        noteId,
        params.title ?? null,
        params.body ?? null,
        newBodyText || null,
        params.visibility ?? null,
        actor.id,
      ],
    );

    // Sync tags via note_tags junction when tags were explicitly provided
    if (params.tags !== undefined) {
      await syncEntityTagsWithinTransaction(client, 'note', noteId, params.tags);
    }

    const after = await fetchNoteRow(client, noteId);
    if (!after) throw new Error('Note update succeeded but fetch returned nothing');

    const isPrivate = after.visibility === 'private';

    const bodyChanged = params.body !== undefined && params.body !== beforeRow.body;
    const visibilityChanged =
      params.visibility !== undefined && params.visibility !== beforeRow.visibility;

    if (bodyChanged) {
      await writeAuditEntry(client, {
        recordType: entityType,
        recordId: entityId,
        eventType: 'note_updated',
        fieldName: 'note',
        oldValue: isPrivate ? PRIVATE_NOTE_AUDIT_VALUE : auditBodyText(beforeRow.body_text),
        newValue: isPrivate ? PRIVATE_NOTE_AUDIT_VALUE : auditBodyText(after.body_text),
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      });
    }

    if (visibilityChanged) {
      await writeAuditEntry(client, {
        recordType: entityType,
        recordId: entityId,
        eventType: 'note_visibility_changed',
        fieldName: 'note',
        oldValue: beforeRow.visibility,
        newValue: after.visibility,
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      });
    }

    // Write a note_updated entry when only non-body fields (title/tags) changed
    if (!bodyChanged && !visibilityChanged) {
      const titleChanged = params.title !== undefined && params.title !== beforeRow.title;
      const tagsChanged =
        params.tags !== undefined && JSON.stringify(params.tags) !== JSON.stringify(beforeRow.tags);
      if (titleChanged || tagsChanged) {
        await writeAuditEntry(client, {
          recordType: entityType,
          recordId: entityId,
          eventType: 'note_updated',
          fieldName: 'note',
          oldValue: isPrivate ? PRIVATE_NOTE_AUDIT_VALUE : auditBodyText(beforeRow.body_text),
          newValue: isPrivate ? PRIVATE_NOTE_AUDIT_VALUE : auditBodyText(after.body_text),
          changedById: actor.id,
          changedByName: actor.name,
          source: actor.source ?? null,
        });
      }
    }

    await client.query('COMMIT');
    return maskNote(after, actor.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Parameters for cross-entity note search */
export interface SearchNotesParams {
  entity_type?: NoteEntityType;
  entity_id?: string;
  keyword?: string;
  author_id?: string;
  date_from?: string;
  date_to?: string;
  page: number;
  limit: number;
}

/**
 * Searches notes across all entity types (or within one) using keyword, author,
 * and date filters. Visibility rules still apply: private notes from other users
 * have their body/title masked.
 *
 * @param params - Filter and pagination parameters
 * @param callerId - UUID of the authenticated user
 */
export async function searchNotesCrossEntity(
  params: SearchNotesParams,
  callerId: string,
): Promise<PaginatedResponse<NoteResponse>> {
  const { entity_type, entity_id, keyword, author_id, date_from, date_to, page, limit } = params;
  const offset = (page - 1) * limit;

  const conditions: string[] = ['n.deleted_at IS NULL'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (entity_type) {
    conditions.push(`n.entity_type = $${paramIndex++}`);
    values.push(entity_type);
  }
  if (entity_id) {
    conditions.push(`n.entity_id = $${paramIndex++}`);
    values.push(entity_id);
  }
  if (author_id) {
    conditions.push(`n.created_by = $${paramIndex++}`);
    values.push(author_id);
  }
  if (date_from) {
    conditions.push(`n.created_at >= $${paramIndex++}`);
    values.push(date_from);
  }
  if (date_to) {
    // Include the full end day by advancing to the next day exclusive
    conditions.push(`n.created_at < ($${paramIndex++}::date + interval '1 day')`);
    values.push(date_to);
  }
  if (keyword) {
    // Escape LIKE metacharacters so literal % and _ in the keyword don't act as wildcards.
    // The trigram index on body_text still accelerates this ILIKE scan.
    const escapedKeyword = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(`n.body_text ILIKE $${paramIndex++} ESCAPE '\\'`);
    values.push(`%${escapedKeyword}%`);
  }

  const where = conditions.join(' AND ');

  // Pagination placeholders come after all WHERE clause params.
  const limitIdx = paramIndex;
  const offsetIdx = paramIndex + 1;

  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM notes n
       WHERE ${where}`,
      values,
    ),
    pool.query<NoteRow>(
      `SELECT ${SELECT_COLS}
       FROM notes n
       JOIN  users creator ON creator.id = n.created_by
       LEFT JOIN users updater ON updater.id = n.updated_by
       WHERE ${where}
       ORDER BY n.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    data: dataResult.rows.map((row) => maskNote(row, callerId)),
    total: parseInt(countResult.rows[0]!.count, 10),
    page,
    limit,
  };
}

/**
 * Soft-deletes all non-deleted notes for a given entity within an existing transaction.
 * Must be called before hard-deleting the parent entity row so that orphaned notes
 * are never left with deleted_at = NULL pointing at a non-existent parent.
 *
 * @param client - Checked-out pool client already inside a BEGIN/COMMIT block
 * @param entityType - Parent entity type (contact | account | deal | lead)
 * @param entityId - UUID of the parent entity being deleted
 */
export async function softDeleteNotesByEntity(
  client: PoolClient,
  entityType: NoteEntityType,
  entityId: string,
): Promise<void> {
  await client.query(
    `UPDATE notes
     SET deleted_at = now()
     WHERE entity_type = $1
       AND entity_id   = $2
       AND deleted_at IS NULL`,
    [entityType, entityId],
  );
}

/**
 * Soft-deletes a note by setting deleted_at. Only the creator or an admin may delete.
 *
 * @param entityType - Parent entity type (for validation)
 * @param entityId - Parent entity UUID (for validation)
 * @param noteId - UUID of the note
 * @param actor - Authenticated user performing the action
 * @param callerRole - 'admin' | 'rep' — gates delete permission
 * @returns true if deleted, false if not found
 */
export async function deleteNote(
  entityType: NoteEntityType,
  entityId: string,
  noteId: string,
  actor: AuditActor,
  callerRole: string,
): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingResult = await client.query<NoteRow>(
      `SELECT ${SELECT_COLS}
       FROM notes n
       JOIN  users creator ON creator.id = n.created_by
       LEFT JOIN users updater ON updater.id = n.updated_by
       WHERE n.id          = $1
         AND n.entity_type = $2
         AND n.entity_id   = $3
         AND n.deleted_at IS NULL`,
      [noteId, entityType, entityId],
    );

    const note = existingResult.rows[0];
    if (!note) {
      await client.query('ROLLBACK');
      return false;
    }

    const isCreator = note.created_by === actor.id;
    const isAdmin = callerRole === 'admin';

    if (!isCreator && !isAdmin) {
      const error = new Error('Forbidden') as Error & { code: string };
      error.code = 'FORBIDDEN';
      throw error;
    }

    await client.query(`UPDATE notes SET deleted_at = now() WHERE id = $1`, [noteId]);

    const isPrivate = note.visibility === 'private';
    await writeAuditEntry(client, {
      recordType: entityType,
      recordId: entityId,
      eventType: 'note_deleted',
      fieldName: 'note',
      oldValue: isPrivate ? PRIVATE_NOTE_AUDIT_VALUE : auditBodyText(note.body_text),
      changedById: actor.id,
      changedByName: actor.name,
      source: actor.source ?? null,
    });

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
