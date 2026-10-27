/**
 * The durable half of a send: what only this application knows about it, recorded before
 * the provider is called, and the one routine that files a sent message from it.
 *
 * A send writes to the provider and to this database, and nothing makes the pair atomic.
 * The intent is what survives the second write failing: the send path files from it when
 * it can, and the sync engine files from it when the Sent copy arrives.
 *
 * Status moves only along these edges, each guarded in its UPDATE's WHERE clause:
 *
 *   pending → not_sent      the provider refused and nothing went
 *   not_sent → pending      a retry under the same key reclaims it, as a new send:
 *                           fresh Message-ID, no provider id, created_at restarted
 *   pending → sent          the provider accepted; its id is recorded
 *   pending → unconfirmed   the outcome is unknown, or the send never answered
 *   sent    → unconfirmed   accepted but still unfiled after an hour
 *   pending | sent | unconfirmed → filed   exactly once, by whichever path locks it first
 *
 * Lock order is the intent, then the message. Both filing paths take it that way, which
 * is what keeps them from deadlocking each other on one message.
 */

import type {
  EmailLinkRecordType,
  EmailMessage,
} from '@minicrm/shared/schemas/emailMessageSchema.js';

import type { PoolClient } from 'pg';

import pool from '../db.js';
import logger from '../logger.js';
import { insertActivity } from './activityService.js';
import { writeAuditEntry, type AuditActor } from './auditService.js';
import { clearDerivedLinkSuppression } from './emailMatchingService.js';
import {
  findLinkedRecordOwner,
  MESSAGE_SELECT,
  toEmailMessage,
  type EmailMessageRow,
} from './emailMessageService.js';
import type { NormalizedMessage } from './mail/mailProvider.js';
import { truncate } from './mail/messageBody.js';
import { setRlsUserIdTo } from './rlsContextService.js';

export type SendIntentStatus = 'pending' | 'not_sent' | 'sent' | 'unconfirmed' | 'filed';

/** How long a send may stay unanswered or unfiled before it is reported unconfirmed. */
const INTENT_UNSETTLED_AFTER_MS = 60 * 60 * 1000;

/** `activities.subject` is varchar(255); a template subject can render far longer. */
const ACTIVITY_SUBJECT_MAX = 255;

/** What an activity names a message whose subject is empty; the column needs one. */
const UNTITLED_SUBJECT = '(no subject)';

/** Record types an activity can be filed against; `activities` has no lead column. */
const ACTIVITY_RECORD_FIELDS = {
  contact: 'contact_id',
  account: 'account_id',
  deal: 'deal_id',
} as const satisfies Partial<Record<EmailLinkRecordType, string>>;

/** Statuses a Sent copy can still be filed from. */
const RECONCILABLE: readonly SendIntentStatus[] = ['pending', 'sent', 'unconfirmed'];

export interface SendIntent {
  id: string;
  userId: string;
  connectedAccountId: string;
  rfcMessageId: string;
  providerMessageId: string | null;
  recordType: EmailLinkRecordType | null;
  recordId: string | null;
  activityNotes: string | null;
  actorName: string;
  status: SendIntentStatus;
  /** The answered or forwarded message's thread was private when the send was claimed. */
  threadPrivate: boolean;
}

export interface NewSendIntent {
  userId: string;
  actorName: string;
  connectedAccountId: string;
  /** Bare, as `normalizeMessageId` returns it and as sync stores it. */
  rfcMessageId: string;
  recordType: EmailLinkRecordType | null;
  recordId: string | null;
  activityNotes: string | null;
  /** Whether the answered or forwarded message's thread is private; false for a new one. */
  threadPrivate: boolean;
  toAddresses: readonly string[];
  ccAddresses: readonly string[];
  /** The client's key for this compose; a repeat under it never sends again. */
  idempotencyKey: string;
  requestHash: string;
  unresolvedMergeTags: readonly string[];
}

/** What a key's intent records, enough to answer a repeat of its request. */
export interface IntentUnderKey {
  status: SendIntentStatus;
  requestHash: string;
  /** The filed message, or null when unfiled or since deleted. */
  message: EmailMessage | null;
  unresolvedMergeTags: string[];
}

