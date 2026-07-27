/**
 * Integration tests for auditPartitionService. (MINCRM-521)
 *
 * Covers:
 *  - auditPartitionName() — correct naming for any month
 *  - ensureAuditLogPartitions() — creates expected partitions
 *  - Idempotency — calling twice produces no duplicates or errors
 *  - Row routing — inserted rows land in the correct child partition, not the default
 *  - Default partition fallback — rows with created_at before the managed range land
 *    in audit_log_default, not in an error state
 */

import 'dotenv/config';
import pool from '../db.js';
import { auditPartitionName, ensureAuditLogPartitions } from '../services/auditPartitionService.js';

/** Fixed record_id used exclusively by this test file to allow targeted cleanup. */
const TEST_RECORD_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

/** Returns all child partition names of audit_log from pg_inherits. */
async function listAuditLogPartitions(): Promise<string[]> {
  const result = await pool.query<{ partition_name: string }>(
    `SELECT child.relname AS partition_name
     FROM pg_inherits
     JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
     JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
     WHERE parent.relname = 'audit_log'
     ORDER BY child.relname`,
  );
  return result.rows.map((r) => r.partition_name);
}

/**
 * Returns the physical child partition table that a given audit_log row lives in.
 * Uses tableoid (system column) to resolve the OID to a relation name.
 */
async function getRowPartition(rowId: string): Promise<string> {
  const result = await pool.query<{ partition: string }>(
    `SELECT c.relname AS partition
     FROM audit_log a
     JOIN pg_class c ON c.oid = a.tableoid
     WHERE a.record_id = $1`,
    [rowId],
  );
  if (result.rows.length === 0) throw new Error(`No audit_log row found with record_id ${rowId}`);
  return result.rows[0].partition;
}

/**
 * Deletes test rows written by this file, bypassing the append-only
 * trigger. Filters by record_id, not changed_by_id, so this can't share
 * testUtils.ts's clearAuditLogFor helper directly — same underlying fix
 * though: all three statements run in one transaction on a single client,
 * since ALTER TABLE ... DISABLE/ENABLE TRIGGER is catalog-level (visible to
 * every concurrent connection, not session-scoped) but takes an ACCESS
 * EXCLUSIVE lock on the table held until COMMIT — that lock serializes any
 * other caller of this same disable/delete/enable sequence (including a
 * different test file's own copy, run concurrently by Vitest against the
 * shared test database) behind this one. See clearAuditLogFor's own
 * docblock for the two claims verified directly against a real Postgres
 * session pair.
 */
async function cleanupTestRows(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await client.query('DELETE FROM audit_log WHERE record_id = $1', [TEST_RECORD_ID]);
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
  await cleanupTestRows();
});

afterAll(async () => {
  await cleanupTestRows();
  await pool.end();
});

// ── auditPartitionName ────────────────────────────────────────────────────────

describe('auditPartitionName', () => {
  it('formats January correctly with zero-padded month', () => {
    const date = new Date('2027-01-15T12:00:00Z');
    expect(auditPartitionName(date)).toBe('audit_log_y2027m01');
  });

  it('formats December correctly', () => {
    const date = new Date('2026-12-01T00:00:00Z');
    expect(auditPartitionName(date)).toBe('audit_log_y2026m12');
  });

  it('is consistent for any day within the same month', () => {
    const first = auditPartitionName(new Date('2026-06-01T00:00:00Z'));
    const mid = auditPartitionName(new Date('2026-06-15T12:00:00Z'));
    const last = auditPartitionName(new Date('2026-06-30T23:59:59Z'));
    expect(first).toBe(mid);
    expect(mid).toBe(last);
  });
});

// ── ensureAuditLogPartitions ──────────────────────────────────────────────────

describe('ensureAuditLogPartitions', () => {
  it('creates the current month and the requested number of future partitions', async () => {
    // The migration already created current + 3 months ahead, so we test that
    // additional months can be requested without error.
    await ensureAuditLogPartitions(5);

    const partitions = await listAuditLogPartitions();
    const now = new Date();

    for (let i = 0; i <= 5; i++) {
      const expected = auditPartitionName(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)),
      );
      expect(partitions).toContain(expected);
    }
  });

  it('is idempotent — calling twice with the same monthsAhead produces no error or duplicates', async () => {
    await ensureAuditLogPartitions(3);
    await ensureAuditLogPartitions(3);

    const partitions = await listAuditLogPartitions();
    const now = new Date();

    for (let i = 0; i <= 3; i++) {
      const expected = auditPartitionName(
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)),
      );
      // Each name should appear exactly once — no duplicates.
      expect(partitions.filter((p) => p === expected)).toHaveLength(1);
    }
  });

  it('always creates audit_log_default as a catch-all partition', async () => {
    const partitions = await listAuditLogPartitions();
    expect(partitions).toContain('audit_log_default');
  });
});

// ── Row routing ───────────────────────────────────────────────────────────────

describe('row routing', () => {
  it('routes a row with the current timestamp to the current month partition', async () => {
    await pool.query(
      `INSERT INTO audit_log
         (record_type, record_id, event_type, changed_by_name)
       VALUES ('contact', $1, 'created', 'Test')`,
      [TEST_RECORD_ID],
    );

    const partition = await getRowPartition(TEST_RECORD_ID);
    const expected = auditPartitionName(new Date());
    expect(partition).toBe(expected);
  });

  it('does not route a current-timestamp row to audit_log_default', async () => {
    await pool.query(
      `INSERT INTO audit_log
         (record_type, record_id, event_type, changed_by_name)
       VALUES ('contact', $1, 'updated', 'Test')`,
      [TEST_RECORD_ID],
    );

    const partition = await getRowPartition(TEST_RECORD_ID);
    expect(partition).not.toBe('audit_log_default');
  });

  it('routes a row with a historical created_at to audit_log_default (pre-partition era)', async () => {
    // A created_at from before the partition era has no matching monthly partition,
    // so it must land in audit_log_default rather than causing an error.
    await pool.query(
      `INSERT INTO audit_log
         (record_type, record_id, event_type, changed_by_name, created_at)
       VALUES ('contact', $1, 'deleted', 'Test', '2020-01-15T00:00:00Z')`,
      [TEST_RECORD_ID],
    );

    const partition = await getRowPartition(TEST_RECORD_ID);
    expect(partition).toBe('audit_log_default');
  });
});

// ── Append-only integrity ─────────────────────────────────────────────────────

describe('append-only trigger on partitioned table', () => {
  it('blocks DELETE on a row in a monthly partition', async () => {
    await pool.query(
      `INSERT INTO audit_log
         (record_type, record_id, event_type, changed_by_name)
       VALUES ('contact', $1, 'created', 'Test')`,
      [TEST_RECORD_ID],
    );

    await expect(
      pool.query('DELETE FROM audit_log WHERE record_id = $1', [TEST_RECORD_ID]),
    ).rejects.toThrow(/append-only/i);

    // Clean up manually after the blocked delete
    await cleanupTestRows();
  });
});
