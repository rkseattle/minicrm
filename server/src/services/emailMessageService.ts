/**
 * Reads synced messages: lists through the records they are linked to, and one message with
 * its bodies by id.
 *
 * Two rules govern every query here, and both are in the WHERE clause rather than in a
 * caller:
 *
 * 1. A message is readable only through the mailbox that synced it. Every rep holds
 *    `connected_accounts:manage`, so scoping by `is_private` alone would let one rep read
 *    another's mail with a shared contact — including bodies.
 *
 *    `is_private` restricts a message to that same owner. Every read path builds its
 *    WHERE from `messageAccessPredicate`, which names both terms, so a future
 *    cross-mailbox read widens the owner term in plain sight and keeps the privacy one.
 * 2. Whether the caller may see the linked RECORD is the controller's question, because it
 *    differs by type: contact, account and deal have visibility policies, leads do not.
 *
 * Results page by thread rather than by message. A thread is the unit a reader thinks in,
 * and paging by message would either split one across a page boundary or make `total`
 * disagree with what `limit` bounds.
 */

import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import type {
  EmailLinkRecordType,
  EmailMessageDetail,
  EmailThread,
} from '@minicrm/shared/schemas/emailMessageSchema.js';

import type { PoolClient } from 'pg';

import pool from '../db.js';
import { markSendEntriesPrivate, writeAuditEntries, writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import { clearDerivedLinkSuppression, suppressDerivedLink } from './emailMatchingService.js';
import { buildVisibilityFilter } from './visibilityService.js';
import { scrubActivitiesFiledFromOwnMail } from './activityService.js';
import { lockForIngest } from './mail/gdprRedaction.js';
import { setRlsUserIdTo } from './rlsContextService.js';
import { findThreadSendIntentIds, setUnsettledSendsPrivacy } from './emailSendIntentService.js';
import {
  MESSAGE_SELECT,
  PRIVATE_EMAIL_SUBJECT,
  toEmailMessage,
  type EmailMessageRow,
} from './emailMessageRecord.js';

/** A link row as the write endpoints return it. */
export interface EmailMessageLinkRow {
  id: string;
  email_message_id: string;
  record_type: EmailLinkRecordType;
  record_id: string;
  match_type: 'auto' | 'manual';
  created_at: Date;
}

/**
 * Groups an ordered message list into threads, preserving the order it arrived in.
 *
 * The query already sorts by thread then by message, so this walks once rather than
 * sorting again — and the thread order the query chose is the one the caller sees.
 */
function groupIntoThreads(rows: readonly EmailMessageRow[]): EmailThread[] {
  const threads: EmailThread[] = [];
  let current: EmailThread | undefined;

  for (const row of rows) {
    if (
      !current ||
      current.thread_id !== row.thread_id ||
      current.connected_account_id !== row.connected_account_id
    ) {
      current = {
        thread_id: row.thread_id,
        connected_account_id: row.connected_account_id,
        messages: [],
      };
      threads.push(current);
    }
    current.messages.push(toEmailMessage(row));
  }

  return threads;
}

/**
 * Runs one page of threads over whatever source the caller describes.
 *
 * Both endpoints select the same shape — a page of threads, ordered by newest activity —
 * and differ only in which messages they draw from. Keeping the paging in one place is
 * what stops the two from disagreeing about a tiebreak or a NULLS rule.
 *
 * `sent_at` is nullable, so every ordering carries a full tiebreak: without one, two rows
 * sharing a timestamp could swap places between the count and the page query and drop or
 * duplicate a thread across a page boundary.
 *
 * A thread is selected when any of its messages qualifies, but only the qualifying
 * messages are returned — a thread half-filed against a record shows the half that is,
 * and the unmatched list drops a message the moment something claims it.
 *
 * @param source - A FROM/WHERE fragment selecting `m`, the messages in scope. Written by
 *   this module, never by a caller: it is interpolated, not bound.
 * @param messageFilter - The same restriction as a bare predicate over `m` and `ca`,
 *   privacy term included, re-applied when the page's messages are joined back.
 * @param params - Bind values both fragments refer to. The page's LIMIT and OFFSET follow
 *   them, so the fragments may use $1..$n and nothing higher.
 */
async function listThreadPage(
  source: string,
  messageFilter: string,
  params: readonly unknown[],
  page: number,
  limit: number,
): Promise<PaginatedResponse<EmailThread>> {
  const offset = (page - 1) * limit;
  const limitParam = `$${params.length + 1}`;
  const offsetParam = `$${params.length + 2}`;

  // Two statements, no snapshot between them: a sync tick landing in the gap can leave
  // `total` a message ahead of the page. Accepted for a list view — a transaction per
  // page would serialize reads against every commitPage for a count nobody acts on.
  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT DISTINCT m.connected_account_id, m.thread_id ${source}
       ) threads`,
      [...params],
    ),
    pool.query<EmailMessageRow>(
      `WITH page AS (
         SELECT m.connected_account_id, m.thread_id, MAX(m.sent_at) AS newest ${source}
          GROUP BY m.connected_account_id, m.thread_id
          ORDER BY MAX(m.sent_at) DESC NULLS LAST, m.thread_id ASC, m.connected_account_id ASC
          LIMIT ${limitParam} OFFSET ${offsetParam}
       )
       SELECT ${MESSAGE_SELECT}
         FROM page
         JOIN email_messages m
           ON m.connected_account_id = page.connected_account_id
          AND m.thread_id = page.thread_id
         JOIN connected_accounts ca ON ca.id = m.connected_account_id
        WHERE ${messageFilter}
        ORDER BY page.newest DESC NULLS LAST, page.thread_id ASC, page.connected_account_id ASC,
                 m.sent_at ASC NULLS LAST, m.id ASC`,
      [...params, limit, offset],
    ),
  ]);

  return {
    data: groupIntoThreads(dataResult.rows),
    total: parseInt(countResult.rows[0]!.count, 10),
    page,
    limit,
  };
}

/**
 * Returns the threads linked to one record, newest conversation first.
 *
 * @param recordType - The linked record's type.
 * @param recordId - The linked record's id.
 * @param userId - The caller. Only their own mailboxes are read.
 */
export async function listMessagesForRecord(
  recordType: EmailLinkRecordType,
  recordId: string,
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedResponse<EmailThread>> {
  return listThreadPage(
    `FROM email_message_links l
       JOIN email_messages m ON m.id = l.email_message_id
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE l.record_type = $1 AND l.record_id = $2 AND ${messageAccessPredicate('$3')}`,
    `EXISTS (
       SELECT 1 FROM email_message_links l
        WHERE l.email_message_id = m.id AND l.record_type = $1 AND l.record_id = $2
     ) AND ${messageAccessPredicate('$3')}`,
    [recordType, recordId, userId],
    page,
    limit,
  );
}

/**
 * Builds "the caller can follow at least one of this message's links", as SQL.
 *
 * Matching runs in a system context and sees every record, so a message can end up linked
 * only to records the mailbox owner cannot read. Treating those as "matched" would drop
 * the message out of the unmatched inbox while the record endpoint answers 403 — the
 * owner's own mail, reachable through nothing. So the inbox asks whether a link is
 * VISIBLE, not whether one exists.
 *
 * The per-type clauses come from `buildVisibilityFilter`, the same source the record
 * endpoint's `canAccessOwnedRecord` reads, so the two cannot disagree about a policy or a
 * team. Leads have no policy anywhere in the product and use their own owner-or-admin
 * rule, matching `canReadLinkedRecord`.
 */
async function buildVisibleLinkExists(
  userId: string,
  userRole: string,
  paramOffset: number,
): Promise<{ sql: string; params: unknown[] }> {
  const link = await buildVisibleLinkPredicate(userId, userRole, paramOffset);
  return {
    sql: `EXISTS (
      SELECT 1 FROM email_message_links l
       WHERE l.email_message_id = m.id AND ${link.sql}
    )`,
    params: link.params,
  };
}

/**
 * Builds "the caller can follow this link", as SQL over a link aliased `l`, for a query that
 * must name the record it reached and not just know one exists.
 */
export async function buildVisibleLinkPredicate(
  userId: string,
  userRole: string,
  paramOffset: number,
): Promise<{ sql: string; params: unknown[] }> {
  const params: unknown[] = [];
  const arms: string[] = [];

  for (const [recordType, objectType, table, alias] of [
    ['contact', 'contact', 'contacts', 'c'],
    ['account', 'account', 'accounts', 'a'],
    ['deal', 'deal', 'deals', 'd'],
  ] as const) {
    const filter = await buildVisibilityFilter(
      objectType,
      userId,
      userRole,
      `${alias}.owner_id`,
      paramOffset + params.length,
    );
    params.push(...filter.params);
    arms.push(
      `EXISTS (SELECT 1 FROM ${table} ${alias}
         WHERE l.record_type = '${recordType}' AND ${alias}.id = l.record_id
           ${filter.clause ? `AND ${filter.clause}` : ''})`,
    );
  }

  // Leads: reads are open to any authenticated user product-wide, but correspondence is
  // more sensitive than the lead it concerns, so the read endpoint applies leads' WRITE
  // rule. Mirrored here rather than widened.
  if (userRole === 'admin') {
    arms.push(`EXISTS (SELECT 1 FROM leads le
       WHERE l.record_type = 'lead' AND le.id = l.record_id)`);
  } else {
    arms.push(`EXISTS (SELECT 1 FROM leads le
       WHERE l.record_type = 'lead' AND le.id = l.record_id
         AND le.owner_id = $${paramOffset + params.length})`);
    params.push(userId);
  }

  return {
    sql: `(${arms.join(' OR ')})`,
    params,
  };
}

/**
 * Returns the caller's synced messages that no record claims, newest conversation first.
 *
 * Scoped to the caller's own mailboxes, which is the whole of "own accounts only": a
 * message another rep synced is not this rep's to triage.
 *
 * @param userId - The caller, whose mailboxes are searched
 * @param userRole - The caller's role, which decides which links count as visible
 * @param page - 1-based page number
 * @param limit - Page size
 * @returns the caller's unmatched threads, one page
 */
export async function listUnmatchedMessages(
  userId: string,
  userRole: string,
  page: number,
  limit: number,
): Promise<PaginatedResponse<EmailThread>> {
  const visible = await buildVisibleLinkExists(userId, userRole, 2);
  return listThreadPage(
    `FROM email_messages m
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE ${messageAccessPredicate('$1')}
        AND NOT ${visible.sql}`,
    `NOT ${visible.sql} AND ${messageAccessPredicate('$1')}`,
    [userId, ...visible.params],
    page,
    limit,
  );
}

/**
 * Reads one message with its bodies, only through the caller's own mailboxes.
 *
 * @returns null when no such message is in the caller's mailboxes.
 */
export async function findMessageForUser(
  messageId: string,
  userId: string,
): Promise<EmailMessageDetail | null> {
  const result = await pool.query<
    EmailMessageRow & { message_body_text: string | null; message_body_html: string | null }
  >(
    `SELECT ${MESSAGE_SELECT}, m.message_body_text, m.message_body_html
       FROM email_messages m
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE m.id = $1 AND ${messageAccessPredicate('$2')}`,
    [messageId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...toEmailMessage(row),
    body_text: row.message_body_text,
    body_html: row.message_body_html,
  };
}

/**
 * Builds who may read a message, as SQL over a message aliased `m` joined to its mailbox
 * aliased `ca`.
 *
 * Today both terms reduce to the owner, since no path reads across mailboxes. The privacy
 * term is still written out so a future cross-mailbox read widens the owner term in plain
 * sight and inherits the rule that a private thread stays its owner's alone.
 *
 * @param userParam - The placeholder bound to the caller's id, e.g. `$3`.
 * @param mailboxScope - Which mailboxes the read spans; the caller's own unless widened.
 */
export function messageAccessPredicate(
  userParam: string,
  mailboxScope = `ca.user_id = ${userParam}`,
): string {
  return `(${mailboxScope}) AND (NOT m.is_private OR ca.user_id = ${userParam})`;
}

/** Namespace for the per-mailbox advisory lock, so it cannot collide with another feature's. */
const THREAD_PRIVACY_LOCK_NAMESPACE = 'email_thread_privacy';

/**
 * Serializes privacy writes against message inserts on one mailbox, for this transaction.
 *
 * Under READ COMMITTED a privacy toggle cannot see a page a sync is still inserting, and
 * that page's inheritance cannot see the toggle; whichever commits second would leave a
 * public row in a private thread. Taken after any intent lock, keeping intent → message.
 */
export async function lockMailboxThreads(client: PoolClient, accountId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
    THREAD_PRIVACY_LOCK_NAMESPACE,
    accountId,
  ]);
}

/**
 * Makes every touched row private when its thread already holds a private message.
 *
 * Over every row the statement touched, not only inserts: both upserts can move an existing
 * row into another thread on conflict. It only ever sets true: a private row moved into a
 * public thread stays private, since the owner chose that for the row.
 *
 * @returns each touched row's resulting `is_private`, by message id.
 */
export async function inheritThreadPrivacy(
  client: PoolClient,
  accountId: string,
  providerMessageIds: readonly string[],
): Promise<Map<string, boolean>> {
  if (providerMessageIds.length === 0) return new Map();
  await client.query(
    `UPDATE email_messages m
        SET is_private = true
      WHERE m.connected_account_id = $1
        AND m.provider_message_id = ANY($2)
        AND NOT m.is_private
        AND EXISTS (
          SELECT 1 FROM email_messages sibling
           WHERE sibling.connected_account_id = m.connected_account_id
             AND sibling.thread_id = m.thread_id
             AND sibling.is_private
        )`,
    [accountId, providerMessageIds],
  );
  const result = await client.query<{ id: string; is_private: boolean }>(
    `SELECT id, is_private FROM email_messages
      WHERE connected_account_id = $1 AND provider_message_id = ANY($2)`,
    [accountId, providerMessageIds],
  );
  return new Map(result.rows.map((row) => [row.id, row.is_private]));
}

/**
 * Marks or unmarks the whole thread a message belongs to as private, in its owner's mailbox.
 *
 * @returns the thread's new setting and how many messages changed, or null when the message
 *   is not in one of the caller's mailboxes.
 */
export async function setThreadPrivacy(
  messageId: string,
  userId: string,
  isPrivate: boolean,
  actor: AuditActor,
): Promise<{ isPrivate: boolean; updated: number } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same order as sync and send: shared ingest lock first, so an erasure, which takes it
    // exclusively, never interleaves with this write and deadlocks on the rows.
    await lockForIngest(client);
    // The scrub function reaches only the mailboxes of the user named here, not the request's.
    await setRlsUserIdTo(client, userId);
    const mailbox = await client.query<{ connected_account_id: string; email_address: string }>(
      `SELECT m.connected_account_id, ca.email_address
         FROM email_messages m
         JOIN connected_accounts ca ON ca.id = m.connected_account_id
        WHERE m.id = $1 AND ca.user_id = $2`,
      [messageId, userId],
    );
    const owned = mailbox.rows[0];
    if (!owned) {
      await client.query('ROLLBACK');
      return null;
    }

    // Read under the lock: until then a sync page may move the message.
    await lockMailboxThreads(client, owned.connected_account_id);
    const thread = await client.query<{ thread_id: string }>(
      'SELECT thread_id FROM email_messages WHERE id = $1',
      [messageId],
    );
    const threadRow = thread.rows[0];
    if (!threadRow) {
      // Disconnected meanwhile: the mailbox's messages went with it.
      await client.query('ROLLBACK');
      return null;
    }
    const message = { ...owned, thread_id: threadRow.thread_id };
    const threadMessages = await client.query<{ id: string }>(
      'SELECT id FROM email_messages WHERE connected_account_id = $1 AND thread_id = $2',
      [message.connected_account_id, message.thread_id],
    );
    const threadIds = threadMessages.rows.map((row) => row.id);
    const updated = await client.query(
      `UPDATE email_messages SET is_private = $2 WHERE id = ANY($1::uuid[]) AND is_private <> $2`,
      [threadIds, isPrivate],
    );
    await setUnsettledSendsPrivacy(client, message.connected_account_id, threadIds, isPrivate);
    if (isPrivate) {
      // The thread's sends, stored or still unconfirmed, name who they concerned in the log.
      const threadSendIds = await findThreadSendIntentIds(
        client,
        message.connected_account_id,
        threadIds,
      );
      await markSendEntriesPrivate(client, message.connected_account_id, {
        messageIds: threadIds,
        intentIds: threadSendIds,
      });
      // Activities already filed from the thread carry its text onto shared timelines,
      // whoever owns them now: the text is the mailbox owner's. A real change of setting
      // moves every filed activity's cutoff, so text written and removed meanwhile is masked.
      const activityIds = await scrubActivitiesFiledFromOwnMail(
        client,
        threadIds,
        PRIVATE_EMAIL_SUBJECT,
        'private_thread',
        (updated.rowCount ?? 0) > 0,
      );
      // The removed text is not logged again; redacted_records masks earlier entries.
      await writeAuditEntries(
        client,
        activityIds.map((id) => ({
          recordType: 'activity',
          recordId: id,
          recordName: PRIVATE_EMAIL_SUBJECT,
          eventType: 'updated',
          fieldName: 'subject',
          oldValue: null,
          newValue: PRIVATE_EMAIL_SUBJECT,
          changedById: actor.id,
          changedByName: actor.name,
        })),
      );
    }

    if ((updated.rowCount ?? 0) > 0) {
      await writeAuditEntry(client, {
        recordType: 'connected_account',
        recordId: message.connected_account_id,
        recordName: message.email_address,
        eventType: 'email_thread_privacy_changed',
        // A count, not the thread id: an RFC-derived id can name the correspondent's host.
        fieldName: 'thread_privacy',
        // Not the thread's prior setting: a thread can mix both, and the count says what changed.
        oldValue: null,
        newValue: `${isPrivate ? 'private' : 'visible'} (${updated.rowCount ?? 0} messages)`,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }
    await client.query('COMMIT');
    return { isPrivate, updated: updated.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reads one link, but only through a message in the caller's own mailboxes.
 *
 * The delete path needs the linked record before removing the row, so the caller can be
 * checked against the same rule that governs creating one.
 */
export async function findLinkForUser(
  messageId: string,
  linkId: string,
  userId: string,
): Promise<{ record_type: EmailLinkRecordType; record_id: string } | null> {
  const result = await pool.query<{ record_type: EmailLinkRecordType; record_id: string }>(
    `SELECT l.record_type, l.record_id
       FROM email_message_links l
       JOIN email_messages m ON m.id = l.email_message_id
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE l.id = $1 AND l.email_message_id = $2 AND ca.user_id = $3`,
    [linkId, messageId, userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Links a message to a record by hand.
 *
 * The message must be in one of the caller's own mailboxes; the controller has already
 * established that the record exists and that the caller may write to it. A record deleted
 * between those two moments leaves a link the ordinary cleanup would have caught, which is
 * the same window every polymorphic writer here has.
 *
 * The audit entry is filed against the mailbox, not the linked record — an entry on a
 * contact would reach the client's Change History, which renders only the event types its
 * own schema admits. The linked record is named in the entry instead.
 *
 * @param actor - The caller, for the audit entry.
 * @throws when the message is not in the caller's mailboxes. A duplicate link surfaces as
 *   PG 23505, which the controller maps to 409.
 */
export async function createManualLink(
  messageId: string,
  recordType: EmailLinkRecordType,
  recordId: string,
  userId: string,
  actor: AuditActor,
): Promise<EmailMessageLinkRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mailbox = await client.query<{ id: string; email_address: string }>(
      `SELECT ca.id, ca.email_address
         FROM email_messages m
         JOIN connected_accounts ca ON ca.id = m.connected_account_id
        WHERE m.id = $1 AND ca.user_id = $2`,
      [messageId, userId],
    );
    if (!mailbox.rows[0]) {
      // Thrown, not rolled back here: the catch below owns the single ROLLBACK, and a
      // second one against a closed transaction logs a PG warning per rejected request.
      throw Object.assign(new Error('No such message in your mailboxes'), {
        code: 'EMAIL_MESSAGE_NOT_FOUND',
      });
    }

    const inserted = await client.query<EmailMessageLinkRow>(
      // source stays NULL: a person filed this, which is what NULL means here and on
      // audit_log.
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, $2, $3, 'manual')
       RETURNING id, email_message_id, record_type, record_id, match_type, created_at`,
      [messageId, recordType, recordId],
    );

    // Filing it by hand reverses an earlier removal, so the tombstone must go with it.
    await clearDerivedLinkSuppression(client, messageId, recordType, recordId);

    await writeAuditEntry(client, {
      recordType: 'connected_account',
      recordId: mailbox.rows[0].id,
      recordName: mailbox.rows[0].email_address,
      eventType: 'email_linked',
      fieldName: 'email_message_link',
      newValue: `${recordType}:${recordId}`,
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return inserted.rows[0]!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes a link by hand — automatic or manual.
 *
 * A link removed this way does not come back. Nothing re-matches a stored message, and the
 * removal is recorded so re-derivation cannot restore it either.
 *
 * Scoped the same way as the create: the link must hang off a message in one of the
 * caller's own mailboxes, so a link id alone reaches nothing.
 *
 * @returns true when a link was removed, false when none matched.
 */
export async function deleteMessageLink(
  messageId: string,
  linkId: string,
  userId: string,
  actor: AuditActor,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const deleted = await client.query<{
      record_type: string;
      record_id: string;
      account_id: string;
      email_address: string;
    }>(
      `DELETE FROM email_message_links l
        USING email_messages m, connected_accounts ca
        WHERE l.id = $1
          AND l.email_message_id = $2
          AND m.id = l.email_message_id
          AND ca.id = m.connected_account_id
          AND ca.user_id = $3
        RETURNING l.record_type, l.record_id, ca.id AS account_id, ca.email_address`,
      [linkId, messageId, userId],
    );
    if (!deleted.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }

    // Every removal, not just an automatic one: filing a derived pair by hand makes it
    // 'manual', and gating on match_type would let that pair be re-derived after the user
    // removed it. A tombstone on a pair nothing derives is inert.
    await suppressDerivedLink(
      client,
      messageId,
      deleted.rows[0].record_type,
      deleted.rows[0].record_id,
    );

    await writeAuditEntry(client, {
      recordType: 'connected_account',
      recordId: deleted.rows[0].account_id,
      recordName: deleted.rows[0].email_address,
      eventType: 'email_unlinked',
      fieldName: 'email_message_link',
      oldValue: `${deleted.rows[0].record_type}:${deleted.rows[0].record_id}`,
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
