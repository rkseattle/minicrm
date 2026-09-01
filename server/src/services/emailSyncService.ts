/**
 * Email sync engine — one tick over every mailbox that is due.
 *
 * The engine owns the database, the cursor, and the retry decision; a provider owns only
 * "given a cursor, hand me the next messages and a new cursor". That split is what lets
 * Gmail and Microsoft Graph arrive as implementations rather than as branches threaded
 * through this file.
 *
 * Every account is synced inside its own try/catch. One mailbox with a dead server, bad
 * credentials, or a provider bug must not end the tick for everyone else — a shared
 * failure path is how one broken account silently stops an org's email sync.
 *
 * Failures back off exponentially rather than retrying every tick, because the common
 * cause is a server that is down or throttling, and a tight retry loop against it is both
 * useless and hostile. Past a ceiling the mailbox stops being claimed at all and waits for
 * the user to act, which is the one state worth auditing: everything below it is a remote
 * server's transient answer, not a change anyone made.
 */

import type { PoolClient } from 'pg';

import pool from '../db.js';
import logger from '../logger.js';
import { captureException } from '../sentry.js';

import type { AuditActor } from './auditService.js';
import { writeAuditEntry } from './auditService.js';
import {
  claimAccountsDueForSync,
  getAccountAuthForSync,
  MAX_SYNC_FAILURES,
  SYNC_CLAIM_LEASE_MS,
  type ClaimedSyncAccount,
} from './connectedAccountService.js';
import {
  completeEmailSyncJob,
  createEmailSyncJob,
  failEmailSyncJob,
  getActiveEmailSyncJob,
  updateEmailSyncJobProgress,
} from './emailSyncJobService.js';
import { isFeatureEnabled, isFlagEnabledForUser } from './featureFlagService.js';
import { createImapProvider } from './mail/imapProvider.js';
import type { MailProvider, NormalizedMessage, ProviderPage } from './mail/mailProvider.js';

/** The org-wide kill switch. Off means no mailbox syncs, whatever a user's own flag says. */
const EMAIL_SYNC_FLAG = 'email_sync';

/** Mailboxes claimed per tick. Bounds how long one tick can run. */
const MAX_ACCOUNTS_PER_TICK = 25;

/**
 * How far back a never-synced mailbox reads.
 *
 * A module constant until the admin setting that owns this by name ships; the value is
 * the same 90 days that setting will default to.
 */
const BACKFILL_WINDOW_DAYS = 90;

/**
 * Pages one backfill may consume in a single tick.
 *
 * Without this a large mailbox's first backfill runs until it finishes, which outlasts the
 * sync interval — and `skipWhileRunning` then suppresses every other account's tick until
 * it does. The bound trades a slower first backfill for one mailbox never starving the
 * rest; the job's stored progress is what makes stopping mid-history safe.
 */
const MAX_BACKFILL_PAGES_PER_TICK = 5;

/** First retry delay. Each further failure doubles it, up to the cap. */
const BACKOFF_BASE_MS = 5 * 60 * 1000;

/** Ceiling on the doubling, so a long outage still retries daily rather than never. */
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * Jitter applied to each delay, as a fraction.
 *
 * Without it every mailbox that failed during one outage retries in the same instant when
 * the server returns, which is the thundering herd that keeps it down.
 */
const BACKOFF_JITTER = 0.2;

const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'System',
};

/** Columns in the message insert, for the bind-parameter arithmetic below. */
const MESSAGE_INSERT_COLUMN_COUNT = 10;

/**
 * Rows per INSERT.
 *
 * PostgreSQL's wire protocol indexes bind parameters with a 16-bit integer, so a single
 * statement cannot carry more than 65535 of them. A large first backfill can exceed that,
 * and the failure is a runtime error rather than anything a type catches.
 */
const MAX_MESSAGES_PER_INSERT = Math.floor(65535 / MESSAGE_INSERT_COLUMN_COUNT);

