/**
 * Activity service — business logic for activity CRUD operations.
 * All database access for activities goes through this module.
 */

import pool from '../db.js';
import type {
  CreateActivityInput,
  UpdateActivityInput,
} from '@minicrm/shared/schemas/activitySchema.js';

/** Columns that may be updated via updateActivity — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateActivityInput> = new Set([
  'type',
  'subject',
  'notes',
  'due_date',
  'status',
]);

/** Shape of an activity row returned from the database */
export interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  notes: string | null;
  due_date: string | null;
  status: string;
  contact_id: string | null;
  account_id: string | null;
  deal_id: string | null;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
}

/** Options for filtering the activities list */
interface ListActivitiesOptions {
  /** When provided, only activities for this contact are returned */
  contactId?: string;
  /** When provided, only activities for this account are returned */
  accountId?: string;
  /** When provided, only activities for this deal are returned */
  dealId?: string;
  /** When provided, only activities owned by this user are returned */
  ownerId?: string;
}

/** Columns selected in every activity query */
const SELECT_COLS =
  'id, type, subject, notes, due_date::text, status, contact_id, account_id, deal_id, owner_id, created_at, updated_at';

/**
 * Creates a new activity record.
 *
 * @param params - Activity fields plus the owner's user ID
 * @returns The inserted activity row
 */
export async function createActivity(
  params: CreateActivityInput & { owner_id: string },
): Promise<ActivityRow> {
  const { type, subject, notes, due_date, contact_id, account_id, deal_id, owner_id } = params;

  const result = await pool.query<ActivityRow>(
    `INSERT INTO activities (type, subject, notes, due_date, contact_id, account_id, deal_id, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SELECT_COLS}`,
    [
      type,
      subject,
      notes ?? null,
      due_date ?? null,
      contact_id ?? null,
      account_id ?? null,
      deal_id ?? null,
      owner_id,
    ],
  );

  return result.rows[0];
}

/**
 * Finds an activity by its UUID.
 *
 * @param id - Activity UUID
 * @returns The activity row, or null if not found
 */
export async function findActivityById(id: string): Promise<ActivityRow | null> {
  const result = await pool.query<ActivityRow>(
    `SELECT ${SELECT_COLS} FROM activities WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns activities, optionally filtered by parent record or owner.
 *
 * @param options - Optional filters
 * @returns Array of activity rows ordered by created_at descending (newest first)
 */
export async function listActivities(options: ListActivitiesOptions = {}): Promise<ActivityRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (options.contactId) {
    values.push(options.contactId);
    conditions.push(`contact_id = $${values.length}`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`account_id = $${values.length}`);
  }

  if (options.dealId) {
    values.push(options.dealId);
    conditions.push(`deal_id = $${values.length}`);
  }

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`owner_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<ActivityRow>(
    `SELECT ${SELECT_COLS} FROM activities ${where} ORDER BY created_at DESC`,
    values,
  );

  return result.rows;
}

/**
 * Updates one or more fields on an existing activity.
 *
 * @param id - Activity UUID
 * @param params - Fields to update (at least one required)
 * @returns The updated activity row, or null if not found
 */
export async function updateActivity(
  id: string,
  params: UpdateActivityInput,
): Promise<ActivityRow | null> {
  const fields = (Object.keys(params) as (keyof UpdateActivityInput)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  // Guard against empty field list — would produce invalid SQL
  if (fields.length === 0) {
    return findActivityById(id);
  }

  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');

  const result = await pool.query<ActivityRow>(
    `UPDATE activities
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING ${SELECT_COLS}`,
    [id, ...fields.map((f) => params[f])],
  );

  return result.rows[0] ?? null;
}

/**
 * Deletes an activity by its UUID.
 *
 * @param id - Activity UUID
 * @returns The deleted activity row, or null if not found
 */
export async function deleteActivity(id: string): Promise<ActivityRow | null> {
  const result = await pool.query<ActivityRow>(
    `DELETE FROM activities WHERE id = $1 RETURNING ${SELECT_COLS}`,
    [id],
  );
  return result.rows[0] ?? null;
}
