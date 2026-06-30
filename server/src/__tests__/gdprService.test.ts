/**
 * Integration tests for gdprService. (MINCRM-364)
 *
 * Runs against the real PostgreSQL minicrm_test database.
 * Covers:
 *  - eraseContact: overwrites PII fields and writes a completed gdpr_deletion_log row
 *  - eraseContact: returns GDPR_ALREADY_ERASED on a second call
 *  - eraseLead: overwrites PII fields and writes a completed gdpr_deletion_log row
 *  - Audit log masking: getRecordAuditLog returns '[GDPR deleted]' after erasure
 *  - getGdprExportForContact: returns the associated data
 *  - listGdprDeletions: returns paginated rows
 *  - getGdprStatusForRecord: returns the log row or null
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createLead } from '../services/leadsService.js';
import { getRecordAuditLog } from '../services/auditService.js';
import {
  eraseContact,
  eraseLead,
  getGdprExportForContact,
  listGdprDeletions,
  getGdprStatusForRecord,
  cascadeGdprErasureToAiData,
  getAiCascadeLogForContact,
  hasGdprErasureForContact,
} from '../services/gdprService.js';
import { uid } from './testUtils.js';

const FILE_PREFIX = 'gdpr-svc';

// ── Fixtures ───────────────────────────────────────────────────────────────────

let adminId: string;
let adminActor: { id: string; name: string };

/**
 * Deletes audit_log rows scoped to this test file, bypassing the append-only trigger.
 * All three statements run on the same connection so the session-level DISABLE takes effect.
 */
async function clearAuditLog(actorId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await client.query('DELETE FROM audit_log WHERE changed_by_id = $1', [actorId]);
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  // Clean up any leftover rows from failed prior runs
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'GDPR Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminActor = { id: adminId, name: admin.name };
});

beforeEach(async () => {
  // Wipe gdpr_deletion_log rows tied to this admin so each test starts clean.
  // gdpr_deletion_log has a unique index on (record_type, record_id), so without
  // clearing it, repeated erasure tests on the same record would fail unexpectedly.
  // Leads and contacts are also cleared since each test creates fresh records.
  await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [adminId]);
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
  // Audit log cleanup uses a single connection to ensure DISABLE TRIGGER takes effect.
  await clearAuditLog(adminId);
});

