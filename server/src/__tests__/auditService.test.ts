/**
 * Integration tests for auditService.
 *
 * Covers:
 *  - writeAuditEntry / writeAuditEntries (transactional write)
 *  - writeAuditEntryBestEffort (pool write)
 *  - Sensitive field masking (password_hash, secret_access_key)
 *  - Append-only trigger (UPDATE/DELETE raise EXCEPTION)
 *  - diffFields (field-level change detection)
 *  - getRecordAuditLog (per-record history)
 *  - listAuditLog (paginated, filtered system-wide query)
 *  - listAuditLogActors (distinct user list)
 *
 */

import 'dotenv/config';
import pool from '../db.js';
import logger from '../logger.js';
import { vi } from 'vitest';
import {
  writeAuditEntry,
  writeAuditEntries,
  writeAuditEntryBestEffort,
  diffFields,
  getRecordAuditLog,
  listAuditLog,
  listAuditLogActors,
  maskAuditEvent,
} from '../services/auditService.js';
import { createUser } from '../services/userService.js';
import { erasedAddressDigest } from '../services/mail/gdprRedaction.js';

const RECORD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORD_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Test Actor' };
/** Second actor used only in listAuditLogActors tests. */
const ACTOR_2_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** record_ids and actor IDs written exclusively by this file. */
const FILE_RECORD_IDS = [RECORD_ID, RECORD_ID_2];
const FILE_ACTOR_IDS = [ACTOR.id, ACTOR_2_ID];

/**
 * Helper: clear only this file's audit_log entries (scoped by record_id or
 * actor). Temporarily disables the append-only trigger so we can delete
 * test data. Filters by both record_id and changed_by_id, so this can't
 * share testUtils.ts's clearAuditLogFor helper directly — same underlying
 * fix though: all three statements run in one transaction on a single
 * client, since ALTER TABLE ... DISABLE/ENABLE TRIGGER is catalog-level
 * (visible to every concurrent connection, not session-scoped) but takes an
 * ACCESS EXCLUSIVE lock on the table held until COMMIT — that lock
 * serializes any other caller of this same disable/delete/enable sequence
 * (including a different test file's own copy, run concurrently by Vitest
 * against the shared test database) behind this one. See
 * clearAuditLogFor's own docblock for the two claims verified directly
 * against a real Postgres session pair.
 */
async function clearAuditLog(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await client.query(
      'DELETE FROM audit_log WHERE record_id = ANY($1) OR changed_by_id = ANY($2)',
      [FILE_RECORD_IDS, FILE_ACTOR_IDS],
    );
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await clearAuditLog();
});

afterAll(async () => {
  await clearAuditLog();
  await pool.end();
});

// ── writeAuditEntry ────────────────────────────────────────────────────────────

describe('writeAuditEntry', () => {
  it('inserts an entry inside a transaction and returns it from the DB', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        recordName: 'Alice Smith',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await pool.query('SELECT * FROM audit_log WHERE record_id = $1', [RECORD_ID]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.record_type).toBe('contact');
    expect(row.event_type).toBe('created');
    expect(row.record_name).toBe('Alice Smith');
    expect(row.changed_by_id).toBe(ACTOR.id);
    expect(row.changed_by_name).toBe(ACTOR.name);
  });

  it('rolls back if the outer transaction is rolled back', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        recordName: 'Bob Jones',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const result = await pool.query('SELECT * FROM audit_log WHERE record_id = $1', [RECORD_ID]);
    expect(result.rows).toHaveLength(0);
  });

  it('masks old_value and new_value for sensitive fields', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: RECORD_ID,
        eventType: 'updated',
        fieldName: 'password_hash',
        oldValue: '$2b$12$old_hash_value',
        newValue: '$2b$12$new_hash_value',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await pool.query('SELECT * FROM audit_log WHERE record_id = $1', [RECORD_ID]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.field_name).toBe('password_hash');
    expect(row.old_value).toBeNull();
    expect(row.new_value).toBeNull();
  });

  it('masks secret_access_key values', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'system_settings',
        eventType: 'updated',
        fieldName: 'secret_access_key',
        oldValue: 'old-secret',
        newValue: 'new-secret',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await pool.query('SELECT * FROM audit_log WHERE changed_by_id = $1', [ACTOR.id]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].old_value).toBeNull();
    expect(result.rows[0].new_value).toBeNull();
  });

  it('stores non-sensitive field values as-is', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        eventType: 'updated',
        fieldName: 'email',
        oldValue: 'old@example.com',
        newValue: 'new@example.com',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await pool.query('SELECT * FROM audit_log WHERE record_id = $1', [RECORD_ID]);
    expect(result.rows[0].old_value).toBe('old@example.com');
    expect(result.rows[0].new_value).toBe('new@example.com');
  });
});