/** What one account's sync did, for the caller's log line. */
export interface SyncOutcome {
  accountId: string;
  messagesStored: number;
  hasMore: boolean;
  cursorInvalid: boolean;
}

/**
 * Collapses messages sharing a provider id within one batch.
 *
 * A single IMAP fetch can legitimately return the same id twice — a message copied
 * between mailboxes, or a server repeating an untagged response. `ON CONFLICT DO UPDATE`
 * refuses a statement that would touch one conflict-target row twice ("cannot affect row
 * a second time"), so the duplicate has to go before the insert rather than being left
 * for the constraint.
 */
function collapseDuplicateIds(messages: readonly NormalizedMessage[]): NormalizedMessage[] {
  const byId = new Map<string, NormalizedMessage>();
  for (const message of messages) {
    // Last write wins: a later copy of the same id is the fresher read.
    byId.set(message.providerMessageId, message);
  }
  return Array.from(byId.values());
}

/**
 * Stores one page of messages.
 *
 * `DO UPDATE` rather than `DO NOTHING` because a re-sync of an unchanged message must be
 * a no-op in effect but must not lose an edit the provider made — a subject corrected, a
 * date resolved. `is_private` is deliberately not in the update list: it is a user's own
 * decision about a message and nothing upstream may overwrite it.
 *
 * @returns the number of rows this call CREATED. Updates are excluded so a job's
 *   progress counts messages rather than write operations — a re-read of the same page
 *   would otherwise inflate it without a single new message arriving.
 */
