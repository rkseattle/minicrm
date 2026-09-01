/**
 * Unit tests for retentionService.ts.
 *
 * Covers:
 *  - getAiSessionRetentionStats reflects current ai_sessions/ai_messages counts
 *  - purgeAiSessions is directly callable (exported for the manual purge endpoint)
 *    and respects the configured retention window
 *  - purgeAiSessions writes a purge-result audit entry
 *  - runRetentionPurge (the full nightly-cron aggregate) completes without throwing
 *    and purges the AI session portion; the automation_rule_logs/webhook_delivery_logs/
 *    import_jobs purges are exercised as a side effect but not asserted on directly here
 *    (their own retention windows are documented in docs/dev/retention.md and are
 *    exercised indirectly by other suites that populate those tables).
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createSession } from '../services/aiSessionService.js';
import { createImapAccount } from '../services/connectedAccountService.js';
import {
  purgeAiSessions,
  getAiSessionRetentionStats,
  runRetentionPurge,
} from '../services/retentionService.js';

const FILE_PREFIX = 'retention-svc';
const USER_EMAIL = `${FILE_PREFIX}-user@example.com`;

let userId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const user = await createUser({
    email: USER_EMAIL,
    name: 'Retention Svc User',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  userId = user.id;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

beforeEach(async () => {
  await pool.query('DELETE FROM ai_sessions WHERE user_id = $1', [userId]);
  await pool.query(`UPDATE ai_configuration SET ai_session_retention_days = 90`);
});

describe('getAiSessionRetentionStats', () => {
  it('reflects the current ai_sessions row count', async () => {
    const before = await getAiSessionRetentionStats();
    await createSession(userId, { id: userId, name: 'Retention Svc User' });
    const after = await getAiSessionRetentionStats();
    expect(after.sessionCount).toBe(before.sessionCount + 1);
  });
});

describe('purgeAiSessions', () => {
  it('deletes sessions older than the configured retention window', async () => {
    const session = await createSession(userId, { id: userId, name: 'Retention Svc User' });
    await pool.query(
      `UPDATE ai_sessions SET created_at = now() - interval '200 days' WHERE id = $1`,
      [session.id],
    );
    await pool.query(`UPDATE ai_configuration SET ai_session_retention_days = 90`);

    await purgeAiSessions();

    const remaining = await pool.query('SELECT id FROM ai_sessions WHERE id = $1', [session.id]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('leaves sessions within the retention window untouched', async () => {
    const session = await createSession(userId, { id: userId, name: 'Retention Svc User' });
    await pool.query(`UPDATE ai_configuration SET ai_session_retention_days = 90`);

    await purgeAiSessions();

    const remaining = await pool.query('SELECT id FROM ai_sessions WHERE id = $1', [session.id]);
    expect(remaining.rows).toHaveLength(1);
  });

  it('writes a purge-result audit entry', async () => {
    await purgeAiSessions();

    // Deliberately NOT scoped by changed_by_id, unlike the other audit
    // assertions hardened under that change: purgeAiSessions always writes as
    // SYSTEM_ACTOR (retentionService.ts:123), so changed_by_id carries the
    // shared all-zeros UUID and isolates nothing.
    //
    // aiRetentionController.ts:48 DOES write this exact row shape — it calls
    // purgeAiSessions() fire-and-forget — so the LIMIT 1 slot is genuinely
    // contestable. What makes this safe is that both files are in SERIAL_FILES
    // (vitest.config.ts), so they never run concurrently with each other. Note
    // the residual exposure the sibling comments in repCoachingService.test.ts
    // and dataHygieneService.test.ts describe: the serial project still runs
    // alongside the parallel one, so this holds only while no parallel-project
    // file purges AI sessions. Documented as safe rather than fixed, per
    // AC 2.
    const row = await pool.query<{ new_value: string }>(
      `SELECT new_value FROM audit_log
       WHERE record_type = 'ai_sessions' AND event_type = 'deleted'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].new_value).toMatch(/Purged \d+ session\(s\)/);
  });
});

describe('runRetentionPurge', () => {
  it('completes without throwing and purges AI sessions past the retention window', async () => {
    const session = await createSession(userId, { id: userId, name: 'Retention Svc User' });
    await pool.query(
      `UPDATE ai_sessions SET created_at = now() - interval '200 days' WHERE id = $1`,
      [session.id],
    );
    await pool.query(`UPDATE ai_configuration SET ai_session_retention_days = 90`);

    await expect(runRetentionPurge()).resolves.toBeUndefined();

    const remaining = await pool.query('SELECT id FROM ai_sessions WHERE id = $1', [session.id]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('retires an email_sync_job whose progress has stalled, freeing the mailbox', async () => {
    const account = await createImapAccount(
      userId,
      {
        email_address: `${FILE_PREFIX}-stalled@example.com`,
        host: 'imap.example.com',
        port: 993,
        username: `${FILE_PREFIX}-stalled@example.com`,
        password: 'imap-password-value',
        secure: true,
      },
      { id: userId, name: 'Retention Svc User' },
    );
    const stalled = await pool.query<{ id: string }>(
      `INSERT INTO email_sync_jobs (connected_account_id, status, updated_at)
       VALUES ($1, 'running', now() - interval '48 hours')
       RETURNING id`,
      [account.id],
    );

    await expect(runRetentionPurge()).resolves.toBeUndefined();

    const after = await pool.query<{ status: string; error: string | null }>(
      'SELECT status, error FROM email_sync_jobs WHERE id = $1',
      [stalled.rows[0].id],
    );
    expect(after.rows[0].status).toBe('failed');
    expect(after.rows[0].error).toMatch(/retired automatically/);
  });

  it('purges finished email_sync_jobs past the window but never an unfinished one', async () => {
    const account = await createImapAccount(
      userId,
      {
        email_address: `${FILE_PREFIX}-mailbox@example.com`,
        host: 'imap.example.com',
        port: 993,
        username: `${FILE_PREFIX}-mailbox@example.com`,
        password: 'imap-password-value',
        secure: true,
      },
      { id: userId, name: 'Retention Svc User' },
    );

    // Keyed on messages_synced rather than RETURNING order: a multi-row INSERT does not
    // promise to emit rows in VALUES order, and the assertions below invert if it does not.
    const inserted = await pool.query<{ id: string; messages_synced: number }>(
      `INSERT INTO email_sync_jobs (connected_account_id, status, created_at, messages_synced)
       VALUES ($1, 'complete', now() - interval '200 days', 1),
              ($1, 'failed',   now() - interval '200 days', 2),
              ($1, 'running',  now(),                       3),
              ($1, 'complete', now(),                       4)
       RETURNING id, messages_synced`,
      [account.id],
    );
    // Non-null is safe: every marker below is one of the four just inserted.
    const idFor = (marker: number): string =>
      inserted.rows.find((r) => r.messages_synced === marker)!.id;

    await expect(runRetentionPurge()).resolves.toBeUndefined();

    const surviving = await pool.query<{ id: string }>(
      'SELECT id FROM email_sync_jobs WHERE connected_account_id = $1',
      [account.id],
    );
    const survivingIds = surviving.rows.map((r) => r.id);

    // A backfill in progress survives: only age plus a terminal status purges a job, and
    // the stale sweep leaves it alone because its updated_at is current.
    expect(survivingIds).toContain(idFor(3));
    expect(survivingIds).toContain(idFor(4));
    expect(survivingIds).not.toContain(idFor(1));
    expect(survivingIds).not.toContain(idFor(2));
  });
});
