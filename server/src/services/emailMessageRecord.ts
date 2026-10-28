/**
 * The stored shape of a synced message and the record it is linked to, shared by the read,
 * send and filing paths. It depends on no service, so each can import it without a cycle.
 */

import type {
  EmailLinkRecordType,
  EmailMessage,
} from '@minicrm/shared/schemas/emailMessageSchema.js';
import type { PoolClient } from 'pg';

import pool from '../db.js';

/** A row from email_messages, as the list projection selects it. */
export interface EmailMessageRow {
  id: string;
  connected_account_id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  reply_to_addresses: string[];
  subject: string | null;
  message_snippet: string | null;
  has_attachments: boolean;
  sent_at: Date | null;
  is_private: boolean;
}

/**
 * The columns a message's list shape is read from.
 *
 * The bodies are deliberately absent: a list has no business carrying one, and the HTML is
 * stored unsanitized. Only `findMessageForUser` adds them, for one message at a time.
 */
export const MESSAGE_SELECT = `m.id, m.connected_account_id, m.thread_id, m.direction, m.from_address,
       m.to_addresses, m.cc_addresses, m.reply_to_addresses, m.subject, m.message_snippet,
       m.has_attachments, m.sent_at, m.is_private`;

/** Maps a row to the API shape, rendering timestamps as ISO strings. */
export function toEmailMessage(row: EmailMessageRow): EmailMessage {
  return {
    id: row.id,
    connected_account_id: row.connected_account_id,
    thread_id: row.thread_id,
    direction: row.direction,
    from_address: row.from_address,
    to_addresses: row.to_addresses,
    cc_addresses: row.cc_addresses,
    reply_to_addresses: row.reply_to_addresses,
    subject: row.subject,
    snippet: row.message_snippet,
    has_attachments: row.has_attachments,
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    is_private: row.is_private,
  };
}

/** Subject of an Email activity filed from a private thread, which records the send only. */
export const PRIVATE_EMAIL_SUBJECT = 'Private email';

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
 *
 * @param executor - A transaction's client, when the answer must hold within it.
 */
export async function findLinkedRecordOwner(
  recordType: EmailLinkRecordType,
  recordId: string,
  executor: Pick<PoolClient, 'query'> = pool,
): Promise<string | null> {
  // Outside RLS, unlike the detail finders: the caller gates on the owner returned.
  const result = await executor.query<{ owner_id: string }>(
    `SELECT owner_id FROM ${OWNER_TABLES[recordType]} WHERE id = $1 LIMIT 1`,
    [recordId],
  );
  return result.rows[0]?.owner_id ?? null;
}
