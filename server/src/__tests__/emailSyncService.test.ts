/**
 * Integration tests for the email sync engine.
 *
 * Against the real test database with an injected fake provider: every rule worth testing
 * here — cursor advance, idempotent re-sync, per-account failure isolation, backoff — is
 * decided by what lands in Postgres, so a mocked database would test the mock.
 */

import 'dotenv/config';

import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createImapAccount } from '../services/connectedAccountService.js';
import type { ClaimedSyncAccount } from '../services/connectedAccountService.js';
import type {
  MailProvider,
  NormalizedMessage,
  ProviderPage,
} from '../services/mail/mailProvider.js';
import { backoffDelayMs, syncDueAccounts, syncOneAccount } from '../services/emailSyncService.js';
import { getActiveEmailSyncJob } from '../services/emailSyncJobService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

import { clearAuditLogFor } from './testUtils.js';

const FILE_PREFIX = 'emailsync';
const ACTOR = { id: '', name: 'Email Sync Rep' };

function imapInput(suffix: string) {
  return {
    email_address: `${FILE_PREFIX}-${suffix}@example.com`,
    host: 'imap.example.com',
    port: 993,
    username: `${FILE_PREFIX}-${suffix}@example.com`,
    password: 'a-very-secret-password',
    secure: true,
  };
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    providerMessageId: 'INBOX:1',
    threadId: 'thread-1',
    direction: 'inbound',
    fromAddress: 'someone@example.net',
    toAddresses: [`${FILE_PREFIX}-a@example.com`],
    ccAddresses: [],
    subject: 'Hello',
    hasAttachments: false,
    sentAt: new Date('2026-08-01T12:00:00Z'),
    ...overrides,
  };
}

/** A provider that hands back whatever the test queued, or throws. */
function fakeProvider(pages: (ProviderPage | Error)[]): MailProvider & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async fetchSince(): Promise<ProviderPage> {
      const next = pages[Math.min(state.calls, pages.length - 1)];
      state.calls += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  } as MailProvider & { calls: number };
}

function page(overrides: Partial<ProviderPage> = {}): ProviderPage {
  return {
    messages: [],
    cursor: '{"INBOX":{"uidValidity":"900","uidNext":2}}',
    cursorInvalid: false,
    hasMore: false,
    ...overrides,
  };
}

async function claimedFor(accountId: string): Promise<ClaimedSyncAccount> {
  const row = await pool.query<{
    id: string;
    user_id: string;
    provider: 'imap';
    email_address: string;
    sync_cursor: string | null;
    sync_failure_count: number;
  }>(
    `SELECT id, user_id, provider, email_address, sync_cursor, sync_failure_count
       FROM connected_accounts WHERE id = $1`,
    [accountId],
  );
  const r = row.rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    userRole: 'rep',
    provider: r.provider,
    emailAddress: r.email_address,
    syncCursor: r.sync_cursor,
    syncFailureCount: r.sync_failure_count,
  };
}

async function storedMessages(
  accountId: string,
): Promise<{ provider_message_id: string; subject: string | null; thread_id: string }[]> {
  const result = await pool.query<{
    provider_message_id: string;
    subject: string | null;
    thread_id: string;
  }>(
    `SELECT provider_message_id, subject, thread_id FROM email_messages
      WHERE connected_account_id = $1 ORDER BY provider_message_id`,
    [accountId],
  );
  return result.rows;
}

async function deleteFixtureUsers(): Promise<void> {
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtureUsers();
  const rep = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Email Sync Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  ACTOR.id = rep.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM connected_accounts WHERE user_id = $1', [ACTOR.id]);
  await clearAuditLogFor(ACTOR.id);
  // feature_flags is one global row with no per-file isolation, and other suites toggle
  // this same key. Asserting on the ambient value makes these tests pass or fail on which
  // file ran alongside them, so every run states what it needs.
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await deleteFixtureUsers();
  await pool.end();
});

