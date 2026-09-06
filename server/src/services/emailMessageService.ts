/**
 * Reads synced messages through the records they are linked to.
 *
 * Two rules govern every query here, and both are in the WHERE clause rather than in a
 * caller:
 *
 * 1. A message is readable only through the mailbox that synced it. Every rep holds
 *    `connected_accounts:manage`, so scoping by `is_private` alone would let one rep read
 *    another's mail with a shared contact — including bodies.
 *
 *    It also subsumes `is_private`, which restricts a message to that same owner — so no
 *    query here names that column, and a cross-mailbox read path would have to carry the
 *    predicate itself.
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
  EmailMessage,
  EmailThread,
} from '@minicrm/shared/schemas/emailMessageSchema.js';

import pool from '../db.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';

/** A link row as the write endpoints return it. */
export interface EmailMessageLinkRow {
  id: string;
  email_message_id: string;
  record_type: EmailLinkRecordType;
  record_id: string;
  match_type: 'auto' | 'manual';
  created_at: Date;
}

/** A row from email_messages, as the list projection selects it. */
interface EmailMessageRow {
  id: string;
  connected_account_id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  message_snippet: string | null;
  has_attachments: boolean;
  sent_at: Date | null;
  is_private: boolean;
}

/**
 * Columns every read returns.
 *
 * `message_body_html` and `message_body_text` are deliberately absent: nothing renders a
 * body yet, the HTML is stored unsanitized, and a list has no business carrying one.
 */
const MESSAGE_SELECT = `m.id, m.connected_account_id, m.thread_id, m.direction, m.from_address,
       m.to_addresses, m.cc_addresses, m.subject, m.message_snippet, m.has_attachments,
       m.sent_at, m.is_private`;

/** Maps a row to the API shape, rendering timestamps as ISO strings. */
function toEmailMessage(row: EmailMessageRow): EmailMessage {
  return {
    id: row.id,
    connected_account_id: row.connected_account_id,
    thread_id: row.thread_id,
    direction: row.direction,
    from_address: row.from_address,
    to_addresses: row.to_addresses,
    cc_addresses: row.cc_addresses,
    subject: row.subject,
    snippet: row.message_snippet,
    has_attachments: row.has_attachments,
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    is_private: row.is_private,
  };
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
 * @param messageFilter - The same restriction as a bare predicate, re-applied when the
 *   page's messages are joined back.
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
      WHERE l.record_type = $1 AND l.record_id = $2 AND ca.user_id = $3`,
    `EXISTS (
       SELECT 1 FROM email_message_links l
        WHERE l.email_message_id = m.id AND l.record_type = $1 AND l.record_id = $2
     )`,
    [recordType, recordId, userId],
    page,
    limit,
  );
}

/**
 * Returns the caller's synced messages that no record claims, newest conversation first.
 *
 * Scoped to the caller's own mailboxes, which is the whole of "own accounts only": a
 * message another rep synced is not this rep's to triage.
 */
export async function listUnmatchedMessages(
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedResponse<EmailThread>> {
  return listThreadPage(
    `FROM email_messages m
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE ca.user_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM email_message_links l WHERE l.email_message_id = m.id
        )`,
    `NOT EXISTS (SELECT 1 FROM email_message_links l WHERE l.email_message_id = m.id)`,
    [userId],
    page,
    limit,
  );
}

/**
 * Tables holding the linkable record types, keyed by the value the links table stores.
 *
 * An allowlist rather than an interpolated name: `recordType` is typed, but the table name
 * reaches SQL as text, and a lookup keeps it that way by construction.
 */
const OWNER_TABLES: Readonly<Record<EmailLinkRecordType, string>> = {
  contact: 'contacts',
  lead: 'leads',
  account: 'accounts',
  deal: 'deals',
};

/**
 * Reads just the owner of a linkable record, or null when no such record exists.
 *
 * The detail finders would answer this too, but each builds a whole page's worth of row —
 * joined addresses, computed stage probability — inside its own RLS transaction, to
 * resolve one boolean.
 */
export async function findLinkedRecordOwner(
  recordType: EmailLinkRecordType,
  recordId: string,
): Promise<string | null> {
  // Outside RLS, unlike the detail finders: the caller gates on the owner returned.
  const result = await pool.query<{ owner_id: string }>(
    `SELECT owner_id FROM ${OWNER_TABLES[recordType]} WHERE id = $1 LIMIT 1`,
    [recordId],
  );
  return result.rows[0]?.owner_id ?? null;
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
 * An auto link removed this way does not come back: only newly synced messages are ever
 * matched, so this is the user's decision and it stands.
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