/** The stored message a filing attaches to. */
export interface FilableMessage {
  id: string;
  providerMessageId: string;
  subject: string | null;
  bodyText: string | null;
  toAddresses: readonly string[];
  ccAddresses: readonly string[];
  /** As it stands after the thread's privacy is inherited; a private send files no body. */
  isPrivate: boolean;
}

interface SendIntentRow {
  id: string;
  user_id: string;
  connected_account_id: string;
  rfc_message_id: string;
  provider_message_id: string | null;
  record_type: EmailLinkRecordType | null;
  record_id: string | null;
  activity_notes: string | null;
  actor_name: string;
  status: SendIntentStatus;
  thread_private: boolean;
}

const INTENT_COLUMNS = `id, user_id, connected_account_id, rfc_message_id, provider_message_id,
  record_type, record_id, activity_notes, actor_name, status, thread_private`;

function toSendIntent(row: SendIntentRow): SendIntent {
  return {
    id: row.id,
    userId: row.user_id,
    connectedAccountId: row.connected_account_id,
    rfcMessageId: row.rfc_message_id,
    providerMessageId: row.provider_message_id,
    recordType: row.record_type,
    recordId: row.record_id,
    activityNotes: row.activity_notes,
    actorName: row.actor_name,
    status: row.status,
    threadPrivate: row.thread_private,
  };
}

