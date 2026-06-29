/**
 * Integration tests for aiContextService. (MINCRM-427)
 *
 * Covers:
 *  - listContextEntries: empty list, populated list ordered by created_at
 *  - createContextEntry: persists entry, writes audit entry
 *  - createContextEntry: rejects when the 50-entry cap is reached
 *  - updateContextEntry: updates key/value, writes diffed audit entries
 *  - updateContextEntry: throws 404 for unknown ID
 *  - updateContextEntry: enforces ownership (other user cannot update)
 *  - deleteContextEntry: removes entry, writes audit entry
 *  - deleteContextEntry: throws 404 for unknown ID
 *  - deleteContextEntry: enforces ownership (other user cannot delete)
 *
 * Runs against the real PostgreSQL minicrm_test DB.
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  listContextEntries,
  createContextEntry,
  updateContextEntry,
  deleteContextEntry,
} from '../services/aiContextService.js';

const FILE_PREFIX = 'aic-svc';
const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test User' };

let userId: string;
let otherUserId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const r1 = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'Context User', 'rep', '$2b$12$placeholder', 'active')
     RETURNING id`,
    [`${FILE_PREFIX}-user@example.com`],
  );
  userId = r1.rows[0].id;

  const r2 = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'Other User', 'rep', '$2b$12$placeholder', 'active')
     RETURNING id`,
    [`${FILE_PREFIX}-other@example.com`],
  );
  otherUserId = r2.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM user_ai_context WHERE user_id IN ($1, $2)', [userId, otherUserId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

describe('listContextEntries', () => {
  it('returns empty array when no entries exist', async () => {
    const entries = await listContextEntries(userId);
    expect(entries).toEqual([]);
  });

  it('returns entries ordered by created_at ascending', async () => {
    await createContextEntry(userId, 'b-key', 'b-value', ACTOR);
    await createContextEntry(userId, 'a-key', 'a-value', ACTOR);
    const entries = await listContextEntries(userId);
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('b-key');
    expect(entries[1].key).toBe('a-key');
  });

  it('does not return entries for other users', async () => {
    await createContextEntry(otherUserId, 'other-key', 'other-value', ACTOR);
    const entries = await listContextEntries(userId);
    expect(entries).toHaveLength(0);
  });
});

describe('createContextEntry', () => {
  it('creates an entry and returns it', async () => {
    const entry = await createContextEntry(userId, 'a while', '30+ days without activity', ACTOR);
    expect(entry.user_id).toBe(userId);
    expect(entry.key).toBe('a while');
    expect(entry.value).toBe('30+ days without activity');
    expect(entry.id).toBeTruthy();
    expect(entry.created_at).toBeTruthy();
  });

  it('writes an audit entry for the creation', async () => {
    const entry = await createContextEntry(userId, 'audit-key', 'audit-value', ACTOR);
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'user_ai_context' AND record_id = $1 AND event_type = 'created'`,
      [entry.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].record_name).toBe('audit-key');
  });

  it('rejects with 409 when the 50-entry cap is reached', async () => {
    const inserts = Array.from({ length: 50 }, (_, i) =>
      createContextEntry(userId, `key-${i}`, `value-${i}`, ACTOR),
    );
    await Promise.all(inserts);

    await expect(
      createContextEntry(userId, 'overflow-key', 'overflow-value', ACTOR),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONTEXT_ENTRY_LIMIT_REACHED' });
  });
});

describe('updateContextEntry', () => {
  it('updates key only', async () => {
    const entry = await createContextEntry(userId, 'old-key', 'old-value', ACTOR);
    const updated = await updateContextEntry(entry.id, userId, { key: 'new-key' }, ACTOR);
    expect(updated.key).toBe('new-key');
    expect(updated.value).toBe('old-value');
  });

  it('updates value only', async () => {
    const entry = await createContextEntry(userId, 'my-key', 'old-value', ACTOR);
    const updated = await updateContextEntry(entry.id, userId, { value: 'new-value' }, ACTOR);
    expect(updated.key).toBe('my-key');
    expect(updated.value).toBe('new-value');
  });

  it('writes audit entries for changed fields', async () => {
    const entry = await createContextEntry(userId, 'audit-update', 'before', ACTOR);
    await updateContextEntry(entry.id, userId, { value: 'after' }, ACTOR);
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'user_ai_context' AND record_id = $1 AND event_type = 'updated'`,
      [entry.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].old_value).toBe('before');
    expect(audit.rows[0].new_value).toBe('after');
  });

  it('throws 404 when entry does not exist', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    await expect(updateContextEntry(fakeId, userId, { value: 'x' }, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('enforces ownership — other user cannot update', async () => {
    const entry = await createContextEntry(userId, 'owner-key', 'owner-value', ACTOR);
    await expect(
      updateContextEntry(entry.id, otherUserId, { value: 'hacked' }, ACTOR),
    ).rejects.toMatchObject({ statusCode: 404 });
    const original = await listContextEntries(userId);
    expect(original[0].value).toBe('owner-value');
  });
});

describe('deleteContextEntry', () => {
  it('deletes the entry', async () => {
    const entry = await createContextEntry(userId, 'to-delete', 'value', ACTOR);
    await deleteContextEntry(entry.id, userId, ACTOR);
    const entries = await listContextEntries(userId);
    expect(entries.find((e) => e.id === entry.id)).toBeUndefined();
  });

  it('writes an audit entry for the deletion', async () => {
    const entry = await createContextEntry(userId, 'audit-delete', 'value', ACTOR);
    await deleteContextEntry(entry.id, userId, ACTOR);
    const audit = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'user_ai_context' AND record_id = $1 AND event_type = 'deleted'`,
      [entry.id],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('throws 404 when entry does not exist', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000098';
    await expect(deleteContextEntry(fakeId, userId, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('enforces ownership — other user cannot delete', async () => {
    const entry = await createContextEntry(userId, 'protected-key', 'value', ACTOR);
    await expect(deleteContextEntry(entry.id, otherUserId, ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
    const entries = await listContextEntries(userId);
    expect(entries.find((e) => e.id === entry.id)).toBeTruthy();
  });
});