afterAll(async () => {
  await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [adminId]);
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
  await clearAuditLog(adminId);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeContact() {
  return {
    first_name: 'Alice',
    last_name: 'Erasure',
    email: `${FILE_PREFIX}-${uid()}@example.com`,
    phone: '+1-555-0199',
    title: 'VP Privacy',
    department: 'Legal',
  };
}

function makeLead() {
  return {
    first_name: 'Bob',
    last_name: 'Erasure',
    email: `${FILE_PREFIX}-lead-${uid()}@example.com`,
    phone: '+1-555-0200',
    company_name: 'Acme Corp',
    notes: 'Found via website',
  };
}

// ── eraseContact ───────────────────────────────────────────────────────────────

describe('eraseContact', () => {
  it('overwrites PII fields on the contact and writes a completed gdpr_deletion_log row', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    const logRow = await eraseContact(contact.id, adminActor, 'Test erasure request');

    expect(logRow.record_type).toBe('contact');
    expect(logRow.record_id).toBe(contact.id);
    expect(logRow.requested_by).toBe(adminId);
    expect(logRow.completed_at).not.toBeNull();
    expect(logRow.erasure_scope).toContain('first_name');
    expect(logRow.erasure_scope).toContain('last_name');
    expect(logRow.erasure_scope).toContain('phone');
    // email is handled via a synthetic replacement, not listed in erasure_scope
    expect(logRow.notes).toBe('Test erasure request');

    // Verify the contact row was actually overwritten
    const result = await pool.query<{
      first_name: string;
      last_name: string;
      email: string;
      phone: string | null;
      title: string | null;
      department: string | null;
    }>(
      'SELECT first_name, last_name, email, phone, title, department FROM contacts WHERE id = $1',
      [contact.id],
    );
    const row = result.rows[0];
    expect(row.first_name).toBe('[GDPR deleted]');
    expect(row.last_name).toBe('[GDPR deleted]');
    expect(row.email).toMatch(/^gdpr-deleted-.+@gdpr\.invalid$/);
    expect(row.phone).toBeNull();
    expect(row.title).toBeNull();
    expect(row.department).toBeNull();
  });

  it('writes a gdpr_erasure audit entry inside the same transaction', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await eraseContact(contact.id, adminActor);

    // Disable the append-only trigger temporarily to allow us to query
    // (the trigger prevents reads by blocking DELETE/UPDATE — reading is fine)
    const auditRows = await pool.query(
      `SELECT event_type FROM audit_log WHERE record_type = 'contact' AND record_id = $1 AND event_type = 'gdpr_erasure'`,
      [contact.id],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].event_type).toBe('gdpr_erasure');
  });

  it('returns GDPR_ALREADY_ERASED error on a second erasure call', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await eraseContact(contact.id, adminActor);

    await expect(eraseContact(contact.id, adminActor)).rejects.toMatchObject({
      code: 'GDPR_ALREADY_ERASED',
    });
  });

  it('returns NOT_FOUND error for a non-existent contact', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    await expect(eraseContact(fakeId, adminActor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ── eraseLead ─────────────────────────────────────────────────────────────────

describe('eraseLead', () => {
  it('overwrites PII fields on the lead and writes a completed gdpr_deletion_log row', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);

    const logRow = await eraseLead(lead.id, adminActor, 'Lead erasure test');

    expect(logRow.record_type).toBe('lead');
    expect(logRow.record_id).toBe(lead.id);
    expect(logRow.requested_by).toBe(adminId);
    expect(logRow.completed_at).not.toBeNull();
    expect(logRow.erasure_scope).toContain('first_name');
    expect(logRow.erasure_scope).toContain('phone');
    expect(logRow.notes).toBe('Lead erasure test');

    const result = await pool.query<{
      first_name: string;
      last_name: string | null;
      email: string;
      phone: string | null;
      company_name: string | null;
      notes: string | null;
    }>('SELECT first_name, last_name, email, phone, company_name, notes FROM leads WHERE id = $1', [
      lead.id,
    ]);
    const row = result.rows[0];
    expect(row.first_name).toBe('[GDPR deleted]');
    expect(row.last_name).toBeNull();
    expect(row.email).toMatch(/^gdpr-deleted-.+@gdpr\.invalid$/);
    expect(row.phone).toBeNull();
    expect(row.company_name).toBeNull();
    expect(row.notes).toBeNull();
  });

  it('returns GDPR_ALREADY_ERASED error on a second erasure call', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);

    await eraseLead(lead.id, adminActor);

    await expect(eraseLead(lead.id, adminActor)).rejects.toMatchObject({
      code: 'GDPR_ALREADY_ERASED',
    });
  });

  it('returns NOT_FOUND error for a non-existent lead', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000098';
    await expect(eraseLead(fakeId, adminActor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// ── Audit log masking ─────────────────────────────────────────────────────────

describe('audit log masking after contact erasure', () => {
  it('returns [GDPR deleted] for old_value and new_value after erasure', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    // The contact creation already wrote a 'created' audit entry.
    // After erasure the masking JOIN should overwrite old/new values.
    await eraseContact(contact.id, adminActor);

    const auditRows = await getRecordAuditLog({
      recordType: 'contact',
      recordId: contact.id,
      all: true,
    });

    // Every row that has a non-null old_value or new_value should now be masked.
    // The gdpr_erasure event itself stores the erasure note in new_value; after
    // the log row is completed, its own new_value is also masked.
    for (const row of auditRows) {
      if (row.old_value !== null) {
        expect(row.old_value).toBe('[GDPR deleted]');
      }
      if (row.new_value !== null) {
        expect(row.new_value).toBe('[GDPR deleted]');
      }
    }
  });
});

// ── getGdprExportForContact ───────────────────────────────────────────────────

describe('getGdprExportForContact', () => {
  it('returns an export payload containing the contact and associated data keys', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    const exportData = await getGdprExportForContact(contact.id);

    expect(exportData.subject).toBe(contact.id);
    expect(exportData.exported_at).toBeDefined();
    expect(exportData.contact).toBeDefined();
    expect(exportData.contact.id).toBe(contact.id);
    expect(Array.isArray(exportData.activities)).toBe(true);
    expect(Array.isArray(exportData.deals)).toBe(true);
    expect(Array.isArray(exportData.notes)).toBe(true);
    expect(Array.isArray(exportData.custom_fields)).toBe(true);
    expect(Array.isArray(exportData.audit_history)).toBe(true);
    // The 'created' audit entry written by createContact should appear
    expect(exportData.audit_history.length).toBeGreaterThanOrEqual(1);
  });
});

// ── listGdprDeletions ─────────────────────────────────────────────────────────

describe('listGdprDeletions', () => {
  it('returns a paginated list including newly created erasure rows', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await eraseContact(contact.id, adminActor);

    const result = await listGdprDeletions(1, 50);

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.data)).toBe(true);
    const found = result.data.find((row) => row.record_id === contact.id);
    expect(found).toBeDefined();
    expect(found?.completed_at).not.toBeNull();
  });
});

