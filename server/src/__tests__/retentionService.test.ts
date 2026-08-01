/**
 * Unit tests for retentionService.ts. (MINCRM-447, MINCRM-462)
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
    // assertions hardened under MINCRM-693: purgeAiSessions always writes as
    // SYSTEM_ACTOR (retentionService.ts:123), so changed_by_id carries the
    // shared all-zeros UUID and isolates nothing. record_name is likewise fixed
    // in the service. The assertion is safe because aiRetentionController's own
    // purge test asserts on field_name = 'manual_purge_triggered', a different
    // row shape, so the two cannot take each other's LIMIT 1 slot. Documented
    // as safe rather than fixed (MINCRM-693 AC 2).
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
});
