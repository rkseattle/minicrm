/**
 * Integration tests for syncAccountNow, the run-now path behind the test-only sync route.
 *
 * Against the real test database with an injected fake provider, like emailSyncService's
 * own suite: ownership, the lease the claim writes, and failure recording all live in
 * Postgres.
 */

import 'dotenv/config';

import pg from 'pg';
import pool from '../db.js';
import { SYNC_FAILED_DETAIL } from '@minicrm/shared/schemas/connectedAccountSchema.js';
import { createUser } from '../services/userService.js';
import {
  claimAccountByIdForSync,
  createImapAccount,
  MAX_SYNC_FAILURES,
} from '../services/connectedAccountService.js';
import type {
  MailProvider,
  NormalizedMessage,
  ProviderPage,
} from '../services/mail/mailProvider.js';
import {
  SCHEDULER_RUNNING,
  SYNC_IN_PROGRESS,
  syncAccountNow,
} from '../services/emailSyncService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';

import { parkFromScheduler, purgeFixtureUsers, stubClientQueries } from './testUtils.js';

const FILE_PREFIX = 'emailsyncnow';

let repId: string;
let otherRepId: string;
let accountId: string;

function message(id: string): NormalizedMessage {
  return {
    providerMessageId: `INBOX:${id}`,
    threadId: `thread-${id}`,
    direction: 'inbound',
    fromAddress: 'buyer@customer.example',
    toAddresses: [`${FILE_PREFIX}-box@example.com`],
    ccAddresses: [],
    subject: `Subject ${id}`,
    hasAttachments: false,
    sentAt: new Date(),
    bodyText: null,
    bodyHtml: null,
    snippet: null,
    rfcMessageId: null,
    references: null,
    replyToAddresses: [],
  };
}

function page(messages: NormalizedMessage[], uidNext: number): ProviderPage {
  return {
    messages,
    cursor: `{"INBOX":{"uidValidity":"900","uidNext":${String(uidNext)}}}`,
    cursorInvalid: false,
    hasMore: false,
  };
}

const LOCK_SQL = "hashtext('email_sync_now'), hashtext($1::uuid::text)";

