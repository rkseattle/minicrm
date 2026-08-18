/**
 * Integration tests for auditEventBus and maskAuditEvent.
 *
 * Covers:
 *  - auditEventBus emits 'audit_event' on an audit_log INSERT
 *  - auditEventBus.stop() releases the connection without throwing
 *  - auditEventBus does not consume a pool connection (pool idle count unchanged)
 *  - maskAuditEvent returns the event unchanged when record has no GDPR erasure
 *  - maskAuditEvent replaces old_value/new_value with '[GDPR deleted]' for erased records
 *  - maskAuditEvent preserves null old_value/new_value as null after erasure
 */

import 'dotenv/config';
import pool from '../db.js';
import { auditEventBus, type AuditNotification } from '../services/auditEventBus.js';
import { maskAuditEvent, writeAuditEntry } from '../services/auditService.js';
import { createUser } from '../services/userService.js';

const FILE_PREFIX = 'audit-event-bus';
// Each test uses its own RECORD_ID to prevent LISTEN notifications from one
// test bleeding into another test's event handler during the timing window.
const RECORD_ID_EMIT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
const RECORD_ID_NOEMIT = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02';
const RECORD_ID_GDPR = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ACTOR_ID = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0';
const ACTOR_NAME = 'EventBus Test Actor';

let requestedById: string;

beforeAll(async () => {
  // Clean up any leftover rows from failed prior runs.
  // gdpr_deletion_log references users via FK, so delete it first.
  const prior = await pool.query<{ id: string }>('SELECT id FROM users WHERE email LIKE $1', [
    `${FILE_PREFIX}-%`,
  ]);
  for (const row of prior.rows) {
    await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [row.id]);
  }
  await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = ANY($1::uuid[])', [
    [RECORD_ID_EMIT, RECORD_ID_NOEMIT, RECORD_ID_GDPR],
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  // Create a real user to satisfy gdpr_deletion_log.requested_by FK
  const user = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'EventBus Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  requestedById = user.id;

  await auditEventBus.start(pool);
});

beforeEach(async () => {
  await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = ANY($1::uuid[])', [
    [RECORD_ID_EMIT, RECORD_ID_NOEMIT, RECORD_ID_GDPR],
  ]);
});

afterAll(async () => {
  await auditEventBus.stop();
  // Delete gdpr_deletion_log rows before the user to satisfy the FK constraint.
  if (requestedById) {
    await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [requestedById]);
  }
  await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = ANY($1::uuid[])', [
    [RECORD_ID_EMIT, RECORD_ID_NOEMIT, RECORD_ID_GDPR],
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  // Rows in audit_log keyed by RECORD_ID / ACTOR_ID are harmless to other test files
  // (unique IDs ensure no cross-file query contamination). Skip the DISABLE TRIGGER
  // dance to avoid the inter-file race condition on audit_log_no_modify.
  await pool.end();
});

// ── emit on INSERT ─────────────────────────────────────────────────────────────

/**
 * Returns a promise that resolves when auditEventBus emits an 'audit_event' whose
 * record_id matches the given id. Filters out unrelated events from parallel tests.
 */