describe('syncOneAccount', () => {
  it('stores a page and advances the cursor in one transaction', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    const provider = fakeProvider([page({ messages: [message()] })]);

    const outcome = await syncOneAccount(await claimedFor(account.id), provider);

    expect(outcome.messagesStored).toBe(1);
    expect(await storedMessages(account.id)).toHaveLength(1);

    const row = await pool.query<{ sync_cursor: string | null; last_sync_at: Date | null }>(
      'SELECT sync_cursor, last_sync_at FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_cursor).toBe(page().cursor);
    expect(row.rows[0].last_sync_at).not.toBeNull();
  });

  it('re-syncing the same page stores no duplicate row', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    const provider = fakeProvider([page({ messages: [message()] })]);

    await syncOneAccount(await claimedFor(account.id), provider);
    await syncOneAccount(await claimedFor(account.id), provider);

    expect(await storedMessages(account.id)).toHaveLength(1);
  });

  it('updates a message the provider revised rather than ignoring it', async () => {
    // DO NOTHING would leave a corrected subject or a resolved date permanently stale.
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ messages: [message({ subject: 'Original' })] })]),
    );

    await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ messages: [message({ subject: 'Corrected' })] })]),
    );

    const rows = await storedMessages(account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('Corrected');
  });

  it('collapses a provider id repeated within one page', async () => {
    // ON CONFLICT DO UPDATE refuses a statement touching one conflict row twice, so the
    // duplicate has to go before the insert rather than being left to the constraint.
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    const provider = fakeProvider([
      page({
        messages: [
          message({ providerMessageId: 'INBOX:1', subject: 'First copy' }),
          message({ providerMessageId: 'INBOX:1', subject: 'Second copy' }),
        ],
      }),
    ]);

    const outcome = await syncOneAccount(await claimedFor(account.id), provider);

    expect(outcome.messagesStored).toBe(1);
    const rows = await storedMessages(account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('Second copy');
  });

  it('stores a batch larger than one INSERT can carry', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    const many = Array.from({ length: 7000 }, (_, i) =>
      message({ providerMessageId: `INBOX:${String(i)}`, threadId: `thread-${String(i)}` }),
    );

    const outcome = await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ messages: many })]),
    );

    expect(outcome.messagesStored).toBe(7000);
    expect(await storedMessages(account.id)).toHaveLength(7000);
  });

  it('clears the cursor when the provider reports it invalid, for a bounded re-backfill', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await syncOneAccount(await claimedFor(account.id), fakeProvider([page()]));

    const outcome = await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ cursor: null, cursorInvalid: true, messages: [] })]),
    );

    expect(outcome.cursorInvalid).toBe(true);
    const row = await pool.query<{ sync_cursor: string | null }>(
      'SELECT sync_cursor FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_cursor).toBeNull();
  });

  it('stores nothing when the provider throws, leaving the cursor where it was', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await syncOneAccount(await claimedFor(account.id), fakeProvider([page()]));
    const before = page().cursor;

    await expect(
      syncOneAccount(await claimedFor(account.id), fakeProvider([new Error('server gone')])),
    ).rejects.toThrow('server gone');

    const row = await pool.query<{ sync_cursor: string | null }>(
      'SELECT sync_cursor FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_cursor).toBe(before);
    expect(await storedMessages(account.id)).toHaveLength(0);
  });

  it('clears a previous failure when a sync succeeds', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await pool.query(
      `UPDATE connected_accounts SET status = 'error', sync_failure_count = 3 WHERE id = $1`,
      [account.id],
    );

    await syncOneAccount(await claimedFor(account.id), fakeProvider([page()]));

    const row = await pool.query<{ status: string; sync_failure_count: number }>(
      'SELECT status, sync_failure_count FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].status).toBe('active');
    expect(row.rows[0].sync_failure_count).toBe(0);
  });
});