/** Reads what a user's key already recorded, or null for a key never used. */
export async function findIntentByKey(
  userId: string,
  idempotencyKey: string,
): Promise<IntentUnderKey | null> {
  // Joined rather than read twice, so a message deleted between reads cannot be half-seen.
  const result = await pool.query<
    Partial<EmailMessageRow> & {
      intent_status: SendIntentStatus;
      request_hash: string;
      unresolved_merge_tags: string[];
    }
  >(
    `SELECT i.status AS intent_status, i.request_hash, i.unresolved_merge_tags,
            ${MESSAGE_SELECT}
       FROM email_send_intents i
       LEFT JOIN email_messages m ON m.id = i.email_message_id
      WHERE i.user_id = $1 AND i.idempotency_key = $2`,
    [userId, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    status: row.intent_status,
    requestHash: row.request_hash,
    // Safe: every message column is present whenever the joined id is.
    message: row.id ? toEmailMessage(row as EmailMessageRow) : null,
    unresolvedMergeTags: row.unresolved_merge_tags,
  };
}

/** Sends one user may make per hour unless `EMAIL_SEND_MAX_PER_HOUR` says otherwise. */
export const DEFAULT_EMAIL_SEND_MAX_PER_HOUR = 100;

const SEND_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** First key of the advisory lock that serializes one user's claims; the second is theirs. */
export const SEND_LIMIT_LOCK_NAMESPACE = 5791;

/**
 * The hourly send ceiling. Anything but a positive integer falls back to the default: a
 * typo must not lift or zero the limit.
 */
export function emailSendMaxPerHour(): number {
  const override = Number(process.env.EMAIL_SEND_MAX_PER_HOUR);
  return Number.isInteger(override) && override > 0 ? override : DEFAULT_EMAIL_SEND_MAX_PER_HOUR;
}

/**
 * Sends counted against the ceiling: the user's ledger entries in the window. The ledger,
 * not the intents, because intents go with their mailbox and the count must not.
 */
const COUNTED_SENDS = `FROM email_send_ledger
  WHERE user_id = $1 AND created_at > now() - ($2 || ' milliseconds')::interval`;

/**
 * How long until the user may send `headroom` more than they have, or null if they may now.
 *
 * Every send past the ceiling must leave the window, not only the oldest: a ceiling lowered
 * since, or a bypass lifted, can leave several over. Timed by the database's clock alone,
 * so skew with the app server cannot reach the answer.
 */
async function secondsUntilUnderLimit(
  executor: Pick<PoolClient, 'query'>,
  userId: string,
  headroom: number,
): Promise<number | null> {
  const counted = await executor.query<{ sends: number }>(
    `SELECT count(*)::int AS sends ${COUNTED_SENDS}`,
    [userId, SEND_LIMIT_WINDOW_MS],
  );
  // Safe: an aggregate always returns its one row.
  const over = counted.rows[0]!.sends + headroom - emailSendMaxPerHour();
  if (over <= 0) return null;
  const frees = await executor.query<{ seconds: number }>(
    `SELECT ceil(extract(epoch FROM created_at + ($2 || ' milliseconds')::interval - now()))::int
              AS seconds
       ${COUNTED_SENDS}
      ORDER BY created_at
      OFFSET $3 LIMIT 1`,
    [userId, SEND_LIMIT_WINDOW_MS, over - 1],
  );
  // Safe: `over` never exceeds the counted rows, so the offset always lands on one.
  return Math.max(1, frees.rows[0]!.seconds);
}

/**
 * Refuses early, before any rendering or token refresh, a send that the ceiling would
 * refuse at its claim. Advisory only: the claim's locked count is the one that holds. A key
 * already in use is never refused here, since a repeat sends nothing.
 *
 * @returns seconds until the user may send, or null when they may now.
 */
export async function precheckSendLimit(
  userId: string,
  idempotencyKey: string,
): Promise<number | null> {
  // A refused send retried under its key does send, so only that key is checked here.
  const used = await pool.query(
    `SELECT 1 FROM email_send_intents
      WHERE user_id = $1 AND idempotency_key = $2 AND status <> 'not_sent'`,
    [userId, idempotencyKey],
  );
  if ((used.rowCount ?? 0) > 0) return null;
  return secondsUntilUnderLimit(pool, userId, 1);
}

/** What claiming a key came to. */
export type SendClaim =
  | { kind: 'claimed'; intentId: string }
  | { kind: 'taken' }
  | { kind: 'limited'; retryAfterSeconds: number };

/**
 * Records a send about to be handed to the provider, under the client's key, and counts it
 * against the user's hourly ceiling.
 *
 * The insert settles two concurrent requests with one key by itself: the loser inserts
 * nothing. A key whose earlier send was refused is reclaimed by a conditional update, so two
 * retries cannot both take it. Each claim writes a ledger entry, and the ceiling counts the
 * user's entries from the last hour; a refusal that sent nothing removes its own. Being in
 * the database, it holds across processes, restarts and reconnected mailboxes. A per-user
 * advisory lock makes the claim and the count one step, so two requests at the edge cannot
 * both pass. A key that is already taken claims nothing and is never limited: a repeat
 * sends nothing.
 *
 * @param enforceLimit - False where every limiter is bypassed (`shouldSkipRateLimit`).
 * @returns `taken` when the key belongs to another attempt — the caller answers from
 *   `findIntentByKey`.
 */
export async function claimSendIntent(
  input: NewSendIntent,
  enforceLimit: boolean,
): Promise<SendClaim> {
  const values = [
    input.userId,
    input.actorName,
    input.connectedAccountId,
    input.rfcMessageId,
    input.recordType,
    input.recordId,
    input.activityNotes,
    input.toAddresses,
    input.ccAddresses,
    input.idempotencyKey,
    input.requestHash,
    input.unresolvedMergeTags,
    input.threadPrivate,
  ];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (enforceLimit) {
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        SEND_LIMIT_LOCK_NAMESPACE,
        input.userId,
      ]);
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO email_send_intents
         (user_id, actor_name, connected_account_id, rfc_message_id, record_type, record_id,
          activity_notes, to_addresses, cc_addresses, idempotency_key, request_hash,
          unresolved_merge_tags, thread_private)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      values,
    );
    const claimed =
      inserted.rows[0] ??
      (
        await client.query<{ id: string }>(
          `UPDATE email_send_intents
              SET status = 'pending', actor_name = $2, connected_account_id = $3,
                  rfc_message_id = $4, provider_message_id = NULL, record_type = $5,
                  record_id = $6, activity_notes = $7, to_addresses = $8, cc_addresses = $9,
                  unresolved_merge_tags = $12, thread_private = $13, created_at = now(),
                  updated_at = now()
            WHERE user_id = $1 AND idempotency_key = $10 AND request_hash = $11
              AND status = 'not_sent'
            RETURNING id`,
          values,
        )
      ).rows[0];
    if (!claimed) {
      await client.query('COMMIT');
      return { kind: 'taken' };
    }
    // Written whether or not the ceiling is enforced, so lifting a bypass sees true counts.
    await client.query('INSERT INTO email_send_ledger (user_id, intent_id) VALUES ($1, $2)', [
      input.userId,
      claimed.id,
    ]);

    if (enforceLimit) {
      const retryAfterSeconds = await secondsUntilUnderLimit(client, input.userId, 0);
      if (retryAfterSeconds !== null) {
        await client.query('ROLLBACK');
        return { kind: 'limited', retryAfterSeconds };
      }
    }

    await client.query('COMMIT');
    return { kind: 'claimed', intentId: claimed.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Records the provider's id for a message not yet submitted, so even an unanswered send has it. */
export async function recordPreparedMessageId(
  intentId: string,
  providerMessageId: string,
): Promise<void> {
  await pool.query(
    `UPDATE email_send_intents SET provider_message_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [intentId, providerMessageId],
  );
}

/** The provider accepted the message. */
export async function markIntentSent(intentId: string, providerMessageId: string): Promise<void> {
  await pool.query(
    `UPDATE email_send_intents
        SET status = 'sent', provider_message_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [intentId, providerMessageId],
  );
}

/** The provider refused and nothing went. Drops the copy of the message it no longer needs. */
export async function markIntentNotSent(intentId: string): Promise<void> {
  // One statement, so the refusal and the uncounting cannot come apart.
  await pool.query(
    `WITH refused AS (
       UPDATE email_send_intents
          SET status = 'not_sent', activity_notes = NULL, to_addresses = '{}',
              cc_addresses = '{}', updated_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING id
     )
     DELETE FROM email_send_ledger WHERE intent_id IN (SELECT id FROM refused)`,
    [intentId],
  );
}

/** Which intents to report unconfirmed: one by id, or every one left unsettled too long. */
type UnconfirmTarget = { intentId: string } | { unsettledForMs: number };

/** Selections, fixed rather than composed, so no caller's value ever reaches the SQL text. */
const UNCONFIRM_ONE = `id = $1 AND status = 'pending'`;
const UNCONFIRM_STALE = `status IN ('pending', 'sent')
  AND updated_at < now() - ($1 || ' milliseconds')::interval`;

/**
 * Moves intents to `unconfirmed` and audits each, so a send that may have gone out is
 * recorded even if it is never filed. The recipients move into the audit entry.
 */
async function unconfirm(target: UnconfirmTarget): Promise<number> {
  const [condition, value] =
    'intentId' in target
      ? [UNCONFIRM_ONE, target.intentId]
      : [UNCONFIRM_STALE, target.unsettledForMs];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query<{
      id: string;
      user_id: string;
      actor_name: string;
      connected_account_id: string;
      email_address: string;
      provider_confirmed: boolean;
      to_addresses: string[];
      cc_addresses: string[];
      record_type: string | null;
      record_id: string | null;
    }>(
      `WITH moved AS (
         SELECT id, status AS previous_status, to_addresses, cc_addresses
           FROM email_send_intents
          WHERE ${condition}
          ORDER BY id
            FOR UPDATE
       )
       UPDATE email_send_intents i
          SET status = 'unconfirmed', to_addresses = '{}', cc_addresses = '{}',
              updated_at = now()
         FROM moved, connected_accounts ca
        WHERE i.id = moved.id AND ca.id = i.connected_account_id
       RETURNING i.id, i.user_id, i.actor_name, i.connected_account_id, ca.email_address,
                 moved.previous_status = 'sent' AS provider_confirmed,
                 moved.to_addresses, moved.cc_addresses, i.record_type, i.record_id`,
      [value],
    );
    for (const row of moved.rows) {
      await writeAuditEntry(client, {
        recordType: 'connected_account',
        recordId: row.connected_account_id,
        recordName: row.email_address,
        eventType: 'email_send_unconfirmed',
        fieldName: 'email_send_intent',
        newValue: JSON.stringify({
          intent_id: row.id,
          provider_confirmed: row.provider_confirmed,
          to: row.to_addresses,
          cc: row.cc_addresses,
          sent_from_record: row.record_type ? `${row.record_type}:${row.record_id}` : null,
        }),
        changedById: row.user_id,
        changedByName: row.actor_name,
      });
    }
    await client.query('COMMIT');
    return moved.rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** The provider did not say whether the message went. */
export async function markIntentUnconfirmed(intentId: string): Promise<void> {
  await unconfirm({ intentId });
}

/**
 * Reports every send left unanswered or unfiled for an hour as unconfirmed.
 * Runs on every sync scheduler tick, before the feature flag is consulted, and again
 * before the retention purge, so no intent is deleted without its audit entry.
 *
 * @returns how many intents moved.
 */
export async function sweepUnsettledIntents(): Promise<number> {
  return unconfirm({ unsettledForMs: INTENT_UNSETTLED_AFTER_MS });
}

/** Locks one intent for filing. @returns it, whatever its status. */
export async function lockIntent(client: PoolClient, intentId: string): Promise<SendIntent | null> {
  const result = await client.query<SendIntentRow>(
    `SELECT ${INTENT_COLUMNS} FROM email_send_intents WHERE id = $1 FOR UPDATE`,
    [intentId],
  );
  return result.rows[0] ? toSendIntent(result.rows[0]) : null;
}

/**
 * Locks every intent on a mailbox that a page of Sent copies could file, in id order so two
 * concurrent pages cannot deadlock each other.
 */
export async function lockReconcilableIntents(
  client: PoolClient,
  accountId: string,
  providerMessageIds: readonly string[],
  rfcMessageIds: readonly string[],
): Promise<SendIntent[]> {
  if (providerMessageIds.length === 0 && rfcMessageIds.length === 0) return [];
  const result = await client.query<SendIntentRow>(
    `SELECT ${INTENT_COLUMNS} FROM email_send_intents
      WHERE connected_account_id = $1
        AND status = ANY($2)
        AND (provider_message_id = ANY($3) OR rfc_message_id = ANY($4))
      ORDER BY id
        FOR UPDATE`,
    [accountId, RECONCILABLE, providerMessageIds, rfcMessageIds],
  );
  return result.rows.map(toSendIntent);
}

/**
 * Files a stored message from its intent: the record it was sent from, its Email activity,
 * and its `email_sent` audit entry. The caller holds the intent's lock, and must make this
 * the last work in its transaction: it leaves the row-security user set to the sender.
 *
 * A record deleted since the send is skipped rather than failing the filing: the message
 * is still the user's, and the address matches still apply.
 *
 * @returns the activity's id, for the caller to announce after its commit; null when none.
 */
export async function fileSentMessage(
  client: PoolClient,
  intent: SendIntent,
  message: FilableMessage,
  accountEmailAddress: string,
): Promise<string | null> {
  const actor: AuditActor = { id: intent.userId, name: intent.actorName };
  const record =
    intent.recordType !== null &&
    intent.recordId !== null &&
    (await findLinkedRecordOwner(intent.recordType, intent.recordId, client)) !== null
      ? { type: intent.recordType, id: intent.recordId }
      : null;

  if (record) {
    // Sent from a record, so filed there whatever its addresses match: a deal has none,
    // and a contact may have been written to at an address it does not hold.
    await client.query(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (email_message_id, record_type, record_id) DO NOTHING`,
      [message.id, record.type, record.id],
    );
    await clearDerivedLinkSuppression(client, message.id, record.type, record.id);
  }

  const links = await client.query<{ record_type: string; record_id: string }>(
    `SELECT record_type, record_id FROM email_message_links
      WHERE email_message_id = $1 ORDER BY record_type, record_id`,
    [message.id],
  );

  // The claim knew the conversation; the stored row's thread may be one sync derived.
  const isPrivate = intent.threadPrivate || message.isPrivate;
  if (isPrivate && !message.isPrivate) {
    await client.query('UPDATE email_messages SET is_private = true WHERE id = $1', [message.id]);
  }

  const activityField =
    record && record.type !== 'lead' ? ACTIVITY_RECORD_FIELDS[record.type] : null;
  let activityId: string | null = null;
  if (record && activityField) {
    // The activity is the sender's own write and goes through their row policies; a sync
    // has no request to take the user from. Left set: a caller files last in its transaction.
    await setRlsUserIdTo(client, intent.userId);
    activityId = await insertActivity(
      client,
      {
        type: 'Email',
        direction: 'Outbound',
        subject: truncate(message.subject?.trim() || UNTITLED_SUBJECT, ACTIVITY_SUBJECT_MAX),
        // A private thread stays its owner's: the activity records the send, not the text.
        notes: isPrivate ? undefined : (intent.activityNotes ?? message.bodyText) || undefined,
        [activityField]: record.id,
        owner_id: intent.userId,
      },
      actor,
    );
  }

  await writeAuditEntry(client, {
    recordType: 'connected_account',
    recordId: intent.connectedAccountId,
    recordName: accountEmailAddress,
    eventType: 'email_sent',
    fieldName: 'email_message',
    newValue: JSON.stringify({
      message_id: message.id,
      recipient_count: message.toAddresses.length + message.ccAddresses.length,
      to: message.toAddresses,
      cc: message.ccAddresses,
      linked_records: links.rows.map((link) => `${link.record_type}:${link.record_id}`),
    }),
    changedById: actor.id,
    changedByName: actor.name,
  });

  await client.query(
    `UPDATE email_send_intents
        SET status = 'filed', filed_at = now(), updated_at = now(), email_message_id = $2,
            provider_message_id = COALESCE(provider_message_id, $3),
            activity_notes = NULL, to_addresses = '{}', cc_addresses = '{}'
      WHERE id = $1`,
    [intent.id, message.id, message.providerMessageId],
  );

  return activityId;
}

/**
 * Files each locked intent from the Sent copy in the page just stored.
 *
 * The copy is found in the page itself, not by a table search: the page is what matched
 * the intent, and a search by Message-ID alone could pick another copy of the same mail.
 * The provider id wins over the Message-ID, which a provider may have rewritten.
 *
 * Each intent is filed under its own savepoint, so one that cannot be filed is logged and
 * left for the sweep rather than failing the page.
 *
 * @returns the activities created, for the caller to announce after its commit.
 */
export async function fileReconciledIntents(
  client: PoolClient,
  accountId: string,
  intents: readonly SendIntent[],
  page: readonly NormalizedMessage[],
): Promise<string[]> {
  if (intents.length === 0) return [];

  const copies = new Map<string, NormalizedMessage>();
  for (const intent of intents) {
    const copy =
      page.find((message) => message.providerMessageId === intent.providerMessageId) ??
      page.find((message) => message.rfcMessageId === intent.rfcMessageId);
    if (copy) copies.set(intent.id, copy);
  }

  const stored = await client.query<{
    id: string;
    provider_message_id: string;
    subject: string | null;
    message_body_text: string | null;
    to_addresses: string[];
    cc_addresses: string[];
    is_private: boolean;
    email_address: string;
  }>(
    `SELECT m.id, m.provider_message_id, m.subject, m.message_body_text, m.to_addresses,
            m.cc_addresses, m.is_private, ca.email_address
       FROM email_messages m
       JOIN connected_accounts ca ON ca.id = m.connected_account_id
      WHERE m.connected_account_id = $1 AND m.provider_message_id = ANY($2)`,
    [accountId, [...copies.values()].map((copy) => copy.providerMessageId)],
  );
  const rowsByProviderId = new Map(stored.rows.map((row) => [row.provider_message_id, row]));

  const activityIds: string[] = [];
  for (const intent of intents) {
    const copy = copies.get(intent.id);
    const row = copy ? rowsByProviderId.get(copy.providerMessageId) : undefined;
    if (!row) {
      // The page that locked this intent was stored in this transaction, so its copy is
      // here; reaching this means the two lookups disagree, which must not pass silently.
      logger.error({ intentId: intent.id }, 'emailSendIntentService: matched copy not stored');
      continue;
    }
    // One send's bookkeeping must not roll back the page it rides on: a failure here would
    // otherwise discard every message and the cursor, and stall the mailbox on every retry.
    await client.query('SAVEPOINT intent_filing');
    try {
      const activityId = await fileSentMessage(
        client,
        intent,
        {
          id: row.id,
          providerMessageId: row.provider_message_id,
          subject: row.subject,
          bodyText: row.message_body_text,
          toAddresses: row.to_addresses,
          ccAddresses: row.cc_addresses,
          isPrivate: row.is_private,
        },
        row.email_address,
      );
      await client.query('RELEASE SAVEPOINT intent_filing');
      if (activityId) activityIds.push(activityId);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT intent_filing');
      // Left unfiled: the sweep reports it unconfirmed, and its audit records the send.
      logger.error({ err, intentId: intent.id }, 'emailSendIntentService: could not file');
    }
  }
  return activityIds;
}