// ── writeAuditEntries ──────────────────────────────────────────────────────────

describe('writeAuditEntries', () => {
  it('inserts multiple entries in a single transaction', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntries(client, [
        {
          recordType: 'account',
          recordId: RECORD_ID,
          eventType: 'updated',
          fieldName: 'name',
          oldValue: 'Old Corp',
          newValue: 'New Corp',
          changedById: ACTOR.id,
          changedByName: ACTOR.name,
        },
        {
          recordType: 'account',
          recordId: RECORD_ID,
          eventType: 'updated',
          fieldName: 'industry',
          oldValue: 'Tech',
          newValue: 'Finance',
          changedById: ACTOR.id,
          changedByName: ACTOR.name,
        },
      ]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await pool.query(
      'SELECT * FROM audit_log WHERE record_id = $1 ORDER BY field_name',
      [RECORD_ID],
    );
    expect(result.rows).toHaveLength(2);
    // ORDER BY field_name: 'industry' < 'name' alphabetically
    expect(result.rows[0].field_name).toBe('industry');
    expect(result.rows[1].field_name).toBe('name');
  });
});

// ── writeAuditEntryBestEffort ──────────────────────────────────────────────────

describe('writeAuditEntryBestEffort', () => {
  it('inserts an entry without a caller-supplied transaction', async () => {
    await writeAuditEntryBestEffort({
      recordType: 'user',
      recordId: RECORD_ID,
      eventType: 'login',
      changedById: ACTOR.id,
      changedByName: ACTOR.name,
    });

    const result = await pool.query('SELECT * FROM audit_log WHERE record_id = $1', [RECORD_ID]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].event_type).toBe('login');
  });
});

// ── Append-only trigger ────────────────────────────────────────────────────────