describe('backoff', () => {
  it('grows with each consecutive failure', async () => {
    // Sampled, because the delay carries jitter by design.
    const first = Math.min(...Array.from({ length: 50 }, () => backoffDelayMs(1)));
    const fourth = Math.min(...Array.from({ length: 50 }, () => backoffDelayMs(4)));

    expect(fourth).toBeGreaterThan(first);
  });

  it('is capped, so a long outage still retries rather than never', async () => {
    const huge = Math.max(...Array.from({ length: 50 }, () => backoffDelayMs(40)));

    expect(huge).toBeLessThanOrEqual(24 * 60 * 60 * 1000 * 1.25);
  });

  it('is jittered, so mailboxes that failed together do not retry together', async () => {
    const samples = new Set(Array.from({ length: 40 }, () => backoffDelayMs(3)));

    expect(samples.size).toBeGreaterThan(1);
  });
});

describe('syncDueAccounts', () => {
  it('records a failure and schedules a retry rather than throwing', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);

    await syncDueAccounts(fakeProvider([new Error('imap unreachable')]));

    const row = await pool.query<{
      status: string;
      status_detail: string | null;
      sync_failure_count: number;
      sync_next_attempt_at: Date | null;
    }>(
      `SELECT status, status_detail, sync_failure_count, sync_next_attempt_at
         FROM connected_accounts WHERE id = $1`,
      [account.id],
    );
    expect(row.rows[0].status).toBe('error');
    expect(row.rows[0].status_detail).toContain('imap unreachable');
    expect(row.rows[0].sync_failure_count).toBe(1);
    expect(row.rows[0].sync_next_attempt_at).not.toBeNull();
  });

  it('does not let one failing mailbox stop the others', async () => {
    // The whole point of per-account isolation: a shared failure path is how one dead
    // server silently stops an org's email sync.
    const failing = await createImapAccount(ACTOR.id, imapInput('fail'), ACTOR);
    const healthy = await createImapAccount(ACTOR.id, imapInput('ok'), ACTOR);

    const provider: MailProvider = {
      async fetchSince(auth): Promise<ProviderPage> {
        if (auth.kind === 'imap' && auth.username.includes('fail')) {
          throw new Error('imap unreachable');
        }
        return page({ messages: [message()] });
      },
    };

    await syncDueAccounts(provider);

    expect(await storedMessages(healthy.id)).toHaveLength(1);
    const failedRow = await pool.query<{ status: string }>(
      'SELECT status FROM connected_accounts WHERE id = $1',
      [failing.id],
    );
    expect(failedRow.rows[0].status).toBe('error');
  });

  it('stops retrying past the failure ceiling and audits the suspension', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await pool.query('UPDATE connected_accounts SET sync_failure_count = 7 WHERE id = $1', [
      account.id,
    ]);

    await syncDueAccounts(fakeProvider([new Error('still down')]));

    const row = await pool.query<{ sync_failure_count: number; sync_next_attempt_at: Date | null }>(
      'SELECT sync_failure_count, sync_next_attempt_at FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_failure_count).toBe(8);
    // No next attempt: it waits for a connection test, which clears the counter.
    expect(row.rows[0].sync_next_attempt_at).toBeNull();

    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log WHERE record_id = $1 AND event_type = $2`,
      [account.id, 'connected_account_sync_suspended'],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('does not audit a failure below the ceiling, which is a remote answer not a change', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);

    await syncDueAccounts(fakeProvider([new Error('transient')]));

    const audit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log WHERE record_id = $1 AND event_type = $2`,
      [account.id, 'connected_account_sync_suspended'],
    );
    expect(audit.rows).toHaveLength(0);
  });

  it('the org kill switch beats a per-user force-enable', async () => {
    // Only the org-wide gate can stop this: a force_enabled override wins every
    // downstream targeting rule, so without the kill switch the sync would proceed.
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    await pool.query(
      `INSERT INTO feature_flag_user_overrides (flag_key, user_id, override)
       VALUES ('email_sync', $1, 'force_enabled')
       ON CONFLICT (flag_key, user_id) DO UPDATE SET override = 'force_enabled'`,
      [ACTOR.id],
    );
    invalidateFeatureFlagCache();

    try {
      const outcomes = await syncDueAccounts(fakeProvider([page({ messages: [message()] })]));

      expect(outcomes).toHaveLength(0);
      expect(await storedMessages(account.id)).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM feature_flag_user_overrides WHERE user_id = $1`, [ACTOR.id]);
      await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
      invalidateFeatureFlagCache();
    }
  });

  it('skips an account whose owner does not have the flag', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await pool.query(
      `INSERT INTO feature_flag_user_overrides (flag_key, user_id, override)
       VALUES ('email_sync', $1, 'force_disabled')
       ON CONFLICT (flag_key, user_id) DO UPDATE SET override = 'force_disabled'`,
      [ACTOR.id],
    );
    invalidateFeatureFlagCache();

    try {
      const outcomes = await syncDueAccounts(fakeProvider([page({ messages: [message()] })]));

      expect(outcomes).toHaveLength(0);
      expect(await storedMessages(account.id)).toHaveLength(0);
    } finally {
      await pool.query(`DELETE FROM feature_flag_user_overrides WHERE user_id = $1`, [ACTOR.id]);
      invalidateFeatureFlagCache();
    }
  });

  it('syncs nothing when the org-wide flag is off', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    // The service reads a 60s cache; a direct write is invisible without this.
    invalidateFeatureFlagCache();

    try {
      const outcomes = await syncDueAccounts(fakeProvider([page({ messages: [message()] })]));

      expect(outcomes).toHaveLength(0);
      expect(await storedMessages(account.id)).toHaveLength(0);
    } finally {
      await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
      invalidateFeatureFlagCache();
    }
  });
});

describe('bounded backfill', () => {
  /** Reads whatever job row exists for an account, finished or not. */
  async function latestJob(accountId: string): Promise<{
    status: string;
    messages_synced: number;
    error: string | null;
  } | null> {
    const result = await pool.query<{
      status: string;
      messages_synced: number;
      error: string | null;
    }>(
      `SELECT status, messages_synced, error FROM email_sync_jobs
        WHERE connected_account_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
    return result.rows[0] ?? null;
  }

  it('runs a never-synced mailbox as a tracked job and completes it', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);

    const outcome = await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ messages: [message()] })]),
    );

    expect(outcome.messagesStored).toBe(1);
    const job = await latestJob(account.id);
    expect(job?.status).toBe('complete');
    expect(job?.messages_synced).toBe(1);
  });

  it('stops at the per-tick page budget and leaves the job running', async () => {
    // Without the budget a large mailbox's first backfill outlasts the sync interval, and
    // skipWhileRunning then suppresses every other account's tick until it finishes.
    const endless = {
      calls: 0,
      async fetchSince(): Promise<ProviderPage> {
        this.calls += 1;
        return page({
          messages: [message({ providerMessageId: `INBOX:${String(this.calls)}` })],
          hasMore: true,
        });
      },
    };
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);

    const outcome = await syncOneAccount(await claimedFor(account.id), endless as MailProvider);

    expect(endless.calls).toBe(5);
    expect(outcome.hasMore).toBe(true);
    const job = await latestJob(account.id);
    expect(job?.status).toBe('running');
  });

  it('resumes the same job on the next tick rather than opening a second', async () => {
    // No cursor is reset between the ticks: production has no such step, and resetting it
    // here made this test pass whether or not the resume path existed at all.
    // The fake reads the cursor it is handed and numbers from there, so a tick that
    // restarted from null would re-deliver INBOX:1 instead of advancing — which is what
    // makes the resumed position load-bearing rather than incidental.
    let calls = 0;
    const cursorsSeen: (string | null)[] = [];
    const endless: MailProvider = {
      async fetchSince(_auth, cursor): Promise<ProviderPage> {
        calls += 1;
        cursorsSeen.push(cursor);
        const from = cursor === null ? 1 : Number(JSON.parse(cursor).INBOX.uidNext);
        return page({
          messages: [message({ providerMessageId: `INBOX:${String(from)}` })],
          cursor: `{"INBOX":{"uidValidity":"900","uidNext":${String(from + 1)}}}`,
          hasMore: true,
        });
      },
    };
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);

    await syncOneAccount(await claimedFor(account.id), endless);
    const firstJob = await getActiveEmailSyncJob(account.id);
    const callsAfterFirstTick = calls;

    await syncOneAccount(await claimedFor(account.id), endless);
    const secondJob = await getActiveEmailSyncJob(account.id);

    // The second tick must spend its whole page budget too. Routing on the cursor rather
    // than on the open job sent it down the single-page incremental path, so a mailbox
    // larger than one tick's budget was truncated and never finished.
    expect(calls - callsAfterFirstTick).toBe(callsAfterFirstTick);
    expect(secondJob?.id).toBe(firstJob?.id);
    // Every page delivered a distinct message, so progress equals the pages read. A tick
    // that restarted from null would re-deliver what tick 1 already stored and stall here.
    expect(secondJob?.messages_synced).toBe(calls);
    // The second tick's first fetch must resume from tick 1's final cursor, not from null.
    expect(cursorsSeen[callsAfterFirstTick]).not.toBeNull();
    const count = await pool.query<{ n: string }>(
      'SELECT count(*)::int AS n FROM email_sync_jobs WHERE connected_account_id = $1',
      [account.id],
    );
    expect(Number(count.rows[0].n)).toBe(1);
  });

  it('counts messages created, not write operations', async () => {
    // rowCount on an upsert counts updates too, so a re-read of the same page would
    // inflate a job's progress without a single new message arriving.
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    const repeating: MailProvider = {
      async fetchSince(): Promise<ProviderPage> {
        return page({ messages: [message(), message({ providerMessageId: 'INBOX:2' })] });
      },
    };

    const first = await syncOneAccount(await claimedFor(account.id), repeating);
    const second = await syncOneAccount(await claimedFor(account.id), repeating);

    expect(first.messagesStored).toBe(2);
    expect(second.messagesStored).toBe(0);
  });

  it('keeps the claim lease while a backfill is still running', async () => {
    // commitPage runs per page. Clearing the lease there would release the mailbox
    // mid-backfill and let a second instance claim it while this one is still reading.
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    const endless: MailProvider = {
      async fetchSince(): Promise<ProviderPage> {
        return page({ messages: [message()], hasMore: true });
      },
    };

    await syncOneAccount(await claimedFor(account.id), endless);

    const row = await pool.query<{ sync_next_attempt_at: Date | null }>(
      'SELECT sync_next_attempt_at FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].sync_next_attempt_at).not.toBeNull();
    expect(row.rows[0].sync_next_attempt_at!.getTime()).toBeGreaterThan(Date.now());
  });

  it('takes the backfill path when the provider invalidates the cursor', async () => {
    // AC30: recovery is a bounded re-read of the window, not a full resync.
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await syncOneAccount(await claimedFor(account.id), fakeProvider([page()]));
    await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ cursor: null, cursorInvalid: true })]),
    );

    // The cursor is now null, so the next tick backfills rather than syncing incrementally.
    const outcome = await syncOneAccount(
      await claimedFor(account.id),
      fakeProvider([page({ messages: [message()] })]),
    );

    expect(outcome.messagesStored).toBe(1);
    expect(await latestJob(account.id)).not.toBeNull();
  });

  it('bounds the backfill by the configured window rather than reading everything', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    let seen: Date | null = null;
    const recording: MailProvider = {
      async fetchSince(_auth, _cursor, since): Promise<ProviderPage> {
        seen = since;
        return page();
      },
    };

    await syncOneAccount(await claimedFor(account.id), recording);

    const days = (Date.now() - (seen as unknown as Date).getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(90);
  });

  it('fails the job when the provider throws mid-backfill', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);

    await expect(
      syncOneAccount(await claimedFor(account.id), fakeProvider([new Error('server gone')])),
    ).rejects.toThrow('server gone');

    const job = await latestJob(account.id);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('server gone');
  });

  it('does not open a job for an incremental sync', async () => {
    const account = await createImapAccount(ACTOR.id, imapInput('a'), ACTOR);
    await syncOneAccount(await claimedFor(account.id), fakeProvider([page()]));
    await pool.query('DELETE FROM email_sync_jobs WHERE connected_account_id = $1', [account.id]);

    await syncOneAccount(await claimedFor(account.id), fakeProvider([page()]));

    expect(await latestJob(account.id)).toBeNull();
  });
});
