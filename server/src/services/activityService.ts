/**
 * Activity service — business logic for activity CRUD operations.
 * All database access for activities goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateActivityInput,
  UpdateActivityInput,
} from '@minicrm/shared/schemas/activitySchema.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import { dispatchWebhookEvent } from './webhookService.js';
import {
  writeAuditEntry,
  writeAuditEntryBestEffort,
  writeAuditEntries,
  diffFields,
  SYSTEM_ACTOR,
} from './auditService.js';
import type { AuditActor } from './auditService.js';
import { setRlsUserId, withRlsQuery } from './rlsContextService.js';
import { buildVisibilityFilter } from './visibilityService.js';
import { analyzeContactSignals, clearSignalQuotesForActivities } from './championBlockerService.js';
import { scoreActivitySentiment } from './sentimentService.js';

/** Columns that may be updated via updateActivity — guards against SQL injection from dynamic field names */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateActivityInput> = new Set([
  'type',
  'subject',
  'notes',
  'due_date',
  'status',
  'direction',
  'outcome',
]);

/** Shape of an activity row returned from the database */
export interface ActivityRow {
  id: string;
  type: string;
  subject: string;
  notes: string | null;
  due_date: string | null;
  status: string;
  direction: string | null;
  outcome: string | null;
  contact_id: string | null;
  account_id: string | null;
  deal_id: string | null;
  owner_id: string;
  owner_name: string;
  created_at: Date;
  updated_at: Date;
  /** Optimistic lock version */
  version: number;
}

/** Options for filtering and paginating the activities list */
interface ListActivitiesOptions {
  /** When provided, only activities for this contact are returned */
  contactId?: string;
  /** When provided, only activities for this account are returned */
  accountId?: string;
  /** When provided, only activities for this deal are returned */
  dealId?: string;
  /** When provided, only activities owned by this user are returned */
  ownerId?: string;
  /** When provided, only activities of this type are returned (e.g. 'Call', 'Task') */
  type?: string;
  /** When provided, only activities updated on or after this date (YYYY-MM-DD) are returned */
  start?: string;
  /** When provided, only activities updated on or before this date (YYYY-MM-DD) are returned */
  end?: string;
  /** 1-based page number; defaults to 1 */
  page?: number;
  /** Records per page; defaults to 50 */
  limit?: number;
  /** When provided, the org visibility policy is enforced for this user */
  requestingUser?: { id: string; role: string };
}

/** Columns selected when JOINing users for owner_name */
const SELECT_COLS_WITH_OWNER =
  'a.id, a.type, a.subject, a.notes, a.due_date::text AS due_date, a.status, a.direction, a.outcome, a.contact_id, a.account_id, a.deal_id, a.owner_id, u.name AS owner_name, a.created_at, a.updated_at, a.version';

/**
 * Inserts an activity and its audit entry on the caller's client, in the caller's transaction.
 *
 * For a write that must commit with something else; the caller sets the RLS context and
 * calls `announceActivityCreated` after its COMMIT.
 *
 * @param filedFrom - For an Email activity filed from a message: the message, which marking
 *   its conversation private later finds it by, and the people it names, whose erasure
 *   reaches it even once the mailbox is gone.
 * @returns The new activity's id.
 */
export async function insertActivity(
  client: PoolClient,
  params: CreateActivityInput & { owner_id: string },
  actor: AuditActor,
  filedFrom?: FiledEmail,
): Promise<string> {
  const {
    type,
    subject,
    notes,
    due_date,
    direction,
    outcome,
    contact_id,
    account_id,
    deal_id,
    owner_id,
  } = params;

  const insertResult = await client.query<{ id: string }>(
    `INSERT INTO activities (type, subject, notes, due_date, direction, outcome, contact_id, account_id, deal_id, owner_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CASE WHEN $11::text IS NULL THEN NULL ELSE jsonb_build_object('email_message_id', $11::text) END)
     RETURNING id`,
    [
      type,
      subject,
      notes ?? null,
      due_date ?? null,
      direction ?? null,
      outcome ?? null,
      contact_id ?? null,
      account_id ?? null,
      deal_id ?? null,
      owner_id,
      filedFrom?.emailMessageId ?? null,
    ],
  );
  const activityId = insertResult.rows[0].id;
  if (filedFrom && filedFrom.participants.length > 0) {
    await client.query(
      `INSERT INTO activity_participants (activity_id, record_type, record_id)
       SELECT $1, p.record_type, p.record_id
         FROM unnest($2::text[], $3::uuid[]) AS p(record_type, record_id)
       ON CONFLICT DO NOTHING`,
      [
        activityId,
        filedFrom.participants.map((x) => x.recordType),
        filedFrom.participants.map((x) => x.recordId),
      ],
    );
  }

  await writeAuditEntry(client, {
    recordType: 'activity',
    recordId: activityId,
    recordName: subject,
    eventType: 'created',
    changedById: actor.id,
    changedByName: actor.name,
    source: actor.source ?? null,
  });

  return activityId;
}

