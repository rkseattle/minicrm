/**
 * Integration tests for gdprService.
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
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import logger from '../logger.js';
import * as sentry from '../sentry.js';
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
  getAiCascadeLogForRecord,
  getOriginalPiiFromCascadeLog,
  hasGdprErasureForRecord,
} from '../services/gdprService.js';
import { uid, clearAuditLogFor } from './testUtils.js';

const FILE_PREFIX = 'gdpr-svc';

// ── Fixtures ───────────────────────────────────────────────────────────────────

let adminId: string;
let adminActor: { id: string; name: string };

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
  await clearAuditLogFor(adminId);
});

afterAll(async () => {
  await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [adminId]);
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
  await clearAuditLogFor(adminId);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Waits for the fire-and-forget AI cascade to write its log row.
 *
 * eraseContact/eraseLead return before the cascade runs, so polling the log is
 * the only way to observe completion without reaching into the promise.
 */
async function waitForCascade(recordId: string, recordType: 'contact' | 'lead'): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await getAiCascadeLogForRecord(recordId, recordType);
    if (rows.length > 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`cascade log row never appeared for ${recordType} ${recordId}`);
}

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

  it('cascades to AI data, redacting the lead name and email from ai_messages', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    const created = await pool.query<{
      first_name: string;
      last_name: string | null;
      email: string;
    }>('SELECT first_name, last_name, email FROM leads WHERE id = $1', [lead.id]);
    const leadName = [created.rows[0].first_name, created.rows[0].last_name]
      .filter(Boolean)
      .join(' ');
    const leadEmail = created.rows[0].email;

    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, $2) RETURNING id`,
      [adminId, `Session about ${leadName}`],
    );
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [session.rows[0].id, `Follow up with ${leadName} at ${leadEmail} tomorrow`],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    const messages = await pool.query<{ content: string }>(
      'SELECT content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    expect(messages.rows[0].content).not.toContain(leadEmail);
    expect(messages.rows[0].content).not.toContain(leadName);
    expect(messages.rows[0].content).toContain('[redacted]');

    const log = await getAiCascadeLogForRecord(lead.id, 'lead');
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe('completed');
    expect(log[0].messages_redacted).toBe(1);
    // A lead row carries no contact_id, so a contact-keyed reader cannot see it.
    expect(log[0].contact_id).toBeNull();

    await pool.query('DELETE FROM ai_messages WHERE session_id = $1', [session.rows[0].id]);
    await pool.query('DELETE FROM ai_sessions WHERE id = $1', [session.rows[0].id]);
  });

  it('survives an oversized lead name rather than aborting the whole cascade', async () => {
    // leads.first_name is unbounded text, and a value this size is insertable.
    // Unbounded in the pattern it contributes to "regular expression is too
    // complex", which aborts every term at once — name, email, and notes —
    // while the erasure still reports success.
    const hugeName = 'A'.repeat(6_000);
    const lead = await createLead(
      { ...makeLead(), owner_id: adminId, first_name: hugeName },
      adminActor,
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    const rows = await getAiCascadeLogForRecord(lead.id, 'lead');
    expect(rows).toHaveLength(1);
    // The email still identifies the subject, so the cascade proceeds on it.
    expect(rows[0].status).toBe('completed');
  });

  it('logs when a free-text field is outside the searchable length bounds', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const lead = await createLead(
      { ...makeLead(), owner_id: adminId, company_name: 'Acme' },
      adminActor,
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    // "Acme" is below the minimum, so it is never searched — references to it
    // survive an erasure whose cascade row still reads completed.
    // The full string, not a substring: docs/gdpr.md tells a DPO to grep for it,
    // and a reworded message would leave that instruction pointing at nothing.
    const skipped = warnSpy.mock.calls.filter(
      ([, message]) =>
        message === 'gdpr: cascade skipped identifiers outside the searchable length bounds',
    );
    expect(skipped.length).toBeGreaterThan(0);

    const gdprDoc = readFileSync(resolve(__dirname, '../../../docs/gdpr.md'), 'utf8');
    expect(
      gdprDoc.replace(/\s+/g, ' '),
      'docs/gdpr.md must quote the message the code actually logs',
    ).toContain('gdpr: cascade skipped identifiers outside the searchable length bounds');
    warnSpy.mockRestore();
  });

  it('redacts the free-text lead fields it scrubs from the row', async () => {
    const distinctiveNotes = 'Budget approved by the steering committee';
    const distinctiveCompany = 'Trellis Industrial Holdings, Inc.';
    const lead = await createLead(
      {
        ...makeLead(),
        owner_id: adminId,
        company_name: distinctiveCompany,
        notes: distinctiveNotes,
      },
      adminActor,
    );

    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, 'Lead notes session') RETURNING id`,
      [adminId],
    );
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
      [session.rows[0].id, `Context: ${distinctiveNotes}. Account: ${distinctiveCompany}.`],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    // The company name ends in punctuation: \M asserts adjacency to a word
    // character, so anchoring both ends unconditionally would match nothing here
    // while still reporting a completed cascade.
    // erasure_scope claims notes and company_name are erased; the AI copies must go too.
    const messages = await pool.query<{ content: string }>(
      'SELECT content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    expect(messages.rows[0].content).not.toContain(distinctiveNotes);
    expect(messages.rows[0].content).not.toContain(distinctiveCompany);

    await pool.query('DELETE FROM ai_messages WHERE session_id = $1', [session.rows[0].id]);
    await pool.query('DELETE FROM ai_sessions WHERE id = $1', [session.rows[0].id]);
  });

  it('ignores a free-text value too generic to identify anyone', async () => {
    // "Follow up" is a phrase, not an identity. Word boundaries do not help:
    // it matches the same phrase in every other user's messages.
    const lead = await createLead(
      { ...makeLead(), owner_id: adminId, notes: 'Follow up' },
      adminActor,
    );

    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, 'Generic phrase session') RETURNING id`,
      [adminId],
    );
    const bystanderText = 'Please follow up with the vendor next week';
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [session.rows[0].id, bystanderText],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    const messages = await pool.query<{ content: string }>(
      'SELECT content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    expect(messages.rows[0].content).toBe(bystanderText);

    await pool.query('DELETE FROM ai_messages WHERE session_id = $1', [session.rows[0].id]);
    await pool.query('DELETE FROM ai_sessions WHERE id = $1', [session.rows[0].id]);
  });

  it('anchors a non-ASCII name so it does not match as a substring', async () => {
    // JavaScript's \w is ASCII-only, so "李明" tested false at both ends and
    // went into the pattern unanchored — matching inside longer words across
    // every user's AI data. Postgres itself treats these as word characters.
    const lead = await createLead(
      { ...makeLead(), owner_id: adminId, first_name: '李明', last_name: undefined },
      adminActor,
    );

    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, 'Unicode bystander') RETURNING id`,
      [adminId],
    );
    // Contains the erased name as a substring, but is a different person.
    const bystanderText = '李明华 attended the review';
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [session.rows[0].id, bystanderText],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    const messages = await pool.query<{ content: string }>(
      'SELECT content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    expect(messages.rows[0].content).toBe(bystanderText);

    await pool.query('DELETE FROM ai_messages WHERE session_id = $1', [session.rows[0].id]);
    await pool.query('DELETE FROM ai_sessions WHERE id = $1', [session.rows[0].id]);
  });

  it('matches a short name on word boundaries, not as a substring', async () => {
    // first_name.min(1) permits a one-character lead name, and the cascade has no
    // ownership predicate to narrow what it scans. Word boundaries are what keep
    // "A" from rewriting every word containing the letter.
    const lead = await createLead(
      { ...makeLead(), owner_id: adminId, first_name: 'A', last_name: undefined },
      adminActor,
    );

    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, 'Bystander session') RETURNING id`,
      [adminId],
    );
    const bystanderText = 'Quarterly planning notes for Acme, an annual ritual';
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [session.rows[0].id, bystanderText],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO user_ai_context (user_id, key, value) VALUES ($1, $2, 'unrelated context value')
       RETURNING id`,
      [adminId, `${FILE_PREFIX}-short-name`],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    // "Acme" and "annual" contain the letter but are not the name.
    const messages = await pool.query<{ content: string }>(
      'SELECT content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    expect(messages.rows[0].content).toBe(bystanderText);
    const sessionRow = await pool.query<{ name: string }>(
      'SELECT name FROM ai_sessions WHERE id = $1',
      [session.rows[0].id],
    );
    expect(sessionRow.rows[0].name).toBe('Bystander session');
    const contextRows = await pool.query('SELECT id FROM user_ai_context WHERE id = $1', [
      context.rows[0].id,
    ]);
    expect(contextRows.rows).toHaveLength(1);

    await pool.query('DELETE FROM user_ai_context WHERE id = $1', [context.rows[0].id]);
    await pool.query('DELETE FROM ai_messages WHERE session_id = $1', [session.rows[0].id]);
    await pool.query('DELETE FROM ai_sessions WHERE id = $1', [session.rows[0].id]);
  });

  it('escalates a cascade failure to Sentry and still records the failed row', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    const captureSpy = vi.spyOn(sentry, 'captureException');
    const connectSpy = vi.spyOn(pool, 'connect');
    try {
      // Fails inside the transaction, then fails the ROLLBACK too: without the
      // guard the rollback error escapes and no failure row is ever written.
      connectSpy.mockResolvedValueOnce({
        // Only query and release are reached on this path.
        query: async (sql: string) => {
          if (/ai_messages/i.test(sql)) throw new Error('simulated redaction failure');
          if (/ROLLBACK/i.test(sql)) throw new Error('connection already gone');
          return { rows: [], rowCount: 0 };
        },
        release: () => {},
      } as never);

      // Fire-and-forget contract: the caller never learns the cascade failed.
      await expect(
        cascadeGdprErasureToAiData(lead.id, 'lead', 'Failure Path', 'fail@example.com', adminActor),
      ).resolves.toBeUndefined();

      const rows = await getAiCascadeLogForRecord(lead.id, 'lead');
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('failed');
      expect(rows[0].error_detail).toContain('simulated redaction failure');

      // An incomplete Art. 17 erasure is a compliance incident; nothing else
      // escalates one, so a log line alone would leave it unnoticed.
      const escalated = captureSpy.mock.calls.map(([err]) =>
        err instanceof Error ? err.message : String(err),
      );
      expect(escalated).toContain('simulated redaction failure');
    } finally {
      connectSpy.mockRestore();
      captureSpy.mockRestore();
    }
  });

  it('records a failed row when the caller supplies no searchable identifier', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(lead.id, 'lead', null, null, adminActor);
    await waitForCascade(lead.id, 'lead');

    const rows = await getAiCascadeLogForRecord(lead.id, 'lead');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error_detail).toContain('non-empty PII identifier');
  });

  it("leaves another user's AI data untouched when erasing a lead", async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);

    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, 'Unrelated session') RETURNING id`,
      [adminId],
    );
    const bystanderText = 'Quarterly planning notes with no lead PII in them';
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [session.rows[0].id, bystanderText],
    );
    const context = await pool.query<{ id: string }>(
      `INSERT INTO user_ai_context (user_id, key, value) VALUES ($1, $2, $3) RETURNING id`,
      [adminId, `${FILE_PREFIX}-bystander`, bystanderText],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    // The cascade's searches carry no ownership predicate, so anything it
    // matches is destroyed for every user. This asserts an unrelated row
    // survives an erasure whose terms do not appear in it.
    const messages = await pool.query<{ content: string }>(
      'SELECT content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    expect(messages.rows[0].content).toBe(bystanderText);
    const contextRows = await pool.query('SELECT id FROM user_ai_context WHERE id = $1', [
      context.rows[0].id,
    ]);
    expect(contextRows.rows).toHaveLength(1);

    await pool.query('DELETE FROM user_ai_context WHERE id = $1', [context.rows[0].id]);
    await pool.query('DELETE FROM ai_messages WHERE session_id = $1', [session.rows[0].id]);
    await pool.query('DELETE FROM ai_sessions WHERE id = $1', [session.rows[0].id]);
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

// ── hasGdprErasureForRecord ───────────────────────────────────────────────────

describe('hasGdprErasureForRecord', () => {
  it('returns false for a contact that has not been erased', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const result = await hasGdprErasureForRecord(contact.id, 'contact');
    expect(result).toBe(false);
  });

  it('returns true after the contact has been erased', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await eraseContact(contact.id, adminActor);
    const result = await hasGdprErasureForRecord(contact.id, 'contact');
    expect(result).toBe(true);
  });
});

// ── cascadeGdprErasureToAiData ─────────────────────────────────────────────────

describe('cascadeGdprErasureToAiData', () => {
  beforeEach(async () => {
    await pool.query(
      // Keyed on the actor, not on a subquery over tables this same hook deletes:
      // the cascade is fire-and-forget, so its INSERT often lands after the
      // subquery has run and the parent row is already gone.
      `DELETE FROM ai_gdpr_cascade_log WHERE triggered_by = $1`,
      [adminId],
    );
    await pool.query('DELETE FROM ai_sessions WHERE user_id = $1', [adminId]);
  });

  it('writes a completed log entry and NULLs out original PII on success', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(
      contact.id,
      'contact',
      'Alice Erasure',
      `${FILE_PREFIX}-cascade-test@example.com`,
      adminActor,
    );

    const rows = await getAiCascadeLogForRecord(contact.id, 'contact');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].messages_redacted).toBe(0);
    expect(rows[0].context_entries_removed).toBe(0);
    // PII must be cleared after a successful cascade (GDPR Art. 17). Read from
    // the table directly: the reader deliberately never returns these columns.
    const stored = await pool.query<{
      original_name: string | null;
      original_email: string | null;
    }>('SELECT original_name, original_email FROM ai_gdpr_cascade_log WHERE record_id = $1', [
      contact.id,
    ]);
    expect(stored.rows[0].original_name).toBeNull();
    expect(stored.rows[0].original_email).toBeNull();
  });

  it('records the erased record type, keeping contact_id in step with record_id', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(
      contact.id,
      'contact',
      'Alice Erasure',
      `${FILE_PREFIX}-record-type@example.com`,
      adminActor,
    );

    const rows = await getAiCascadeLogForRecord(contact.id, 'contact');
    expect(rows).toHaveLength(1);
    expect(rows[0].record_type).toBe('contact');
    expect(rows[0].record_id).toBe(contact.id);
    // contact_id is retained for readers that predate the lead cascade.
    expect(rows[0].contact_id).toBe(contact.id);
  });

  it('keeps a lead row out of the contact reader and out of the legacy contact column', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    // A lead cascade row, written the way the lead path will write it. Its
    // record_id deliberately reuses the contact's id: the discriminator, not the
    // id, is what must keep the two apart.
    await pool.query(
      `INSERT INTO ai_gdpr_cascade_log (record_type, record_id, contact_id, original_email)
       VALUES ('lead', $1, NULL, $2)`,
      [contact.id, `${FILE_PREFIX}-lead-pii@example.com`],
    );

    const rows = await getAiCascadeLogForRecord(contact.id, 'contact');

    expect(rows).toHaveLength(0);
    // A legacy reader keyed on contact_id must never surface another subject's PII.
    const legacy = await pool.query(
      'SELECT original_email FROM ai_gdpr_cascade_log WHERE contact_id = $1',
      [contact.id],
    );
    expect(legacy.rows).toHaveLength(0);
  });

  it('writes a completed audit entry for the contact record', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(
      contact.id,
      'contact',
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

// ── getAiCascadeLogForRecord ──────────────────────────────────────────────────

describe('getAiCascadeLogForRecord', () => {
  it('returns empty array when no cascade has been run', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const rows = await getAiCascadeLogForRecord(contact.id, 'contact');
    expect(rows).toHaveLength(0);
  });

  it('returns rows ordered newest-first after multiple cascade runs', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await cascadeGdprErasureToAiData(contact.id, 'contact', 'Alice', 'a@example.com', adminActor);
    await cascadeGdprErasureToAiData(contact.id, 'contact', 'Alice', 'a@example.com', adminActor);

    const rows = await getAiCascadeLogForRecord(contact.id, 'contact');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Newest first
    expect(new Date(rows[0].triggered_at).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[1].triggered_at).getTime(),
    );
  });
});

// ── getOriginalPiiFromCascadeLog ───────────────────────────────────────────────

describe('getOriginalPiiFromCascadeLog', () => {
  beforeEach(async () => {
    await pool.query(
      // Keyed on the actor, not on a subquery over tables this same hook deletes:
      // the cascade is fire-and-forget, so its INSERT often lands after the
      // subquery has run and the parent row is already gone.
      `DELETE FROM ai_gdpr_cascade_log WHERE triggered_by = $1`,
      [adminId],
    );
  });

  it('returns null when no cascade log entry exists', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const result = await getOriginalPiiFromCascadeLog(contact.id, 'contact');
    expect(result).toBeNull();
  });

  it('returns null after a successful cascade (PII is NULLed out on success)', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const name = `Pii-Test-${FILE_PREFIX}`;
    const email = `${FILE_PREFIX}-pii@example.com`;

    await cascadeGdprErasureToAiData(contact.id, 'contact', name, email, adminActor);

    // Successful cascade must NULL out original_name/email — PII must not persist.
    const result = await getOriginalPiiFromCascadeLog(contact.id, 'contact');
    expect(result).toBeNull();
  });

  it('returns original PII from a failed log row so a re-run can use it', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const name = `Pii-ReRun-${FILE_PREFIX}`;
    const email = `${FILE_PREFIX}-rerun@example.com`;

    // Insert a failed cascade log row directly (simulating a failed cascade).
    await pool.query(
      `INSERT INTO ai_gdpr_cascade_log
         (record_type, record_id, contact_id, triggered_by, messages_redacted,
          context_entries_removed, status, error_detail, original_name, original_email)
       VALUES ('contact', $1, $1, $2, 0, 0, 'failed', 'simulated failure', $3, $4)`,
      [contact.id, adminId, name, email],
    );

    const result = await getOriginalPiiFromCascadeLog(contact.id, 'contact');
    expect(result).not.toBeNull();
    expect(result?.original_name).toBe(name);
    expect(result?.original_email).toBe(email);
  });
});

// ── cascadeGdprErasureToAiData — empty name guard ──────────────────────────────

describe('cascadeGdprErasureToAiData empty-name guard', () => {
  beforeEach(async () => {
    await pool.query(
      // Keyed on the actor, not on a subquery over tables this same hook deletes:
      // the cascade is fire-and-forget, so its INSERT often lands after the
      // subquery has run and the parent row is already gone.
      `DELETE FROM ai_gdpr_cascade_log WHERE triggered_by = $1`,
      [adminId],
    );
    await pool.query('DELETE FROM user_ai_context WHERE user_id = $1', [adminId]);
  });

  it('does not delete all user_ai_context rows when contactName is empty', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    // Seed a context entry that should NOT be deleted
    const email = `keep-me-${FILE_PREFIX}@example.com`;
    await pool.query(
      `INSERT INTO user_ai_context (user_id, key, value) VALUES ($1, 'keep', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [adminId, 'unrelated context value'],
    );

    // Cascade with empty name — previously this would produce ILIKE '%%' and wipe all rows
    await cascadeGdprErasureToAiData(contact.id, 'contact', '', email, adminActor);

    const remaining = await pool.query(
      `SELECT id FROM user_ai_context WHERE user_id = $1 AND key = 'keep'`,
      [adminId],
    );
    expect(remaining.rows).toHaveLength(1);
  });
});
