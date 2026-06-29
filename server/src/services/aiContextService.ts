/**
 * AI context service — CRUD for per-user key/value context entries stored in
 * user_ai_context and injected into every Claude system prompt.
 *
 * All writes are transactional with audit entries. Ownership is enforced at the
 * SQL level (WHERE id = $1 AND user_id = $2) so cross-user access is impossible
 * regardless of controller input.
 * (MINCRM-427)
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import { writeAuditEntry, writeAuditEntries, diffFields } from './auditService.js';
import type { AuditActor } from './auditService.js';
import type { AiContextEntryResponse } from '@minicrm/shared/schemas/aiContextSchema.js';

/** Maximum number of context entries allowed per user. */
const MAX_CONTEXT_ENTRIES = 50;

// ── Row type ───────────────────────────────────────────────────────────────────

interface AiContextRow {
  id: string;
  user_id: string;
  key: string;
  value: string;
  created_at: Date;
  updated_at: Date;
}

// ── Serialiser ─────────────────────────────────────────────────────────────────

function serialise(row: AiContextRow): AiContextEntryResponse {
  return {
    id: row.id,
    user_id: row.user_id,
    key: row.key,
    value: row.value,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ── Public service functions ───────────────────────────────────────────────────

/**
 * Returns all context entries for a user, ordered by creation time ascending
 * so the panel renders them in the order the user added them.
 */
export async function listContextEntries(userId: string): Promise<AiContextEntryResponse[]> {
  const result = await pool.query<AiContextRow>(
    `SELECT id, user_id, key, value, created_at, updated_at
     FROM user_ai_context
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows.map(serialise);
}

/**
 * Creates a new context entry for the user.
 * Enforces the 50-entry cap (409 when exceeded).
 * Audit-logged within the same transaction.
 */
export async function createContextEntry(
  userId: string,
  key: string,
  value: string,
  actor: AuditActor,
): Promise<AiContextEntryResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM user_ai_context WHERE user_id = $1`,
      [userId],
    );
    if (parseInt(countResult.rows[0].count, 10) >= MAX_CONTEXT_ENTRIES) {
      throw Object.assign(
        new Error(`Context entry limit reached (maximum ${MAX_CONTEXT_ENTRIES} entries)`),
        { statusCode: 409, code: 'CONTEXT_ENTRY_LIMIT_REACHED' },
      );
    }

    const result = await client.query<AiContextRow>(
      `INSERT INTO user_ai_context (user_id, key, value)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, key, value, created_at, updated_at`,
      [userId, key, value],
    );
    const entry = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'user_ai_context',
      recordId: entry.id,
      recordName: key,
      eventType: 'created',
      fieldName: null,
      oldValue: null,
      newValue: `${key}: ${value}`,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return serialise(entry);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates an existing context entry's key, value, or both.
 * Ownership enforced in the WHERE clause — throws 404 when the entry does not
 * exist or belongs to a different user.
 */
export async function updateContextEntry(
  id: string,
  userId: string,
  patch: { key?: string; value?: string },
  actor: AuditActor,
): Promise<AiContextEntryResponse> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeResult = await client.query<AiContextRow>(
      `SELECT id, user_id, key, value, created_at, updated_at
       FROM user_ai_context
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [id, userId],
    );
    if (beforeResult.rows.length === 0) {
      throw Object.assign(new Error('Context entry not found'), { statusCode: 404 });
    }
    const before = beforeResult.rows[0];

    const newKey = patch.key ?? before.key;
    const newValue = patch.value ?? before.value;

    const afterResult = await client.query<AiContextRow>(
      `UPDATE user_ai_context
       SET key = $1, value = $2
       WHERE id = $3 AND user_id = $4
       RETURNING id, user_id, key, value, created_at, updated_at`,
      [newKey, newValue, id, userId],
    );
    const after = afterResult.rows[0];

    const auditBase = {
      recordType: 'user_ai_context' as const,
      recordId: id,
      recordName: after.key,
      changedById: actor.id,
      changedByName: actor.name,
    };
    const entries = diffFields(
      { key: before.key, value: before.value },
      { key: after.key, value: after.value },
      auditBase,
    );
    if (entries.length > 0) {
      await writeAuditEntries(client, entries);
    }

    await client.query('COMMIT');
    return serialise(after);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a context entry.
 * Ownership enforced in the WHERE clause — throws 404 when the entry does not
 * exist or belongs to a different user.
 */
export async function deleteContextEntry(
  id: string,
  userId: string,
  actor: AuditActor,
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const checkResult = await client.query<{ id: string; key: string }>(
      `SELECT id, key FROM user_ai_context WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (checkResult.rows.length === 0) {
      throw Object.assign(new Error('Context entry not found'), { statusCode: 404 });
    }
    const { key } = checkResult.rows[0];

    await client.query(`DELETE FROM user_ai_context WHERE id = $1`, [id]);

    await writeAuditEntry(client, {
      recordType: 'user_ai_context',
      recordId: id,
      recordName: key,
      eventType: 'deleted',
      fieldName: null,
      oldValue: key,
      newValue: null,
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
}
