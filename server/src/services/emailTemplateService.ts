/**
 * Email template service — CRUD for reusable email templates.
 * All database access for email_templates goes through this module.
 * (MINCRM-422, MINCRM-437)
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';

/** A single merge tag descriptor stored in the merge_tags jsonb array. */
export interface MergeTag {
  key: string;
  label: string;
}

/** Shape of an email_templates row as stored in the database. */
export interface EmailTemplateRow {
  id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  merge_tags: MergeTag[];
  enabled: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Input for creating a new email template. */
export interface CreateEmailTemplateInput {
  name: string;
  category: string;
  subject: string;
  body: string;
  merge_tags?: MergeTag[];
  enabled?: boolean;
}

/** Input for updating an email template — all fields optional. */
export interface UpdateEmailTemplateInput {
  name?: string;
  category?: string;
  subject?: string;
  body?: string;
  merge_tags?: MergeTag[];
  enabled?: boolean;
}

/** Options for listEmailTemplates. */
export interface ListEmailTemplatesOptions {
  category?: string;
  enabled_only?: boolean;
  page?: number;
  limit?: number;
}

const COLUMN_SELECT =
  'id, name, category, subject, body, merge_tags, enabled, created_by, created_at, updated_at';

/**
 * Returns a paginated list of email templates.
 * Optionally filtered by category and/or enabled state.
 */
export async function listEmailTemplates(
  options: ListEmailTemplatesOptions = {},
): Promise<PaginatedResponse<EmailTemplateRow>> {
  const { category, enabled_only = false, page = 1, limit = 20 } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (category !== undefined) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(category);
  }
  if (enabled_only) {
    conditions.push(`enabled = TRUE`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [dataResult, countResult] = await Promise.all([
    pool.query<EmailTemplateRow>(
      `SELECT ${COLUMN_SELECT}
       FROM email_templates
       ${where}
       ORDER BY name ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM email_templates ${where}`,
      params,
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    data: dataResult.rows,
    total,
    page,
    limit,
  };
}

/**
 * Returns a single email template by UUID, or null if not found.
 */
export async function findEmailTemplateById(id: string): Promise<EmailTemplateRow | null> {
  const result = await pool.query<EmailTemplateRow>(
    `SELECT ${COLUMN_SELECT} FROM email_templates WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates a new email template.
 * Throws with code EMAIL_TEMPLATE_NAME_CONFLICT on duplicate name (PG 23505).
 */
export async function createEmailTemplate(
  input: CreateEmailTemplateInput,
  actor: AuditActor,
): Promise<EmailTemplateRow> {
  const { name, category, subject, body, merge_tags = [], enabled = true } = input;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<EmailTemplateRow>(
      `INSERT INTO email_templates (name, category, subject, body, merge_tags, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMN_SELECT}`,
      [name, category, subject, body, JSON.stringify(merge_tags), enabled, actor.id],
    );

    const row = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'email_templates',
      recordId: row.id,
      recordName: row.name,
      eventType: 'created',
      fieldName: null,
      oldValue: null,
      newValue: row.name,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return row;
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('An email template with this name already exists'), {
        code: 'EMAIL_TEMPLATE_NAME_CONFLICT',
        statusCode: 409,
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates an existing email template. Returns the updated row, or null if not found.
 * Throws with code EMAIL_TEMPLATE_NAME_CONFLICT on duplicate name (PG 23505).
 */
export async function updateEmailTemplate(
  id: string,
  input: UpdateEmailTemplateInput,
  actor: AuditActor,
): Promise<EmailTemplateRow | null> {
  const allowedFields = ['name', 'category', 'subject', 'body', 'merge_tags', 'enabled'] as const;
  type AllowedField = (typeof allowedFields)[number];

  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const field of allowedFields) {
    if (field in input && input[field as AllowedField] !== undefined) {
      if (field === 'merge_tags') {
        setClauses.push(`${field} = $${paramIdx++}`);
        params.push(JSON.stringify(input.merge_tags));
      } else {
        setClauses.push(`${field} = $${paramIdx++}`);
        params.push(input[field as AllowedField]);
      }
    }
  }

  if (setClauses.length === 0) {
    return findEmailTemplateById(id);
  }

  setClauses.push(`updated_at = now()`);
  params.push(id);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query<EmailTemplateRow>(
      `SELECT ${COLUMN_SELECT} FROM email_templates WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const result = await client.query<EmailTemplateRow>(
      `UPDATE email_templates
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIdx}
       RETURNING ${COLUMN_SELECT}`,
      params,
    );

    const after = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'email_templates',
      recordId: id,
      recordName: after.name,
      eventType: 'updated',
      fieldName: Object.keys(input).join(','),
      oldValue: JSON.stringify(before.rows[0]),
      newValue: JSON.stringify(after),
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return after;
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('An email template with this name already exists'), {
        code: 'EMAIL_TEMPLATE_NAME_CONFLICT',
        statusCode: 409,
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes an email template by UUID. Returns true if deleted, false if not found.
 */
export async function deleteEmailTemplate(id: string, actor: AuditActor): Promise<boolean> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const row = await client.query<{ id: string; name: string }>(
      `DELETE FROM email_templates WHERE id = $1 RETURNING id, name`,
      [id],
    );

    if (row.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await writeAuditEntry(client, {
      recordType: 'email_templates',
      recordId: id,
      recordName: row.rows[0].name,
      eventType: 'deleted',
      fieldName: null,
      oldValue: row.rows[0].name,
      newValue: null,
      changedById: actor.id,
      changedByName: actor.name,
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