/** A provider answering each call with the next page, or throwing a queued error. */
function provider(pages: (ProviderPage | Error)[]): MailProvider & { calls: number } {
  const fake = {
    calls: 0,
    async fetchSince(): Promise<ProviderPage> {
      const next = pages[Math.min(fake.calls, pages.length - 1)];
      fake.calls += 1;
      if (next === undefined) throw new Error('no page queued');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  // Safe: fetchSince is the only member the sync engine calls on a reading driver.
  return fake as unknown as MailProvider & { calls: number };
}

/** Runs `body` while another session holds this mailbox's sync lock, as a running sync would. */
async function whileLockHeld(id: string, body: () => Promise<void>): Promise<void> {
  const holder = await pool.connect();
  try {
    await holder.query(`SELECT pg_advisory_lock(${LOCK_SQL})`, [id]);
    await body();
  } finally {
    await holder.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`, [id]);
    holder.release();
  }
}

async function storedCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*) FROM email_messages WHERE connected_account_id = $1',
    [accountId],
  );
  return Number(result.rows[0]?.count);
}

beforeAll(async () => {
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  for (const [suffix, assign] of [
    ['rep', (id: string) => (repId = id)],
    ['other', (id: string) => (otherRepId = id)],
  ] as const) {
    const user = await createUser({
      email: `${FILE_PREFIX}-${suffix}@example.com`,
      name: `Sync Now ${suffix}`,
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    assign(user.id);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  // As the E2E stack sets it; run-now refuses to race a scheduler.
  vi.stubEnv('EMAIL_SYNC_SCHEDULER', 'off');
  await pool.query('DELETE FROM connected_accounts WHERE user_id = ANY($1::uuid[])', [
    [repId, otherRepId],
  ]);
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
  const account = await createImapAccount(
    repId,
    {
      email_address: `${FILE_PREFIX}-box@example.com`,
      host: 'imap.example.com',
      port: 993,
      username: `${FILE_PREFIX}-box@example.com`,
      password: 'a-very-secret-password',
      secure: true,
    },
    { id: repId, name: 'Sync Now rep' },
  );
  accountId = account.id;
  // Parked, so another file's tick never claims it; run-now ignores the due time anyway.
  await parkFromScheduler(accountId);
});

afterAll(async () => {
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  await pool.end();
});

describe('syncAccountNow', () => {
  it('syncs a parked mailbox, and syncs it again straight after', async () => {
    const fake = provider([page([message('1')], 2), page([message('2')], 3)]);

    const first = await syncAccountNow(accountId, repId, fake);
    const second = await syncAccountNow(accountId, repId, fake);

    expect(first).toMatchObject({ status: 'synced', outcome: { messagesStored: 1 } });
    expect(second).toMatchObject({ status: 'synced', outcome: { messagesStored: 1 } });
    expect(await storedCount()).toBe(2);
  });

  it('claims whatever the due time, and writes the lease so a scheduler skips it', async () => {
    // Parked an hour out by beforeEach; cleared so only the claim can set a lease.
    await pool.query('UPDATE connected_accounts SET sync_next_attempt_at = NULL WHERE id = $1', [
      accountId,
    ]);
    const claimed = await claimAccountByIdForSync(accountId, repId);
    // Claimable again although the lease is in the future: the due time is not consulted.
    const reclaimed = await claimAccountByIdForSync(accountId, repId);

    expect(claimed?.id).toBe(accountId);
    expect(reclaimed?.id).toBe(accountId);
    const row = await pool.query<{ leased: boolean }>(
      `SELECT sync_next_attempt_at BETWEEN NOW() + interval '14 minutes'
                                       AND NOW() + interval '16 minutes' AS leased
         FROM connected_accounts WHERE id = $1`,
      [accountId],
    );
    expect(row.rows[0]?.leased).toBe(true);
  });

  it('claims nothing for a retired, disconnected, or inactive-owner mailbox', async () => {
    const cases: Array<[string, string]> = [
      [
        'UPDATE connected_accounts SET sync_failure_count = $2 WHERE id = $1',
        String(MAX_SYNC_FAILURES),
      ],
      ["UPDATE connected_accounts SET status = 'disconnected' WHERE id = $1 AND $2 = $2", 'x'],
      [
        "UPDATE users SET status = 'inactive' WHERE id = (SELECT user_id FROM connected_accounts WHERE id = $1) AND $2 = $2",
        'x',
      ],
    ];
    for (const [sql, value] of cases) {
      await pool.query(sql, [accountId, value]);
      expect(await claimAccountByIdForSync(accountId, repId)).toBeNull();
      await pool.query(
        `UPDATE connected_accounts SET sync_failure_count = 0, status = 'active' WHERE id = $1`,
        [accountId],
      );
      await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [repId]);
    }
  });

  it("answers null for another user's mailbox and touches nothing", async () => {
    const result = await syncAccountNow(accountId, otherRepId, provider([page([message('x')], 2)]));

    expect(result).toBeNull();
    expect(await storedCount()).toBe(0);
  });

  it('answers null for a paused mailbox', async () => {
    await pool.query('UPDATE connected_accounts SET sync_paused_at = NOW() WHERE id = $1', [
      accountId,
    ]);

    expect(await syncAccountNow(accountId, repId, provider([page([], 1)]))).toBeNull();
  });

  it("answers null when the owner's email_sync flag is off", async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    invalidateFeatureFlagCache();

    expect(await syncAccountNow(accountId, repId, provider([page([], 1)]))).toBeNull();
  });

  it('records a provider failure as a tick would, and reports its code', async () => {
    const failure = Object.assign(new Error('auth refused'), { code: 'PROVIDER_AUTH_EXPIRED' });

    const result = await syncAccountNow(accountId, repId, provider([failure]));

    expect(result).toEqual({ status: 'failed', errorCode: 'PROVIDER_AUTH_EXPIRED' });
    const row = await pool.query<{ sync_failure_count: number; status_detail: string | null }>(
      'SELECT sync_failure_count, status_detail FROM connected_accounts WHERE id = $1',
      [accountId],
    );
    expect(row.rows[0]?.sync_failure_count).toBe(1);
    expect(row.rows[0]?.status_detail).toBe('PROVIDER_AUTH_EXPIRED');
  });

  it('reports an uncoded failure as the generic sync failure', async () => {
    const result = await syncAccountNow(accountId, repId, provider([new Error('boom')]));

    expect(result).toEqual({ status: 'failed', errorCode: SYNC_FAILED_DETAIL });
  });

  it('refuses a run while another sync holds the lock, however the id is spelled', async () => {
    await whileLockHeld(accountId, async () => {
      for (const spelling of [accountId, accountId.toUpperCase()]) {
        await expect(
          syncAccountNow(spelling, repId, provider([page([], 1)])),
        ).rejects.toMatchObject({ code: SYNC_IN_PROGRESS });
      }
    });
  });

  it('refuses to run unless the scheduler is off, before claiming anything', async () => {
    for (const value of ['on', '']) {
      vi.stubEnv('EMAIL_SYNC_SCHEDULER', value);
      await expect(
        syncAccountNow(accountId, repId, provider([page([message('x')], 2)])),
      ).rejects.toMatchObject({ code: SCHEDULER_RUNNING });
    }
    expect(await storedCount()).toBe(0);
    const row = await pool.query<{ parked: boolean }>(
      `SELECT sync_next_attempt_at > NOW() + interval '30 minutes' AS parked
         FROM connected_accounts WHERE id = $1`,
      [accountId],
    );
    // Still parked an hour out: a claim would have shortened it to the 15-minute lease.
    expect(row.rows[0]?.parked).toBe(true);
  });

  it('syncs nothing while the org-wide flag is off, even for a user forced on', async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    await pool.query(
      `INSERT INTO feature_flag_user_overrides (flag_key, user_id, override)
       VALUES ('email_sync', $1, 'force_enabled')`,
      [repId],
    );
    invalidateFeatureFlagCache();
    const fake = provider([]);
    try {
      expect(await syncAccountNow(accountId, repId, fake)).toBeNull();
      expect(fake.calls).toBe(0);
      const row = await pool.query<{ parked: boolean }>(
        `SELECT sync_next_attempt_at > NOW() + interval '30 minutes' AS parked
           FROM connected_accounts WHERE id = $1`,
        [accountId],
      );
      // Still parked an hour out: the gate ran before a claim could shorten it to the lease.
      expect(row.rows[0]?.parked).toBe(true);
    } finally {
      await pool.query(
        `DELETE FROM feature_flag_user_overrides WHERE flag_key = 'email_sync' AND user_id = $1`,
        [repId],
      );
    }
  });

  it('sweeps stale send intents first, as a tick does', async () => {
    const stale = await pool.query<{ id: string }>(
      `INSERT INTO email_send_intents
         (idempotency_key, request_hash, user_id, actor_name, connected_account_id, rfc_message_id,
          status, updated_at)
       VALUES (gen_random_uuid(), '', $1, 'Sync Now rep', $2, 'stale@example.com', 'sent',
               now() - interval '2 hours')
       RETURNING id`,
      [repId, accountId],
    );

    await syncAccountNow(accountId, repId, provider([page([], 1)]));

    const after = await pool.query<{ status: string }>(
      'SELECT status FROM email_send_intents WHERE id = $1',
      [stale.rows[0]?.id],
    );
    expect(after.rows[0]?.status).toBe('unconfirmed');
  });

  it('holds no transaction open while the provider is called', async () => {
    let openLockTransactions = -1;
    const fake = provider([]);
    fake.fetchSince = async () => {
      // The run-now lock query's own text, so no other suite's session is counted.
      const open = await pool.query<{ count: string }>(
        `SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'idle in transaction'
            AND query LIKE '%hashtext($2::uuid::text)%'`,
      );
      openLockTransactions = Number(open.rows[0]?.count);
      throw new Error('stop after the check');
    };

    await syncAccountNow(accountId, repId, fake);

    expect(openLockTransactions).toBe(0);
  });

  // A destroyed connection releases the lock only once Postgres notices, so the probe in the
  // next test could race it; a returned one has unlocked first.
  it('returns every connection the run takes to the pool rather than destroying it', async () => {
    const { destroyed } = stubClientQueries([], 'fail');
    try {
      await syncAccountNow(accountId, repId, provider([new Error('boom')]));
    } finally {
      vi.restoreAllMocks();
    }

    expect(destroyed).toEqual([]);
  });

  it('destroys the connection whose lock query failed rather than pooling it', async () => {
    const { destroyed } = stubClientQueries(['pg_try_advisory_lock'], 'fail');
    try {
      await expect(syncAccountNow(accountId, repId, provider([]))).rejects.toThrow('storage down');
    } finally {
      vi.restoreAllMocks();
    }

    expect(destroyed).toEqual([expect.any(Error)]);
  });

  it('destroys the connection whose unlock failed, so its session ends and frees the lock', async () => {
    const { destroyed } = stubClientQueries(['pg_advisory_unlock'], 'fail');
    try {
      await syncAccountNow(accountId, repId, provider([page([], 1)]));
    } finally {
      vi.restoreAllMocks();
    }
    expect(destroyed).toEqual([expect.any(Error)]);

    // A session of its own; the destroyed one frees the lock once Postgres sees it end.
    const probe = new pg.Client(pool.options);
    await probe.connect();
    try {
      await probe.query(`SET lock_timeout = '5s'`);
      await probe.query(`SELECT pg_advisory_lock(${LOCK_SQL})`, [accountId]);
      await probe.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`, [accountId]);
    } finally {
      await probe.end();
    }
  });

  it('releases the lock after a failed run, so the next one proceeds', async () => {
    await syncAccountNow(accountId, repId, provider([new Error('boom')]));

    // A session of its own: a pooled probe could be handed the lock's connection, where an
    // advisory lock is re-entrant and the try would succeed whether or not it was released.
    const probe = new pg.Client(pool.options);
    await probe.connect();
    try {
      const lock = await probe.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`,
        [accountId],
      );
      expect(lock.rows[0]?.locked).toBe(true);
      await probe.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`, [accountId]);
    } finally {
      await probe.end();
    }
  });
});