describe('audit_log append-only trigger', () => {
  it('raises an exception on UPDATE', async () => {
    // Insert a row directly (bypasses writeAuditEntry for isolation)
    const insertResult = await pool.query(
      `INSERT INTO audit_log (record_type, event_type) VALUES ('contact', 'created') RETURNING id`,
    );
    const id = insertResult.rows[0].id;

    await expect(
      pool.query(`UPDATE audit_log SET record_name = 'modified' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/i);
  });

  it('raises an exception on DELETE', async () => {
    const insertResult = await pool.query(
      `INSERT INTO audit_log (record_type, event_type) VALUES ('contact', 'created') RETURNING id`,
    );
    const id = insertResult.rows[0].id;

    await expect(pool.query(`DELETE FROM audit_log WHERE id = $1`, [id])).rejects.toThrow(
      /append-only/i,
    );
  });
});

// ── diffFields ─────────────────────────────────────────────────────────────────

describe('diffFields', () => {
  const base = {
    recordType: 'contact' as const,
    recordId: RECORD_ID,
    changedById: ACTOR.id,
    changedByName: ACTOR.name,
  };

  it('returns an entry for each changed field', () => {
    const before = { first_name: 'Alice', email: 'alice@example.com' };
    const after = { first_name: 'Alice', email: 'alicenew@example.com' };

    const entries = diffFields(before, after, base);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldName).toBe('Email'); // display name
    expect(entries[0].oldValue).toBe('alice@example.com');
    expect(entries[0].newValue).toBe('alicenew@example.com');
    expect(entries[0].eventType).toBe('updated');
  });

  it('returns an empty array when nothing changed', () => {
    const before = { first_name: 'Alice', email: 'alice@example.com' };
    const after = { first_name: 'Alice', email: 'alice@example.com' };

    expect(diffFields(before, after, base)).toHaveLength(0);
  });

  it('skips id, created_at, and updated_at', () => {
    const before = { id: '1', created_at: new Date(), updated_at: new Date(), name: 'Acme' };
    const after = {
      id: '1',
      created_at: new Date(Date.now() + 1000),
      updated_at: new Date(Date.now() + 1000),
      name: 'Acme',
    };

    expect(diffFields(before, after, base)).toHaveLength(0);
  });

  it('treats null and undefined as equivalent (no diff)', () => {
    const before = { phone: null };
    const after = { phone: undefined };
    expect(diffFields(before, after, base)).toHaveLength(0);
  });

  it('detects null → value as a change', () => {
    const before = { phone: null };
    const after = { phone: '+1-555-0100' };

    const entries = diffFields(before, after, base);
    expect(entries).toHaveLength(1);
    expect(entries[0].oldValue).toBeNull();
    expect(entries[0].newValue).toBe('+1-555-0100');
  });

  it('detects value → null as a change', () => {
    const before = { phone: '+1-555-0100' };
    const after = { phone: null };

    const entries = diffFields(before, after, base);
    expect(entries).toHaveLength(1);
    expect(entries[0].oldValue).toBe('+1-555-0100');
    expect(entries[0].newValue).toBeNull();
  });
});

// ── getRecordAuditLog ──────────────────────────────────────────────────────────

describe('getRecordAuditLog', () => {
  it('returns entries for the specified record, newest first', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'deal',
        recordId: RECORD_ID,
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await writeAuditEntry(client, {
        recordType: 'deal',
        recordId: RECORD_ID,
        eventType: 'updated',
        fieldName: 'stage',
        oldValue: 'Prospecting',
        newValue: 'Qualification',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const rows = await getRecordAuditLog({ recordType: 'deal', recordId: RECORD_ID });
    expect(rows).toHaveLength(2);
    const eventTypes = rows.map((r) => r.event_type);
    expect(eventTypes).toContain('created');
    expect(eventTypes).toContain('updated');
  });

  it('respects the limit option', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < 5; i++) {
        await writeAuditEntry(client, {
          recordType: 'deal',
          recordId: RECORD_ID,
          eventType: 'updated',
          changedById: ACTOR.id,
          changedByName: ACTOR.name,
        });
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const rows = await getRecordAuditLog({ recordType: 'deal', recordId: RECORD_ID, limit: 3 });
    expect(rows).toHaveLength(3);
  });

  it('returns all entries when all=true', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < 25; i++) {
        await writeAuditEntry(client, {
          recordType: 'deal',
          recordId: RECORD_ID,
          eventType: 'updated',
          changedById: ACTOR.id,
          changedByName: ACTOR.name,
        });
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const rows = await getRecordAuditLog({ recordType: 'deal', recordId: RECORD_ID, all: true });
    expect(rows.length).toBe(25);
  });

  it('returns an empty array for a record with no history', async () => {
    const rows = await getRecordAuditLog({ recordType: 'deal', recordId: RECORD_ID });
    expect(rows).toHaveLength(0);
  });
});

// ── listAuditLog ───────────────────────────────────────────────────────────────

describe('listAuditLog', () => {
  async function seedEntries(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await writeAuditEntry(client, {
        recordType: 'account',
        recordId: RECORD_ID_2,
        eventType: 'updated',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await writeAuditEntry(client, {
        recordType: 'deal',
        recordId: RECORD_ID,
        eventType: 'deleted',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  it('returns all entries when no filters applied', async () => {
    await seedEntries();
    const result = await listAuditLog({ userId: ACTOR.id });
    expect(result.total).toBe(3);
    expect(result.data).toHaveLength(3);
  });

  it('filters by recordType', async () => {
    await seedEntries();
    const result = await listAuditLog({ recordType: 'contact', userId: ACTOR.id });
    expect(result.total).toBe(1);
    expect(result.data[0].record_type).toBe('contact');
  });

  it('filters by eventType', async () => {
    await seedEntries();
    const result = await listAuditLog({ eventType: 'deleted', userId: ACTOR.id });
    expect(result.total).toBe(1);
    expect(result.data[0].event_type).toBe('deleted');
  });

  it('filters by userId', async () => {
    await seedEntries();
    const result = await listAuditLog({ userId: ACTOR.id });
    expect(result.total).toBe(3);

    const result2 = await listAuditLog({ userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
    expect(result2.total).toBe(0);
  });

  it('paginates correctly', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < 5; i++) {
        await writeAuditEntry(client, {
          recordType: 'contact',
          recordId: RECORD_ID,
          eventType: 'updated',
          changedById: ACTOR.id,
          changedByName: ACTOR.name,
        });
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const page1 = await listAuditLog({ page: 1, limit: 2, userId: ACTOR.id });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.page).toBe(1);

    const page3 = await listAuditLog({ page: 3, limit: 2, userId: ACTOR.id });
    expect(page3.data).toHaveLength(1);
  });
});

// ── listAuditLogActors ─────────────────────────────────────────────────────────

describe('listAuditLogActors', () => {
  it('returns distinct actors ordered by name', async () => {
    const actor2 = { id: ACTOR_2_ID, name: 'Alice Admin' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await writeAuditEntry(client, {
        recordType: 'deal',
        recordId: RECORD_ID_2,
        eventType: 'created',
        changedById: actor2.id,
        changedByName: actor2.name,
      });
      // A duplicate entry for ACTOR — should not appear twice
      await writeAuditEntry(client, {
        recordType: 'account',
        recordId: RECORD_ID,
        eventType: 'updated',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const actors = (await listAuditLogActors()).filter((a) => FILE_ACTOR_IDS.includes(a.id));
    expect(actors).toHaveLength(2);
    // Ordered by name ASC
    expect(actors[0].name).toBe('Alice Admin');
    expect(actors[1].name).toBe('Test Actor');
  });

  it('returns an empty array when the log is empty', async () => {
    const actors = (await listAuditLogActors()).filter((a) => FILE_ACTOR_IDS.includes(a.id));
    expect(actors).toHaveLength(0);
  });
});

// ── source tagging ───────────────────────────────────────────────

describe('source tagging', () => {
  it('stores source = "AI (NLI)" when provided', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        recordName: 'Alice Smith',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
        source: 'AI (NLI)',
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const rows = await getRecordAuditLog({ recordType: 'contact', recordId: RECORD_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('AI (NLI)');
  });

  it('stores source = null when not provided', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        recordName: 'Alice Smith',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const rows = await getRecordAuditLog({ recordType: 'contact', recordId: RECORD_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBeNull();
  });

  it('listAuditLog({ source: "AI (NLI)" }) returns only AI entries', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        recordName: 'Alice',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
        source: 'AI (NLI)',
      });
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID_2,
        recordName: 'Bob',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
        // no source = human
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await listAuditLog({
      source: 'AI (NLI)',
      userId: ACTOR.id,
    });
    expect(result.data.every((r) => r.source === 'AI (NLI)')).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });

  it('listAuditLog({ source: "human" }) returns only null-source entries', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID,
        recordName: 'Alice',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
        source: 'AI (NLI)',
      });
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID_2,
        recordName: 'Bob',
        eventType: 'created',
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const result = await listAuditLog({
      source: 'human',
      userId: ACTOR.id,
    });
    expect(result.data.every((r) => r.source === null)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Erased addresses in address-bearing values ─────────────────────────────────

describe('masking erased addresses in email_sent values', () => {
  const ERASED = 'erased-subject@example.net';
  const ERASURE_RECORD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  let requesterId: string;

  beforeAll(async () => {
    await pool.query(`DELETE FROM users WHERE email = 'auditsvc-gdpr@example.com'`);
    const requester = await createUser({
      email: 'auditsvc-gdpr@example.com',
      name: 'Audit GDPR Requester',
      role: 'admin',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    requesterId = requester.id;
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at, erased_address_hmac)
       VALUES ('contact', $1, $2, '{}', now(), $3)`,
      [ERASURE_RECORD, requesterId, erasedAddressDigest(ERASED)],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = $1', [ERASURE_RECORD]);
    await pool.query('DELETE FROM users WHERE id = $1', [requesterId]);
  });

  async function writeSent(): Promise<void> {
    const client = await pool.connect();
    try {
      await writeAuditEntry(client, {
        recordType: 'connected_account',
        recordId: RECORD_ID,
        recordName: 'mailbox@example.com',
        eventType: 'email_sent',
        fieldName: 'email_message',
        newValue: JSON.stringify({
          message_id: 'm-1',
          recipient_count: 3,
          to: [ERASED, 'kept@example.net'],
          cc: ['Erased-Subject@Example.net'],
          linked_records: [],
        }),
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
    } finally {
      client.release();
    }
  }

  function recipients(value: string | null): { to: string[]; cc: string[] } {
    const parsed = JSON.parse(value ?? '{}') as { to: string[]; cc: string[] };
    return { to: parsed.to, cc: parsed.cc };
  }

  const MASKED = { to: ['[GDPR deleted]', 'kept@example.net'], cc: ['[GDPR deleted]'] };

  it("masks them in a record's history, leaving other recipients readable", async () => {
    await writeSent();

    const [entry] = await getRecordAuditLog({
      recordType: 'connected_account',
      recordId: RECORD_ID,
      all: true,
    });

    // Safe: the entry written above is this record's only one.
    expect(recipients(entry!.new_value)).toEqual(MASKED);
  });

  it('masks them in the admin audit log', async () => {
    await writeSent();

    const page = await listAuditLog({ recordId: RECORD_ID, eventType: 'email_sent' });

    // Safe: the filter matches the one entry written above.
    expect(recipients(page.data[0]!.new_value)).toEqual(MASKED);
  });

  it('masks them in a live notification', async () => {
    const masked = await maskAuditEvent({
      id: 'n-1',
      record_type: 'connected_account',
      record_id: RECORD_ID,
      record_name: 'mailbox@example.com',
      event_type: 'email_sent',
      field_name: 'email_message',
      old_value: null,
      new_value: JSON.stringify({ to: [ERASED], cc: [] }),
      changed_by_id: ACTOR.id,
      changed_by_name: ACTOR.name,
      source: null,
      created_at: new Date().toISOString(),
    });

    expect(recipients(masked.new_value)).toEqual({ to: ['[GDPR deleted]'], cc: [] });
  });

  it.each([
    ['text that is not JSON', 'to: erased-subject@example.net'],
    ['a JSON array', JSON.stringify(['erased-subject@example.net'])],
    ['JSON null', 'null'],
  ])('shows %s as stored, since masking cannot read it', async (_label, value) => {
    const masked = await maskAuditEvent({
      id: 'n-2',
      record_type: 'connected_account',
      record_id: RECORD_ID,
      record_name: null,
      event_type: 'email_sent',
      field_name: 'email_message',
      old_value: null,
      new_value: value,
      changed_by_id: ACTOR.id,
      changed_by_name: ACTOR.name,
      source: null,
      created_at: new Date().toISOString(),
    });
    expect(masked.new_value).toBe(value);
  });

  it("masks an unconfirmed send's recipients as it does a sent one's", async () => {
    const masked = await maskAuditEvent({
      id: 'n-4',
      record_type: 'connected_account',
      record_id: RECORD_ID,
      record_name: null,
      event_type: 'email_send_unconfirmed',
      field_name: 'email_message',
      old_value: null,
      new_value: JSON.stringify({ to: [ERASED], cc: [] }),
      changed_by_id: ACTOR.id,
      changed_by_name: ACTOR.name,
      source: null,
      created_at: new Date().toISOString(),
    });
    expect(recipients(masked.new_value)).toEqual({ to: ['[GDPR deleted]'], cc: [] });
  });

  it('leaves a value alone whose recipient lists are not lists', async () => {
    const value = JSON.stringify({ to: ERASED, cc: null });
    const masked = await maskAuditEvent({
      id: 'n-5',
      record_type: 'connected_account',
      record_id: RECORD_ID,
      record_name: null,
      event_type: 'email_sent',
      field_name: 'email_message',
      old_value: null,
      new_value: value,
      changed_by_id: ACTOR.id,
      changed_by_name: ACTOR.name,
      source: null,
      created_at: new Date().toISOString(),
    });
    expect(masked.new_value).toBe(value);
  });

  it('logs a value that is not JSON, so an unmasked one is never silent', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    try {
      await maskAuditEvent({
        id: 'n-3',
        record_type: 'connected_account',
        record_id: RECORD_ID,
        record_name: null,
        event_type: 'email_sent',
        field_name: 'email_message',
        old_value: null,
        new_value: 'not json',
        changed_by_id: ACTOR.id,
        changed_by_name: ACTOR.name,
        source: null,
        created_at: new Date().toISOString(),
      });
      expect(warn).toHaveBeenCalledWith(
        { auditId: 'n-3' },
        expect.stringContaining('left unmasked'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves values of other event types alone', async () => {
    const client = await pool.connect();
    try {
      await writeAuditEntry(client, {
        recordType: 'connected_account',
        recordId: RECORD_ID,
        eventType: 'updated',
        fieldName: 'Excluded Domains',
        newValue: JSON.stringify({ to: [ERASED] }),
        changedById: ACTOR.id,
        changedByName: ACTOR.name,
      });
    } finally {
      client.release();
    }

    const [entry] = await getRecordAuditLog({
      recordType: 'connected_account',
      recordId: RECORD_ID,
      all: true,
    });

    // Safe: the newest entry is the one written above.
    expect(entry!.new_value).toContain(ERASED);
  });
});
