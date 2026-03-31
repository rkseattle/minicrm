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
  owner_name: string;
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

/** Columns selected when JOINing users for owner_name */
const SELECT_COLS_WITH_OWNER =
  'a.id, a.type, a.subject, a.notes, a.due_date::text AS due_date, a.status, a.contact_id, a.account_id, a.deal_id, a.owner_id, u.name AS owner_name, a.created_at, a.updated_at';

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

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO activities (type, subject, notes, due_date, contact_id, account_id, deal_id, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
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

  return (await findActivityById(insertResult.rows[0].id))!;
}

/**
 * Finds an activity by its UUID.
 *
 * @param id - Activity UUID
 * @returns The activity row, or null if not found
 */
export async function findActivityById(id: string): Promise<ActivityRow | null> {
  const result = await pool.query<ActivityRow>(
    `SELECT ${SELECT_COLS_WITH_OWNER}
     FROM activities a
     JOIN users u ON u.id = a.owner_id
     WHERE a.id = $1
     LIMIT 1`,
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
    conditions.push(`a.contact_id = $${values.length}`);
  }

  if (options.accountId) {
    values.push(options.accountId);
    conditions.push(`a.account_id = $${values.length}`);
  }

  if (options.dealId) {
    values.push(options.dealId);
    conditions.push(`a.deal_id = $${values.length}`);
  }

  if (options.ownerId) {
    values.push(options.ownerId);
    conditions.push(`a.owner_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<ActivityRow>(
    `SELECT ${SELECT_COLS_WITH_OWNER}
     FROM activities a
     JOIN users u ON u.id = a.owner_id
     ${where}
     ORDER BY a.created_at DESC`,
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

  const updateResult = await pool.query<{ id: string }>(
    `UPDATE activities
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [id, ...fields.map((f) => params[f])],
  );

  if (!updateResult.rows[0]) return null;
  return findActivityById(updateResult.rows[0].id);
}

/** Shape of a task row enriched with the linked record name and type */
export interface MyTaskRow extends ActivityRow {
  /** Display name of the linked contact, account, or deal */
  linked_record_name: string | null;
  /** Which type of record this task is linked to */
  linked_record_type: 'contact' | 'account' | 'deal' | null;
}

/**
 * Returns all open and completed Task-type activities owned by the given user,
 * sorted by due_date ascending (nulls last), enriched with the linked record name.
 *
 * @param ownerId - UUID of the authenticated user
 * @returns Array of task rows ordered by due_date ASC NULLS LAST
 */
export async function listMyTasks(ownerId: string): Promise<MyTaskRow[]> {
  const result = await pool.query<MyTaskRow>(
    `SELECT
       a.id,
       a.type,
       a.subject,
       a.notes,
       a.due_date::text,
       a.status,
       a.contact_id,
       a.account_id,
       a.deal_id,
       a.owner_id,
       u.name AS owner_name,
       a.created_at,
       a.updated_at,
       CASE
         WHEN a.contact_id IS NOT NULL THEN (c.first_name || ' ' || c.last_name)
         WHEN a.account_id IS NOT NULL THEN ac.name
         WHEN a.deal_id   IS NOT NULL THEN d.name
       END AS linked_record_name,
       CASE
         WHEN a.contact_id IS NOT NULL THEN 'contact'
         WHEN a.account_id IS NOT NULL THEN 'account'
         WHEN a.deal_id   IS NOT NULL THEN 'deal'
       END AS linked_record_type
     FROM activities a
     JOIN users u          ON u.id  = a.owner_id
     LEFT JOIN contacts c  ON c.id  = a.contact_id
     LEFT JOIN accounts ac ON ac.id = a.account_id
     LEFT JOIN deals d     ON d.id  = a.deal_id
     WHERE a.owner_id = $1
       AND a.type = 'Task'
     ORDER BY a.due_date ASC NULLS LAST, a.created_at ASC`,
    [ownerId],
  );

  return result.rows;
}

/**
 * Deletes an activity by its UUID.
 *
 * @param id - Activity UUID
 * @returns The deleted activity row, or null if not found
 */
export async function deleteActivity(id: string): Promise<ActivityRow | null> {
  const existing = await findActivityById(id);
  if (!existing) return null;

  await pool.query(`DELETE FROM activities WHERE id = $1`, [id]);
  return existing;
}