/**
 * The side effects of a committed activity: webhook and signal analysis.
 * Each is fire-and-forget, so a caller is never failed by them.
 *
 * @returns The activity as stored.
 */
export async function announceActivityCreated(activityId: string): Promise<ActivityRow> {
  // Safe: called only after the transaction that inserted this id committed.
  const activity = (await findActivityById(activityId))!;

  void dispatchWebhookEvent('activity.created', activity as unknown as Record<string, unknown>);

  // Fire-and-forget: analyzeContactSignals swallows all internal errors and logs them.
  // Unhandled rejections are caught by the global handler in server.ts.
  void analyzeContactSignals({
    activityId: activity.id,
    contactId: activity.contact_id,
    notes: activity.notes,
    subject: activity.subject,
  });

  // Fire-and-forget: scoreActivitySentiment swallows all internal errors and logs them.
  void scoreActivitySentiment({
    activityId: activity.id,
    notes: activity.notes,
    subject: activity.subject,
  });

  return activity;
}

/**
 * Creates a new activity record.
 *
 * @param params - Activity fields plus the owner's user ID
 * @param actor - User performing the action (for audit log)
 * @returns The inserted activity row
 */
export async function createActivity(
  params: CreateActivityInput & { owner_id: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ActivityRow> {
  const client = await pool.connect();
  let activityId: string;
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);
    activityId = await insertActivity(client, params, actor);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return announceActivityCreated(activityId);
}

/**
 * Finds an activity by its UUID.
 *
 * @param id - Activity UUID
 * @returns The activity row, or null if not found
 */
export async function findActivityById(id: string): Promise<ActivityRow | null> {
  const result = await withRlsQuery((client) =>
    client.query<ActivityRow>(
      `SELECT ${SELECT_COLS_WITH_OWNER}
     FROM activities a
     JOIN users u ON u.id = a.owner_id
     WHERE a.id = $1
     LIMIT 1`,
      [id],
    ),
  );
  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of activities, optionally filtered by parent record or owner.
 * Activities are always ordered by created_at descending (newest first).
 *
 * @param options - Filters and pagination options
 * @returns Paginated response with activity rows and total count
 */
export async function listActivities(
  options: ListActivitiesOptions = {},
): Promise<PaginatedResponse<ActivityRow>> {
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

  if (options.type) {
    values.push(options.type);
    conditions.push(`a.type = $${values.length}`);
  }

  if (options.start) {
    values.push(options.start);
    conditions.push(`a.updated_at::date >= $${values.length}::date`);
  }

  if (options.end) {
    values.push(options.end);
    conditions.push(`a.updated_at::date <= $${values.length}::date`);
  }

  // Org visibility policy enforcement
  if (options.requestingUser) {
    const visFilter = await buildVisibilityFilter(
      'activity',
      options.requestingUser.id,
      options.requestingUser.role,
      'a.owner_id',
      values.length + 1,
    );
    if (visFilter.clause) {
      visFilter.params.forEach((p) => values.push(p));
      conditions.push(visFilter.clause);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    withRlsQuery((client) =>
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM activities a ${where}`,
        values,
      ),
    ),
    withRlsQuery((client) =>
      client.query<ActivityRow>(
        `SELECT ${SELECT_COLS_WITH_OWNER}
       FROM activities a
       JOIN users u ON u.id = a.owner_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
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
 * Updates one or more fields on an existing activity.
 *
 * @param id - Activity UUID
 * @param params - Fields to update (at least one required)
 * @param actor - User performing the action (for audit log)
 * @returns The updated activity row, or null if not found
 */
export async function updateActivity(
  id: string,
  params: UpdateActivityInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ActivityRow | null> {
  const { version, ...rest } = params;
  const fields = (Object.keys(rest) as (keyof typeof rest)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field as keyof UpdateActivityInput),
  );

  // Guard against empty field list — would produce invalid SQL
  if (fields.length === 0) {
    return findActivityById(id);
  }

  // $1=id, $2...$N=field values, $(N+1)=version
  const setClauses = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  const versionParam = fields.length + 2;

  const before = await findActivityById(id);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRlsUserId(client);

    const updateResult = await client.query<{ id: string }>(
      `UPDATE activities
       SET ${setClauses}, updated_at = now(), version = version + 1
       WHERE id = $1 AND version = $${versionParam}
       RETURNING id`,
      [id, ...fields.map((f) => rest[f as keyof typeof rest]), version],
    );

    if (updateResult.rowCount === 0) {
      // Distinguish NOT_FOUND from version mismatch
      const check = await client.query<{ id: string }>('SELECT id FROM activities WHERE id = $1', [
        id,
      ]);
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      throw Object.assign(
        new Error(
          'This record was modified by another user while you were editing it. Please reload to see the latest version.',
        ),
        {
          code: 'OPTIMISTIC_LOCK_CONFLICT',
          entity: 'activity',
          recordId: id,
        },
      );
    }

    if (before) {
      const after = Object.fromEntries(fields.map((f) => [f, rest[f as keyof typeof rest]]));
      const auditEntries = diffFields(before as unknown as Record<string, unknown>, after, {
        recordType: 'activity',
        recordId: id,
        recordName: before.subject,
        changedById: actor.id,
        changedByName: actor.name,
        source: actor.source ?? null,
      });
      if (auditEntries.length > 0) {
        await writeAuditEntries(client, auditEntries);
      }
    }

    await client.query('COMMIT');

    const activity = await findActivityById(updateResult.rows[0]!.id);

    if (activity && params.status === 'complete') {
      void dispatchWebhookEvent(
        'activity.completed',
        activity as unknown as Record<string, unknown>,
      );
    }

    // Re-score only when the note text actually changed — avoids re-scoring on every
    // unrelated field edit (e.g. status/due_date changes).
    if (activity && fields.includes('notes') && before && before.notes !== activity.notes) {
      void scoreActivitySentiment({
        activityId: activity.id,
        notes: activity.notes,
        subject: activity.subject,
      });
    }

    return activity;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Shape of a task row enriched with the linked record name and type */
export interface MyTaskRow extends ActivityRow {
  /** Display name of the linked contact, account, or deal */
  linked_record_name: string | null;
  /** Which type of record this task is linked to */
  linked_record_type: 'contact' | 'account' | 'deal' | null;
}

/**
 * Returns a paginated list of Task-type activities owned by the given user,
 * sorted by due_date ascending (nulls last), enriched with the linked record name.
 *
 * @param ownerId - UUID of the authenticated user
 * @param page - 1-based page number
 * @param limit - Records per page
 * @returns Paginated task rows and total count
 */
export async function listMyTasks(
  ownerId: string,
  page: number,
  limit: number,
): Promise<{ tasks: MyTaskRow[]; total: number }> {
  const offset = (page - 1) * limit;

  const DATA_SQL = `SELECT
       a.id,
       a.type,
       a.subject,
       a.notes,
       a.due_date::text,
       a.status,
       a.direction,
       a.outcome,
       a.contact_id,
       a.account_id,
       a.deal_id,
       a.owner_id,
       u.name AS owner_name,
       a.created_at,
       a.updated_at,
       a.version,
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
     ORDER BY a.due_date ASC NULLS LAST, a.created_at ASC
     LIMIT $2 OFFSET $3`;

  const COUNT_SQL = `SELECT COUNT(*) AS count
     FROM activities
     WHERE owner_id = $1
       AND type = 'Task'`;

  const [dataResult, countResult] = await Promise.all([
    withRlsQuery((client) => client.query<MyTaskRow>(DATA_SQL, [ownerId, limit, offset])),
    withRlsQuery((client) => client.query<{ count: string }>(COUNT_SQL, [ownerId])),
  ]);

  return {
    tasks: dataResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

/** A person an Email activity's message names; activity_participants.record_type. */
export interface ActivityParticipant {
  recordType: 'contact' | 'lead';
  recordId: string;
}

/** The message an Email activity was filed from, and who it names. */
export interface FiledEmail {
  emailMessageId: string;
  participants: readonly ActivityParticipant[];
}

/** Ids of the activities filed from any of the given messages. */
async function activityIdsFiledFromMessages(
  queryable: Pick<PoolClient, 'query'>,
  messageIds: readonly string[],
): Promise<string[]> {
  if (messageIds.length === 0) return [];
  const result = await queryable.query<{ id: string }>(
    `SELECT id FROM activities
      WHERE (metadata->>'email_message_id') IS NOT NULL
        AND (metadata->>'email_message_id') = ANY($1::text[])`,
    [messageIds],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Ids of the activities that carry a person's mail text: those that named them when filed,
 * and those filed from any of the given messages, whatever their links were then.
 */
export async function activityIdsForPerson(
  queryable: Pick<PoolClient, 'query'>,
  person: ActivityParticipant,
  messageIds: readonly string[],
): Promise<string[]> {
  const associated = await queryable.query<{ id: string }>(
    'SELECT activity_id AS id FROM activity_participants WHERE record_type = $1 AND record_id = $2',
    [person.recordType, person.recordId],
  );
  const filed = await activityIdsFiledFromMessages(queryable, messageIds);
  return [...new Set([...associated.rows.map((row) => row.id), ...filed])];
}

/** Forgets that activities named these records, which are being deleted or GDPR-erased. */
export async function removeActivityParticipants(
  client: PoolClient,
  recordType: ActivityParticipant['recordType'],
  recordIds: readonly string[],
): Promise<void> {
  if (recordIds.length === 0) return;
  await client.query(
    'DELETE FROM activity_participants WHERE record_type = $1 AND record_id = ANY($2::uuid[])',
    [recordType, recordIds],
  );
}

/**
 * Moves activity associations from a record that is going away to the contact it becomes;
 * the activity may already name that contact.
 */
export async function moveActivityParticipants(
  client: PoolClient,
  from: ActivityParticipant,
  toContactId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO activity_participants (activity_id, record_type, record_id)
     SELECT activity_id, 'contact', $3 FROM activity_participants
      WHERE record_type = $1 AND record_id = $2
     ON CONFLICT DO NOTHING`,
    [from.recordType, from.recordId, toContactId],
  );
  await removeActivityParticipants(client, from.recordType, [from.recordId]);
}

/** Why an activity's text was removed; matches redacted_records.reason. */
export type ActivityRedactionReason = 'gdpr_erasure' | 'private_thread';

/**
 * Removes the subject and text of the given activities, in the caller's transaction, and
 * records each in redacted_records so audit reads mask it, even after it is deleted. The
 * version bump fails an edit form opened before, which would otherwise write the text back.
 * Champion/blocker quotes on their contacts go too. Decided by content, not by an earlier
 * redaction: text written since is scrubbed again, and an activity already clean is untouched.
 *
 * @param cutoffIds - Activities whose masking cutoff moves to now; defaults to those scrubbed.
 * @returns The ids actually scrubbed.
 */
export async function scrubActivities(
  client: PoolClient,
  activityIds: readonly string[],
  subject: string,
  reason: ActivityRedactionReason,
  cutoffIds?: readonly string[],
): Promise<string[]> {
  if (activityIds.length === 0) return [];
  const scrubbed = await client.query<{ id: string }>(
    `UPDATE activities a
        SET subject = $2, notes = NULL, version = a.version + 1, updated_at = now()
      WHERE a.id = ANY($1::uuid[])
        AND (a.subject IS DISTINCT FROM $2 OR a.notes IS NOT NULL)
      RETURNING a.id`,
    [activityIds, subject],
  );
  const ids = scrubbed.rows.map((row) => row.id);
  await recordScrub(client, activityIds, ids, reason, cutoffIds);
  return ids;
}

/**
 * Scrubs, as scrubActivities does, every activity filed from these messages of the current
 * app user's own mailboxes, whoever owns it now. The cross-owner write goes through
 * scrub_activities_filed_from_own_mail, which changes nothing but the subject and text.
 *
 * @param moveAllCutoffs - Move every filed activity's masking cutoff, not just those scrubbed.
 * @returns The ids actually scrubbed.
 */
export async function scrubActivitiesFiledFromOwnMail(
  client: PoolClient,
  messageIds: readonly string[],
  subject: string,
  reason: ActivityRedactionReason,
  moveAllCutoffs: boolean,
): Promise<string[]> {
  if (messageIds.length === 0) return [];
  const result = await client.query<{ activity_id: string; scrubbed: boolean }>(
    'SELECT activity_id, scrubbed FROM scrub_activities_filed_from_own_mail($1::uuid[], $2)',
    [messageIds, subject],
  );
  const filedIds = result.rows.map((row) => row.activity_id);
  const ids = result.rows.filter((row) => row.scrubbed).map((row) => row.activity_id);
  await recordScrub(client, filedIds, ids, reason, moveAllCutoffs ? filedIds : undefined);
  return ids;
}

/** What follows a scrub: the redaction record, and the champion/blocker quotes it carried. */
async function recordScrub(
  client: PoolClient,
  activityIds: readonly string[],
  scrubbedIds: readonly string[],
  reason: ActivityRedactionReason,
  cutoffIds: readonly string[] | undefined,
): Promise<void> {
  await markActivitiesRedacted(client, activityIds, reason, cutoffIds ?? scrubbedIds);
  await clearSignalQuotesForActivities(client, scrubbedIds);
}

/**
 * Records activities whose text was removed or never filed, so audit reads mask them. An
 * erasure supersedes a private-thread scrub, masking the record's whole history; a scrub
 * that changed an activity moves redacted_at, so text written back meanwhile is masked too.
 *
 * @param changedIds - The activities this call actually changed; defaults to all of them.
 */
export async function markActivitiesRedacted(
  client: PoolClient,
  activityIds: readonly string[],
  reason: ActivityRedactionReason,
  changedIds: readonly string[] = activityIds,
): Promise<void> {
  if (activityIds.length === 0) return;
  await client.query(
    `INSERT INTO redacted_records (record_type, record_id, reason)
     SELECT 'activity', id, $2 FROM unnest($1::uuid[]) AS id
     ON CONFLICT (record_type, record_id) DO UPDATE
       SET reason = CASE WHEN redacted_records.reason = 'gdpr_erasure'
                         THEN 'gdpr_erasure' ELSE EXCLUDED.reason END,
           redacted_at = CASE
             WHEN redacted_records.record_id = ANY($3::uuid[])
               OR (EXCLUDED.reason = 'gdpr_erasure' AND redacted_records.reason <> 'gdpr_erasure')
             THEN now() ELSE redacted_records.redacted_at END`,
    [activityIds, reason, changedIds],
  );
}

/**
 * Deletes an activity by its UUID.
 *
 * @param id - Activity UUID
 * @param actor - User performing the action (for audit log)
 * @returns The deleted activity row, or null if not found
 */
export async function deleteActivity(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<ActivityRow | null> {
  const existing = await findActivityById(id);
  if (!existing) return null;

  const deleteResult = await withRlsQuery((client) =>
    client.query<{ id: string }>(`DELETE FROM activities WHERE id = $1 RETURNING id`, [id]),
  );
  if (!deleteResult.rows[0]) return null; // deleted by a concurrent request

  void writeAuditEntryBestEffort({
    recordType: 'activity',
    recordId: existing.id,
    recordName: existing.subject,
    eventType: 'deleted',
    changedById: actor.id,
    changedByName: actor.name,
    source: actor.source ?? null,
  });

  return existing;
}