function waitForEvent(recordId: string, timeoutMs: number): Promise<AuditNotification> {
  return new Promise<AuditNotification>((resolve, reject) => {
    const timer = setTimeout(() => {
      auditEventBus.removeListener('audit_event', handler);
      reject(new Error(`audit_event for record_id=${recordId} not emitted within ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(event: AuditNotification): void {
      if (event.record_id !== recordId) return;
      clearTimeout(timer);
      auditEventBus.removeListener('audit_event', handler);
      resolve(event);
    }

    auditEventBus.on('audit_event', handler);
  });
}

describe('auditEventBus', () => {
  // 5s, raised from 100ms. What this test exists to prove is that the
  // LISTEN/NOTIFY bus emits AT ALL on an audit_log INSERT — the millisecond
  // figure was an arbitrary test-local bound, not a product SLA (no 100ms
  // requirement exists in docs/ or auditEventBus.ts). It takes ~15ms on an idle
  // machine, but it is a real Postgres round-trip running in the `parallel`
  // project alongside five other DB-bound workers, and on a contended CI runner
  // it exceeded 100ms and failed the job (PR #369).
  //
  // A latency assertion that fails under load is testing the runner, not the
  // bus. The generous ceiling still catches the regression that matters — a bus
  // that never emits — while a genuine latency budget, if one is ever wanted,
  // belongs in a perf test with a controlled environment rather than here.
  it('emits audit_event on an audit_log INSERT', async () => {
    const eventPromise = waitForEvent(RECORD_ID_EMIT, 5_000);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID_EMIT,
        recordName: 'EventBus Subject',
        eventType: 'updated',
        fieldName: 'First Name',
        oldValue: 'Before',
        newValue: 'After',
        changedById: ACTOR_ID,
        changedByName: ACTOR_NAME,
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const event = await eventPromise;
    expect(event.record_type).toBe('contact');
    expect(event.record_id).toBe(RECORD_ID_EMIT);
    expect(event.event_type).toBe('updated');
    expect(event.field_name).toBe('First Name');
    expect(event.old_value).toBe('Before');
    expect(event.new_value).toBe('After');
    expect(event.changed_by_id).toBe(ACTOR_ID);
    expect(event.changed_by_name).toBe(ACTOR_NAME);
  });

  it('does not emit for a rolled-back transaction', async () => {
    let emittedForRecord = false;

    function handler(event: AuditNotification): void {
      if (event.record_id === RECORD_ID_NOEMIT) emittedForRecord = true;
    }
    auditEventBus.on('audit_event', handler);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await writeAuditEntry(client, {
        recordType: 'contact',
        recordId: RECORD_ID_NOEMIT,
        recordName: 'Rollback Subject',
        eventType: 'created',
        changedById: ACTOR_ID,
        changedByName: ACTOR_NAME,
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Wait a brief window and confirm no event fired for this record
    await new Promise((resolve) => setTimeout(resolve, 80));
    auditEventBus.removeListener('audit_event', handler);
    expect(emittedForRecord).toBe(false);
  });

  it('stop() does not throw when called while connected', async () => {
    // The shared bus is running; stop it and restart so the afterAll hook still works.
    await expect(auditEventBus.stop()).resolves.toBeUndefined();
    await auditEventBus.start(pool);
  });

  it('stop() is a no-op when already stopped', async () => {
    await auditEventBus.stop();
    await expect(auditEventBus.stop()).resolves.toBeUndefined();
    // Restart so subsequent tests and afterAll are not affected
    await auditEventBus.start(pool);
  });
});

// ── maskAuditEvent ─────────────────────────────────────────────────────────────

describe('maskAuditEvent', () => {
  const baseEvent: AuditNotification = {
    id: '11111111-1111-1111-1111-111111111111',
    record_type: 'contact',
    record_id: RECORD_ID_GDPR,
    record_name: 'Test Subject',
    event_type: 'updated',
    field_name: 'First Name',
    old_value: 'Alice',
    new_value: 'Alicia',
    changed_by_id: ACTOR_ID,
    changed_by_name: ACTOR_NAME,
    source: null,
    created_at: new Date().toISOString(),
  };

  it('returns the event unchanged when no GDPR erasure exists', async () => {
    const result = await maskAuditEvent(baseEvent);
    expect(result).toEqual(baseEvent);
  });

  it('returns the event unchanged when record_id is null', async () => {
    const nullIdEvent: AuditNotification = { ...baseEvent, record_id: null };
    const result = await maskAuditEvent(nullIdEvent);
    expect(result).toEqual(nullIdEvent);
  });

  it('replaces old_value and new_value with [GDPR deleted] for an erased record', async () => {
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at)
       VALUES ($1, $2, $3, $4, now())`,
      ['contact', RECORD_ID_GDPR, requestedById, ['first_name']],
    );

    const result = await maskAuditEvent(baseEvent);
    expect(result.old_value).toBe('[GDPR deleted]');
    expect(result.new_value).toBe('[GDPR deleted]');
    // Other fields must be untouched
    expect(result.record_id).toBe(RECORD_ID_GDPR);
    expect(result.field_name).toBe('First Name');
  });

  it('preserves null old_value/new_value as null after erasure', async () => {
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope, completed_at)
       VALUES ($1, $2, $3, $4, now())`,
      ['contact', RECORD_ID_GDPR, requestedById, ['first_name']],
    );

    const nullValuesEvent: AuditNotification = {
      ...baseEvent,
      old_value: null,
      new_value: null,
    };
    const result = await maskAuditEvent(nullValuesEvent);
    expect(result.old_value).toBeNull();
    expect(result.new_value).toBeNull();
  });

  it('does not mask when gdpr_deletion_log row exists but completed_at is null', async () => {
    await pool.query(
      `INSERT INTO gdpr_deletion_log
         (record_type, record_id, requested_by, erasure_scope)
       VALUES ($1, $2, $3, $4)`,
      ['contact', RECORD_ID_GDPR, requestedById, ['first_name']],
    );

    const result = await maskAuditEvent(baseEvent);
    expect(result.old_value).toBe('Alice');
    expect(result.new_value).toBe('Alicia');
  });
});
