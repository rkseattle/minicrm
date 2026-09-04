/**
 * Integration tests for emailSyncJobService against the real test database.
 *
 * Covers the create → progress → complete/fail lifecycle, that progress is set rather
 * than incremented (a retried tick must not double-count), and that the active-job lookup
 * a resuming scheduler tick depends on finds unfinished work without creating a second
 * job for the same mailbox.
 */

import 'dotenv/config';

import pool from '../db.js';
import { parkFromScheduler } from './testUtils.js';
import { createUser } from '../services/userService.js';
import { createImapAccount } from '../services/connectedAccountService.js';
import {
  completeEmailSyncJob,
  createEmailSyncJob,
  failEmailSyncJob,
  getActiveEmailSyncJob,
  getEmailSyncJob,
  updateEmailSyncJobProgress,
} from '../services/emailSyncJobService.js';

const FILE_PREFIX = 'emailsyncjob';
const ACTOR = { id: '', name: 'Email Sync Job Rep' };

let accountId: string;

async function deleteFixtureUsers(): Promise<void> {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%@example.com`]);
}

beforeAll(async () => {
  await deleteFixtureUsers();

  const rep = await createUser({
    email: `${FILE_PREFIX}-a@example.com`,
    name: 'Email Sync Job Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  ACTOR.id = rep.id;

  const account = await createImapAccount(
    rep.id,
    {
      email_address: `${FILE_PREFIX}-a@example.com`,
      host: 'imap.example.com',
      port: 993,
      username: `${FILE_PREFIX}-a@example.com`,
      password: 'imap-password-value',
      secure: true,
    },
    ACTOR,
  );
  await parkFromScheduler(account.id);
  accountId = account.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM email_sync_jobs WHERE connected_account_id = $1', [accountId]);
});

afterAll(async () => {
  await deleteFixtureUsers();
  await pool.end();
});

describe('createEmailSyncJob', () => {
  it('opens a job in pending with no progress and no timestamps', async () => {
    const job = await createEmailSyncJob(accountId);

    expect(job.connected_account_id).toBe(accountId);
    expect(job.status).toBe('pending');
    expect(job.messages_synced).toBe(0);
    expect(job.error).toBeNull();
    expect(job.started_at).toBeNull();
    expect(job.completed_at).toBeNull();
  });

  it('adopts the job already in progress rather than stranding it behind a second', async () => {
    const first = await createEmailSyncJob(accountId);
    await updateEmailSyncJobProgress(first.id, 30);

    const second = await createEmailSyncJob(accountId);

    expect(second.id).toBe(first.id);
    expect(second.messages_synced).toBe(30);
    const all = await pool.query('SELECT id FROM email_sync_jobs WHERE connected_account_id = $1', [
      accountId,
    ]);
    expect(all.rows).toHaveLength(1);
  });

  it('opens exactly one job when two ticks race the same mailbox', async () => {
    const [first, second] = await Promise.all([
      createEmailSyncJob(accountId),
      createEmailSyncJob(accountId),
    ]);

    expect(second.id).toBe(first.id);
    const all = await pool.query('SELECT id FROM email_sync_jobs WHERE connected_account_id = $1', [
      accountId,
    ]);
    expect(all.rows).toHaveLength(1);
  });

  it('opens a fresh job once the previous one finished', async () => {
    const first = await createEmailSyncJob(accountId);
    await completeEmailSyncJob(first.id, 10);

    const second = await createEmailSyncJob(accountId);

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('pending');
  });
});

describe('updateEmailSyncJobProgress', () => {
  it('moves a pending job to running and stamps started_at', async () => {
    const job = await createEmailSyncJob(accountId);

    await updateEmailSyncJobProgress(job.id, 25);

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.status).toBe('running');
    expect(updated?.messages_synced).toBe(25);
    expect(updated?.started_at).not.toBeNull();
  });

  it('sets the running total rather than adding to it, so a retried tick cannot double-count', async () => {
    const job = await createEmailSyncJob(accountId);

    await updateEmailSyncJobProgress(job.id, 25);
    await updateEmailSyncJobProgress(job.id, 25);

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.messages_synced).toBe(25);
  });

  it('leaves a finished job alone, so a late tick cannot revive it', async () => {
    const job = await createEmailSyncJob(accountId);
    await failEmailSyncJob(job.id, 'mailbox unreachable');

    await updateEmailSyncJobProgress(job.id, 999);

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.messages_synced).not.toBe(999);
  });

  it('keeps the original started_at across later ticks', async () => {
    const job = await createEmailSyncJob(accountId);

    await updateEmailSyncJobProgress(job.id, 10);
    const first = await getEmailSyncJob(job.id);
    await updateEmailSyncJobProgress(job.id, 20);
    const second = await getEmailSyncJob(job.id);

    expect(second?.started_at?.getTime()).toBe(first?.started_at?.getTime());
  });
});

describe('completeEmailSyncJob', () => {
  it('marks the job complete with its final count and leaves no stale error text', async () => {
    const job = await createEmailSyncJob(accountId);
    await updateEmailSyncJobProgress(job.id, 100);

    await completeEmailSyncJob(job.id, 120);

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.status).toBe('complete');
    expect(updated?.messages_synced).toBe(120);
    expect(updated?.error).toBeNull();
    expect(updated?.completed_at).not.toBeNull();
  });
});

describe('terminal jobs resist further writes', () => {
  it('does not let a late completion overwrite a recorded failure', async () => {
    const job = await createEmailSyncJob(accountId);
    await failEmailSyncJob(job.id, 'mailbox unreachable');

    await completeEmailSyncJob(job.id, 500);

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('mailbox unreachable');
  });

  it('does not let a late failure overwrite a successful backfill', async () => {
    const job = await createEmailSyncJob(accountId);
    await completeEmailSyncJob(job.id, 75);

    await failEmailSyncJob(job.id, 'arrived too late');

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.status).toBe('complete');
    expect(updated?.messages_synced).toBe(75);
    expect(updated?.error).toBeNull();
  });
});

describe('failEmailSyncJob', () => {
  it('records the reason and preserves the count reached so far', async () => {
    const job = await createEmailSyncJob(accountId);
    await updateEmailSyncJobProgress(job.id, 40);

    await failEmailSyncJob(job.id, 'mailbox unreachable');

    const updated = await getEmailSyncJob(job.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error).toBe('mailbox unreachable');
    expect(updated?.messages_synced).toBe(40);
    expect(updated?.completed_at).not.toBeNull();
  });
});

describe('getEmailSyncJob', () => {
  it('returns null for a job that does not exist', async () => {
    await expect(getEmailSyncJob('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
  });
});

describe('getActiveEmailSyncJob', () => {
  it('finds a pending job so a resuming tick does not open a second one', async () => {
    const job = await createEmailSyncJob(accountId);

    const active = await getActiveEmailSyncJob(accountId);
    expect(active?.id).toBe(job.id);
  });

  it('finds a running job', async () => {
    const job = await createEmailSyncJob(accountId);
    await updateEmailSyncJobProgress(job.id, 5);

    const active = await getActiveEmailSyncJob(accountId);
    expect(active?.id).toBe(job.id);
  });

  it('ignores completed and failed jobs', async () => {
    const completed = await createEmailSyncJob(accountId);
    await completeEmailSyncJob(completed.id, 10);
    const failed = await createEmailSyncJob(accountId);
    await failEmailSyncJob(failed.id, 'gave up');

    await expect(getActiveEmailSyncJob(accountId)).resolves.toBeNull();
  });

  it('returns null for an account with no jobs at all', async () => {
    await expect(getActiveEmailSyncJob('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
  });
});

describe('the email_sync_jobs schema', () => {
  it('rejects a status outside the CHECK constraint', async () => {
    const job = await createEmailSyncJob(accountId);

    // Matches the PG check-violation code rather than the constraint name, so a
    // corrective migration may rename the constraint without breaking this.
    await expect(
      pool.query(`UPDATE email_sync_jobs SET status = 'bogus' WHERE id = $1`, [job.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('deletes its jobs when the connected account is deleted', async () => {
    const job = await createEmailSyncJob(accountId);

    const rep = await createUser({
      email: `${FILE_PREFIX}-cascade@example.com`,
      name: 'Cascade Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const doomed = await createImapAccount(
      rep.id,
      {
        email_address: `${FILE_PREFIX}-cascade@example.com`,
        host: 'imap.example.com',
        port: 993,
        username: `${FILE_PREFIX}-cascade@example.com`,
        password: 'imap-password-value',
        secure: true,
      },
      { id: rep.id, name: 'Cascade Rep' },
    );
    await parkFromScheduler(doomed.id);
    const doomedJob = await createEmailSyncJob(doomed.id);

    await pool.query('DELETE FROM connected_accounts WHERE id = $1', [doomed.id]);

    await expect(getEmailSyncJob(doomedJob.id)).resolves.toBeNull();
    // The surviving account's job is untouched, so the cascade is scoped to its own row.
    await expect(getEmailSyncJob(job.id)).resolves.not.toBeNull();
  });
});