// ── getGdprStatusForRecord ────────────────────────────────────────────────────

describe('getGdprStatusForRecord', () => {
  it('returns null when no erasure has been performed', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    const status = await getGdprStatusForRecord('contact', contact.id);
    expect(status).toBeNull();
  });

  it('returns the deletion log row after erasure', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await eraseContact(contact.id, adminActor);

    const status = await getGdprStatusForRecord('contact', contact.id);
    expect(status).not.toBeNull();
    expect(status?.record_id).toBe(contact.id);
    expect(status?.record_type).toBe('contact');
    expect(status?.completed_at).not.toBeNull();
  });
});

// ── hasGdprErasureForContact ───────────────────────────────────────────────────

describe('hasGdprErasureForContact', () => {
  it('returns false for a contact that has not been erased', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const result = await hasGdprErasureForContact(contact.id);
    expect(result).toBe(false);
  });

  it('returns true after the contact has been erased', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await eraseContact(contact.id, adminActor);
    const result = await hasGdprErasureForContact(contact.id);
    expect(result).toBe(true);
  });
});

// ── cascadeGdprErasureToAiData ─────────────────────────────────────────────────

describe('cascadeGdprErasureToAiData', () => {
  beforeEach(async () => {
    await pool.query(
      'DELETE FROM ai_gdpr_cascade_log WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id = $1)',
      [adminId],
    );
    await pool.query('DELETE FROM ai_sessions WHERE user_id = $1', [adminId]);
  });

  it('writes a completed log entry even when no AI messages reference the contact', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(
      contact.id,
      'Alice Erasure',
      `${FILE_PREFIX}-cascade-test@example.com`,
      adminActor,
    );

    const rows = await getAiCascadeLogForContact(contact.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].messages_redacted).toBe(0);
    expect(rows[0].context_entries_removed).toBe(0);
  });

  it('writes a completed audit entry for the contact record', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(
      contact.id,
      'Alice Erasure',
      `${FILE_PREFIX}-audit-test@example.com`,
      adminActor,
    );

    const auditRows = await getRecordAuditLog({
      recordType: 'contact',
      recordId: contact.id,
      all: true,
    });
    const cascadeEntry = auditRows.find((e) => e.event_type === 'ai_gdpr_cascade');
    expect(cascadeEntry).toBeDefined();
    expect(cascadeEntry?.changed_by_id).toBe(adminId);
  });
});

// ── getAiCascadeLogForContact ──────────────────────────────────────────────────

describe('getAiCascadeLogForContact', () => {
  it('returns empty array when no cascade has been run', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const rows = await getAiCascadeLogForContact(contact.id);
    expect(rows).toHaveLength(0);
  });

  it('returns rows ordered newest-first after multiple cascade runs', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(contact.id, 'Alice', 'a@example.com', adminActor);
    await cascadeGdprErasureToAiData(contact.id, 'Alice', 'a@example.com', adminActor);

    const rows = await getAiCascadeLogForContact(contact.id);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(new Date(rows[0].triggered_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[1].triggered_at).getTime(),
    );
  });
});