async function storeMessages(
  client: PoolClient,
  accountId: string,
  messages: readonly NormalizedMessage[],
): Promise<number> {
  const collapsed = collapseDuplicateIds(messages);
  let stored = 0;

  for (let offset = 0; offset < collapsed.length; offset += MAX_MESSAGES_PER_INSERT) {
    const chunk = collapsed.slice(offset, offset + MAX_MESSAGES_PER_INSERT);
    const values: unknown[] = [];
    const tuples = chunk.map((message, index) => {
      const base = index * MESSAGE_INSERT_COLUMN_COUNT;
      values.push(
        accountId,
        message.providerMessageId,
        message.threadId,
        message.direction,
        message.fromAddress,
        message.toAddresses,
        message.ccAddresses,
        message.subject,
        message.hasAttachments,
        message.sentAt,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
    });

    const result = await client.query<{ inserted: boolean }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          to_addresses, cc_addresses, subject, has_attachments, sent_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (connected_account_id, provider_message_id) DO UPDATE
         SET thread_id = EXCLUDED.thread_id,
             direction = EXCLUDED.direction,
             from_address = EXCLUDED.from_address,
             to_addresses = EXCLUDED.to_addresses,
             cc_addresses = EXCLUDED.cc_addresses,
             subject = EXCLUDED.subject,
             has_attachments = EXCLUDED.has_attachments,
             sent_at = EXCLUDED.sent_at
       RETURNING (xmax = 0) AS inserted`,
      values,
    );
    // rowCount counts updated rows too, so it reports a re-sync of unchanged mail as
    // newly stored. xmax is zero only on a row this statement inserted.
    stored += result.rows.filter((row) => row.inserted).length;
  }

  return stored;
}

/** Builds the provider for one account. IMAP is the only implementation today. */
function providerFor(account: ClaimedSyncAccount): MailProvider {
  if (account.provider !== 'imap') {
    throw new Error(`emailSyncService: no provider implementation for ${account.provider}`);
  }
  return createImapProvider(account.emailAddress);
}

/** The delay before the next attempt, doubling per failure with jitter and a ceiling. */
export function backoffDelayMs(failureCount: number): number {
  const doubled = BACKOFF_BASE_MS * 2 ** Math.max(0, failureCount - 1);
  const capped = Math.min(doubled, BACKOFF_MAX_MS);
  const jitter = capped * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.max(BACKOFF_BASE_MS, Math.round(capped + jitter));
}

/** Persists one page's messages and the cursor it produced, atomically. */
async function commitPage(accountId: string, page: ProviderPage): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const stored =
      page.messages.length > 0 ? await storeMessages(client, accountId, page.messages) : 0;

    // The lease is extended, not cleared. claimAccountsDueForSync pushes
    // sync_next_attempt_at forward to reserve the mailbox, and commitPage runs once per
    // page — clearing it here would release the reservation mid-backfill and let a second
    // instance claim the same mailbox while this one is still reading it. The failure
    // count IS cleared: that is backoff state, and this page proves the mailbox works.
    await client.query(
      `UPDATE connected_accounts
          SET sync_cursor = $2,
              last_sync_at = NOW(),
              status = 'active',
              status_detail = NULL,
              sync_failure_count = 0,
              sync_next_attempt_at = NOW() + ($3 || ' milliseconds')::interval
        WHERE id = $1`,
      [accountId, page.cursor, SYNC_CLAIM_LEASE_MS],
    );

    await client.query('COMMIT');
    return stored;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reads a mailbox that has no usable cursor, as a tracked, resumable job.
 *
 * A mailbox with no cursor — never synced, or one whose cursor the provider just
 * invalidated — has a whole window of history to read rather than one page. That is
 * visible work with a duration a user may want to see, so it is an email_sync_jobs row
 * rather than a silent loop.
 *
 * The job is adopted rather than recreated when one is already open, and the page budget
 * is what makes stopping mid-history safe: the cursor is persisted per page, so the next
 * tick resumes exactly where this one stopped.
 */
async function backfillAccount(
  account: ClaimedSyncAccount,
  auth: Parameters<MailProvider['fetchSince']>[0],
  provider: MailProvider,
  since: Date,
): Promise<SyncOutcome> {
  const job = await createEmailSyncJob(account.id);
  let stored = job.messages_synced;
  // Resumes from where the last tick's final page left the cursor. Starting at null
  // instead would re-read the window from the top every tick, so a mailbox larger than
  // one tick's budget could never finish.
  let cursor: string | null = account.syncCursor;
  let hasMore = false;
  let cursorInvalid = false;

  try {
    for (let read = 0; read < MAX_BACKFILL_PAGES_PER_TICK; read += 1) {
      const page = await provider.fetchSince(auth, cursor, since);
      stored += await commitPage(account.id, page);
      cursor = page.cursor;
      hasMore = page.hasMore;
      cursorInvalid = page.cursorInvalid;

      await updateEmailSyncJobProgress(job.id, stored);

      // An invalidated cursor mid-backfill means the mailbox was renumbered under us.
      // Stopping leaves the job running and the cursor cleared, so the next tick starts
      // the window again rather than reading from a position that no longer means
      // anything.
      if (!page.hasMore || page.cursorInvalid) break;
    }

    if (!hasMore && !cursorInvalid) {
      await completeEmailSyncJob(job.id, stored);
    }
  } catch (err) {
    await failEmailSyncJob(job.id, err instanceof Error ? err.message : 'Backfill failed');
    throw err;
  }

  return { accountId: account.id, messagesStored: stored, hasMore, cursorInvalid };
}

/**
 * Syncs one mailbox and advances its cursor.
 *
 * The messages, the cursor, and `last_sync_at` move in one transaction: a cursor advanced
 * without its messages stored would skip that mail permanently, which is the one failure
 * this engine must never produce.
 *
 * A mailbox with no cursor takes the backfill path instead — bounded by the window and by
 * a page budget, and tracked as a job. An invalidated cursor is the same case: the stored
 * position no longer names anything, so the next tick re-reads the window rather than
 * resyncing everything.
 *
 * @param provider - Injected so tests can drive a fake without a live IMAP server.
 */
export async function syncOneAccount(
  account: ClaimedSyncAccount,
  provider?: MailProvider,
): Promise<SyncOutcome> {
  const auth = await getAccountAuthForSync(account.id);
  if (!auth) {
    throw new Error('emailSyncService: no usable credentials for this account');
  }

  const resolved = provider ?? providerFor(account);
  const since = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // An unfinished job is what says a backfill is in progress — not the cursor, which
  // every committed page advances. Routing on the cursor alone sent tick 2 down the
  // incremental path, so a mailbox bigger than one tick's page budget was truncated and
  // its job left running forever; migration 173's partial unique index then blocks any
  // new job for that account, so even a later cursor invalidation could not recover.
  if (account.syncCursor === null || (await getActiveEmailSyncJob(account.id)) !== null) {
    return backfillAccount(account, auth, resolved, since);
  }

  const page = await resolved.fetchSince(auth, account.syncCursor, since);
  const stored = await commitPage(account.id, page);

  return {
    accountId: account.id,
    messagesStored: stored,
    hasMore: page.hasMore,
    cursorInvalid: page.cursorInvalid,
  };
}

/**
 * Records a failed sync and schedules the retry.
 *
 * The status write is unaudited below the ceiling, following updateAccountStatus: it
 * records what a remote server answered, not a change a person made. Crossing the ceiling
 * is audited, following markAuthExpired — the mailbox stops syncing until someone acts,
 * and that is a lifecycle event a user must be able to account for.
 */
async function recordSyncFailure(account: ClaimedSyncAccount, err: unknown): Promise<void> {
  const failureCount = account.syncFailureCount + 1;
  const retired = failureCount >= MAX_SYNC_FAILURES;
  const detail = err instanceof Error ? err.message : 'Sync failed';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // A retired mailbox gets no next attempt at all: it waits for a connection test,
    // which is what clears the counter and puts it back in the schedule.
    await client.query(
      `UPDATE connected_accounts
          SET status = 'error',
              status_detail = $2,
              sync_failure_count = $3,
              sync_next_attempt_at = $4
        WHERE id = $1`,
      [
        account.id,
        detail.slice(0, 500),
        failureCount,
        retired ? null : new Date(Date.now() + backoffDelayMs(failureCount)),
      ],
    );

    if (retired) {
      await writeAuditEntry(client, {
        recordType: 'connected_account',
        recordId: account.id,
        recordName: account.emailAddress,
        eventType: 'connected_account_sync_suspended',
        oldValue: String(failureCount),
        changedById: SYSTEM_ACTOR.id,
        changedByName: SYSTEM_ACTOR.name,
      });
    }

    await client.query('COMMIT');
  } catch (writeErr) {
    await client.query('ROLLBACK');
    // The sync already failed; losing the bookkeeping too must not end the tick for the
    // accounts after this one.
    logger.error(
      { err: writeErr, accountId: account.id },
      'emailSyncService: could not record a sync failure',
    );
  } finally {
    client.release();
  }
}

/**
 * Syncs every mailbox that is due.
 *
 * @param provider - Injected for tests; production resolves one per account's provider.
 * @returns one outcome per account that synced successfully.
 */
export async function syncDueAccounts(provider?: MailProvider): Promise<SyncOutcome[]> {
  if (!(await isFeatureEnabled(EMAIL_SYNC_FLAG))) return [];

  const claimed = await claimAccountsDueForSync(MAX_ACCOUNTS_PER_TICK);
  const outcomes: SyncOutcome[] = [];

  for (const account of claimed) {
    // Checked per account rather than once, because the flag can be rolled out to a
    // subset of users and the claim query cannot know that.
    if (!(await isFlagEnabledForUser(EMAIL_SYNC_FLAG, account.userId, account.userRole))) {
      continue;
    }

    try {
      outcomes.push(await syncOneAccount(account, provider));
    } catch (err) {
      // Per account, so one dead server cannot end the tick for every other mailbox.
      logger.warn({ err, accountId: account.id }, 'emailSyncService: account sync failed');
      captureException(err);
      await recordSyncFailure(account, err);
    }
  }

  return outcomes;
}
