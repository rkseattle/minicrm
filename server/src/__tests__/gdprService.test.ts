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
import { recordPath } from '@minicrm/shared/types/recordPath.js';
import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';
import * as sentry from '../sentry.js';
import { createUser } from '../services/userService.js';
import { createContact, mergeContacts } from '../services/contactService.js';
import { convertLead, createLead } from '../services/leadsService.js';
import { getRecordAuditLog } from '../services/auditService.js';
import {
  eraseContact,
  eraseLead,
  getGdprExportForContact,
  getGdprExportForLead,
  listGdprDeletions,
  getGdprStatusForRecord,
  cascadeGdprErasureToAiData,
  getAiCascadeLogForRecord,
  getOriginalPiiFromCascadeLog,
  hasGdprErasureForRecord,
  EMAIL_SCOPE_FOR_SUBJECT_SQL,
} from '../services/gdprService.js';
import { syncOneAccount } from '../services/emailSyncService.js';
import { claimSendIntent, markIntentUnconfirmed } from '../services/emailSendIntentService.js';
import { createImapAccount } from '../services/connectedAccountService.js';
import type { ClaimedSyncAccount } from '../services/connectedAccountService.js';
import type { MailProvider, NormalizedMessage } from '../services/mail/mailProvider.js';
import { erasedAddressDigest, lockForIngest } from '../services/mail/gdprRedaction.js';
import { uid, clearAuditLogFor, insertParkedMailbox, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'gdpr-svc';

// ── Fixtures ───────────────────────────────────────────────────────────────────

let adminId: string;
let adminActor: { id: string; name: string };

beforeAll(async () => {
  // Clean up any leftover rows from failed prior runs. Notes carry a real FK to their
  // author and no FK to the record they hang off, so they outlive both and block the
  // user delete unless they go first.
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%` });

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
  await pool.query('DELETE FROM notes WHERE created_by = $1', [adminId]);
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
  // Audit log cleanup uses a single connection to ensure DISABLE TRIGGER takes effect.
  await clearAuditLogFor(adminId);
});

afterAll(async () => {
  await pool.query('DELETE FROM gdpr_deletion_log WHERE requested_by = $1', [adminId]);
  await pool.query('DELETE FROM notes WHERE created_by = $1', [adminId]);
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [adminId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [adminId]);
  await clearAuditLogFor(adminId);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%` });
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
    const fakeId = '00000000-0000-4000-8000-000000000099';
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
    const fakeId = '00000000-0000-4000-8000-000000000098';
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
    // The subject themselves, as a standalone word.
    const subjectText = '李明 confirmed the renewal';
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
      [session.rows[0].id, subjectText],
    );

    await eraseLead(lead.id, adminActor);
    await waitForCascade(lead.id, 'lead');

    const messages = await pool.query<{ role: string; content: string }>(
      'SELECT role, content FROM ai_messages WHERE session_id = $1',
      [session.rows[0].id],
    );
    const byRole = new Map(messages.rows.map((row) => [row.role, row.content]));

    // Both halves matter. Without the bystander assertion an unanchored pattern
    // passes; without the subject assertion a pattern that matches nothing at
    // all passes, and the erasure silently redacts none of the subject's data.
    expect(byRole.get('user')).toBe(bystanderText);
    expect(byRole.get('assistant')).not.toContain('李明');
    expect(byRole.get('assistant')).toContain('[redacted]');

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

  it('includes private notes — Art. 15 covers all data held about the subject', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await pool.query(
      `INSERT INTO notes (entity_type, entity_id, body, body_text, visibility, created_by)
       VALUES ('contact', $1, '{"type":"doc"}', 'team note', 'team', $2),
              ('contact', $1, '{"type":"doc"}', 'private note', 'private', $2)`,
      [contact.id, adminId],
    );

    const exportData = await getGdprExportForContact(contact.id);

    const bodies = exportData.notes.map((note) => note.body_text);
    expect(bodies).toContain('team note');
    // Note visibility is an internal access control, not a carve-out from the subject's
    // right of access.
    expect(bodies).toContain('private note');
  });

  it('erasure scrubs a soft-deleted note, which no other job purges', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await pool.query(
      `INSERT INTO notes (entity_type, entity_id, body, body_text, created_by, deleted_at)
       VALUES ('contact', $1, '{"type":"doc"}', 'deleted note', $2, now())`,
      [contact.id, adminId],
    );

    await eraseContact(contact.id, adminActor);

    const after = await pool.query<{ body_text: string }>(
      `SELECT body_text FROM notes WHERE entity_type = 'contact' AND entity_id = $1`,
      [contact.id],
    );
    expect(after.rows[0]!.body_text).toBe('[GDPR deleted]');
  });

  it('erasure scrubs a private note', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await pool.query(
      `INSERT INTO notes (entity_type, entity_id, body, body_text, visibility, created_by)
       VALUES ('contact', $1, '{"type":"doc"}', 'private note', 'private', $2)`,
      [contact.id, adminId],
    );

    await eraseContact(contact.id, adminActor);

    const after = await pool.query<{ body_text: string }>(
      `SELECT body_text FROM notes WHERE entity_type = 'contact' AND entity_id = $1`,
      [contact.id],
    );
    expect(after.rows[0]!.body_text).toBe('[GDPR deleted]');
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

  it('lists a pending erasure with a null completed_at, and timestamps as ISO strings', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await pool.query(
      `INSERT INTO gdpr_deletion_log (record_type, record_id, requested_by, erasure_scope)
       VALUES ('contact', $1, $2, '{}')`,
      [contact.id, adminId],
    );

    try {
      const page = await listGdprDeletions(1, 100);
      const entry = page.data.find((row) => row.record_id === contact.id);
      expect(entry?.completed_at).toBeNull();
      expect(entry?.requested_at).toBe(new Date(entry?.requested_at ?? '').toISOString());
    } finally {
      await pool.query('DELETE FROM gdpr_deletion_log WHERE record_id = $1', [contact.id]);
    }
  });

  it('returns timestamps as ISO strings, the shape the shared type promises', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await eraseContact(contact.id, adminActor);

    const status = await getGdprStatusForRecord('contact', contact.id);
    expect(status?.requested_at).toBe(new Date(status?.requested_at ?? '').toISOString());
    expect(typeof status?.completed_at).toBe('string');
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

  it('clears tool results that name the erased person', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const session = await pool.query<{ id: string }>(
      `INSERT INTO ai_sessions (user_id, name) VALUES ($1, 'Tools') RETURNING id`,
      [adminId],
    );
    const sessionId = session.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    await pool.query(
      `INSERT INTO ai_messages (session_id, role, content, tool_results)
       VALUES ($1, 'assistant', 'Here you go.', $2)`,
      [sessionId, JSON.stringify([{ tool: 'search_activities', notes: 'Alice Erasure says yes' }])],
    );

    await cascadeGdprErasureToAiData(
      contact.id,
      'contact',
      'Alice Erasure',
      `${FILE_PREFIX}-tools@example.com`,
      adminActor,
    );

    const stored = await pool.query<{ tool_results: unknown }>(
      'SELECT tool_results FROM ai_messages WHERE session_id = $1',
      [sessionId],
    );
    expect(stored.rows).toEqual([{ tool_results: null }]);
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

// ── Email cascade ──────────────────────────────────────────────────────────────

describe('GDPR erasure and export of synced email', () => {
  let mailboxOne: string;
  let mailboxTwo: string;

  beforeEach(async () => {
    await pool.query('DELETE FROM connected_accounts WHERE user_id = $1', [adminId]);
    // Real, decryptable credentials: the re-sync tests run the sync engine against this one.
    const syncable = await createImapAccount(
      adminId,
      {
        email_address: `${FILE_PREFIX}-box-one@example.com`,
        host: 'imap.example.com',
        port: 993,
        username: `${FILE_PREFIX}-box-one@example.com`,
        password: 'a-very-secret-password',
        secure: true,
      },
      adminActor,
    );
    mailboxOne = syncable.id;
    mailboxTwo = await insertParkedMailbox(adminId, `${FILE_PREFIX}-box-two@example.com`);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM connected_accounts WHERE user_id = $1', [adminId]);
  });

  async function storeMessage(
    mailboxId: string,
    suffix: string,
    fields: { from?: string; to?: string[]; isPrivate?: boolean } = {},
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO email_messages
         (connected_account_id, provider_message_id, thread_id, direction, from_address,
          to_addresses, subject, message_body_text, message_body_html, message_snippet,
          is_private)
       VALUES ($1, $2, $3, 'inbound', $4, $5, 'Contract renewal', 'Hi Alice, call me',
               '<p>Hi Alice</p>', 'Hi Alice', $6)
       RETURNING id`,
      [
        mailboxId,
        `INBOX:${suffix}`,
        `thread-${suffix}`,
        fields.from ?? 'colleague@example.net',
        fields.to ?? ['someone@example.net'],
        fields.isPrivate ?? false,
      ],
    );
    return result.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
  }

  async function message(id: string) {
    const result = await pool.query<{
      from_address: string;
      to_addresses: string[];
      subject: string | null;
      message_body_text: string | null;
      message_body_html: string | null;
      message_snippet: string | null;
      redacted: boolean;
    }>(
      `SELECT from_address, to_addresses, subject, message_body_text, message_body_html,
              message_snippet, gdpr_redacted_at IS NOT NULL AS redacted
         FROM email_messages WHERE id = $1`,
      [id],
    );
    return result.rows[0]!; // Safe: every id here names a stored row.
  }

  const placeholder = (recordId: string): string => `gdpr-deleted-${recordId}@gdpr.invalid`;

  it("redacts the subject's address and the text of their mail in every mailbox", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const fromThem = await storeMessage(mailboxOne, 'from', { from: contact.email });
    const toThem = await storeMessage(mailboxTwo, 'to', {
      to: [contact.email, 'other@example.net'],
      isPrivate: true,
    });
    const unrelated = await storeMessage(mailboxOne, 'unrelated');

    const log = await eraseContact(contact.id, adminActor);

    expect(await message(fromThem)).toMatchObject({
      from_address: placeholder(contact.id),
      subject: '[GDPR deleted]',
      message_body_text: null,
      message_body_html: null,
      message_snippet: null,
      redacted: true,
    });
    expect((await message(toThem)).to_addresses).toEqual([
      placeholder(contact.id),
      'other@example.net',
    ]);
    expect(await message(unrelated)).toMatchObject({
      subject: 'Contract renewal',
      redacted: false,
    });
    expect(log).toMatchObject({ email_messages_redacted: 2, email_links_deleted: 0 });
    expect(log.erasure_scope).toEqual(
      expect.arrayContaining(['email_messages', 'email_message_links']),
    );
  });

  it('redacts mail linked to the record that never names its address, and drops the links', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const linked = await storeMessage(mailboxOne, 'linked');
    await pool.query(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'contact', $2, 'manual')`,
      [linked, contact.id],
    );
    await pool.query(
      `INSERT INTO email_message_link_suppressions (email_message_id, record_type, record_id)
       VALUES ($1, 'contact', $2)`,
      [linked, contact.id],
    );

    const log = await eraseContact(contact.id, adminActor);

    expect(await message(linked)).toMatchObject({ subject: '[GDPR deleted]', redacted: true });
    expect(log).toMatchObject({ email_messages_redacted: 1, email_links_deleted: 1 });
    const left = await pool.query(
      `SELECT 1 FROM email_message_links WHERE record_id = $1
        UNION ALL SELECT 1 FROM email_message_link_suppressions WHERE record_id = $1`,
      [contact.id],
    );
    expect(left.rowCount).toBe(0);
  });

  it.each([
    ['CC', 'cc_addresses'],
    ['Reply-To', 'reply_to_addresses'],
  ])('finds the subject by their %s address too', async (_label, column) => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const id = await storeMessage(mailboxOne, `arm-${column}`);
    // column is one of the two literals above, never caller input.
    await pool.query(`UPDATE email_messages SET ${column} = $2 WHERE id = $1`, [
      id,
      ['First@Other.example', contact.email.toUpperCase()],
    ]);

    await eraseContact(contact.id, adminActor);

    const row = await pool.query<{ addresses: string[]; redacted: boolean }>(
      `SELECT ${column} AS addresses, gdpr_redacted_at IS NOT NULL AS redacted
         FROM email_messages WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({
      addresses: ['First@Other.example', placeholder(contact.id)],
      redacted: true,
    });
  });

  it('clears the activity text of a send intent filed from the record, whoever it went to', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await pool.query(
      `INSERT INTO email_send_intents
         (user_id, connected_account_id, rfc_message_id, actor_name, to_addresses,
          activity_notes, status, idempotency_key, request_hash, record_type, record_id)
       VALUES ($1, $2, $3, 'GDPR Admin', '{someone@example.net}', 'About Alice', 'pending',
               $4, 'gdpr-test', 'contact', $5)`,
      [adminId, mailboxOne, `${uid()}@x.test`, randomUUID(), contact.id],
    );

    await eraseContact(contact.id, adminActor);

    const intent = await pool.query<{ to_addresses: string[]; activity_notes: string | null }>(
      'SELECT to_addresses, activity_notes FROM email_send_intents WHERE record_id = $1',
      [contact.id],
    );
    expect(intent.rows).toEqual([{ to_addresses: ['someone@example.net'], activity_notes: null }]);
  });

  it('clears the text of an unconfirmed forward from another record that went to the subject', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const sent = await pool.query<{ id: string }>(
      `INSERT INTO email_send_intents
         (user_id, connected_account_id, rfc_message_id, actor_name, to_addresses,
          activity_notes, status, idempotency_key, request_hash, record_type, record_id)
       VALUES ($1, $2, $3, 'GDPR Admin', $4, 'Forwarded to Alice', 'pending', $5, 'gdpr-test',
               'deal', $6)
       RETURNING id`,
      [adminId, mailboxOne, `${uid()}@x.test`, [contact.email], randomUUID(), randomUUID()],
    );
    // Safe: the insert above returned its one row.
    const intentId = sent.rows[0]!.id;
    await markIntentUnconfirmed(intentId);

    await eraseContact(contact.id, adminActor);

    const intent = await pool.query<{ to_addresses: string[]; activity_notes: string | null }>(
      'SELECT to_addresses, activity_notes FROM email_send_intents WHERE id = $1',
      [intentId],
    );
    expect(intent.rows).toEqual([
      { to_addresses: [placeholder(contact.id)], activity_notes: null },
    ]);
  });

  /** A pending forward from the given record to a third party, holding its text. */
  async function insertForwardFrom(recordType: 'contact' | 'lead', recordId: string) {
    const sent = await pool.query<{ id: string }>(
      `INSERT INTO email_send_intents
         (user_id, connected_account_id, rfc_message_id, actor_name, to_addresses,
          activity_notes, status, idempotency_key, request_hash, record_type, record_id)
       VALUES ($1, $2, $3, 'GDPR Admin', '{someone@example.net}', 'Forwarded about them',
               'pending', $4, 'gdpr-test', $5, $6)
       RETURNING id`,
      [adminId, mailboxOne, `${uid()}@x.test`, randomUUID(), recordType, recordId],
    );
    return sent.rows[0]!.id; // Safe: RETURNING one row.
  }

  async function intentNotes(intentId: string): Promise<string | null | undefined> {
    const row = await pool.query<{ activity_notes: string | null }>(
      'SELECT activity_notes FROM email_send_intents WHERE id = $1',
      [intentId],
    );
    return row.rows[0]?.activity_notes;
  }

  it('clears the text of a send made from a lead when the contact it became is erased', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    const intentId = await insertForwardFrom('lead', lead.id);
    const converted = await convertLead(
      lead.id,
      {
        contact: { first_name: lead.first_name, last_name: 'Erasure', email: lead.email },
        account: { mode: 'create', name: `Converted ${uid()}` },
        deal: { name: `Converted deal ${uid()}`, stage: 'Prospecting' },
      },
      adminActor,
    );

    await eraseContact(converted.contact_id, adminActor);

    expect(await intentNotes(intentId)).toBeNull();
  });

  it('clears the text of a send made from a merged-away contact when the survivor is erased', async () => {
    const winner = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const loser = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const intentId = await insertForwardFrom('contact', loser.id);
    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, adminActor);

    await eraseContact(winner.id, adminActor);

    expect(await intentNotes(intentId)).toBeNull();
  });

  /** A forward from a deal to the given address, claimed as the send path claims it. */
  async function claimForwardTo(address: string): Promise<string> {
    const claim = await claimSendIntent(
      {
        userId: adminId,
        actorName: 'GDPR Admin',
        connectedAccountId: mailboxOne,
        rfcMessageId: `${uid()}@x.test`,
        recordType: 'deal',
        recordId: randomUUID(),
        activityNotes: 'Forwarded to them',
        threadPrivate: false,
        parentMessageId: null,
        toAddresses: [address],
        ccAddresses: [],
        idempotencyKey: randomUUID(),
        requestHash: 'gdpr-test',
        unresolvedMergeTags: [],
      },
      false,
    );
    if (claim.kind !== 'claimed') throw new Error(`unexpected claim: ${claim.kind}`);
    return claim.intentId;
  }

  it('clears the text of a send to an address the contact has since changed', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const intentId = await claimForwardTo(contact.email);
    await pool.query('UPDATE contacts SET email = $2 WHERE id = $1', [
      contact.id,
      `${FILE_PREFIX}-new-${uid()}@example.com`,
    ]);

    await eraseContact(contact.id, adminActor);

    expect(await intentNotes(intentId)).toBeNull();
  });

  it("clears the text of a send to a merged-away contact's own address", async () => {
    const winner = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const loser = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const intentId = await claimForwardTo(loser.email);
    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, adminActor);

    await eraseContact(winner.id, adminActor);

    expect(await intentNotes(intentId)).toBeNull();
  });

  it('clears the text of a send to a lead once the contact it became is erased', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    const intentId = await claimForwardTo(lead.email);
    const converted = await convertLead(
      lead.id,
      {
        contact: {
          first_name: lead.first_name,
          last_name: 'Erasure',
          email: `${FILE_PREFIX}-corrected-${uid()}@example.com`,
        },
        account: { mode: 'create', name: `Converted ${uid()}` },
        deal: { name: `Converted deal ${uid()}`, stage: 'Prospecting' },
      },
      adminActor,
    );

    await eraseContact(converted.contact_id, adminActor);

    expect(await intentNotes(intentId)).toBeNull();
  });

  it('redacts a send intent addressed to the subject in another case', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const mixedCase = contact.email.toUpperCase();
    await pool.query(
      `INSERT INTO email_send_intents
         (user_id, connected_account_id, rfc_message_id, actor_name, to_addresses, cc_addresses,
          status, idempotency_key, request_hash)
       VALUES ($1, $2, $3, 'GDPR Admin', $4, $4, 'sent', $5, 'gdpr-test')`,
      [adminId, mailboxOne, `${uid()}@x.test`, [mixedCase], randomUUID()],
    );

    await eraseContact(contact.id, adminActor);

    const intent = await pool.query<{ to_addresses: string[]; cc_addresses: string[] }>(
      'SELECT to_addresses, cc_addresses FROM email_send_intents WHERE connected_account_id = $1',
      [mailboxOne],
    );
    expect(intent.rows).toEqual([
      { to_addresses: [placeholder(contact.id)], cc_addresses: [placeholder(contact.id)] },
    ]);
  });

  it("scrubs the contact's own activities and drops the AI's signals about them", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, notes, contact_id, owner_id)
       VALUES ('Call', 'Pricing call', 'Alice says yes', $1, $2) RETURNING id`,
      [contact.id, adminId],
    );
    const activityId = activity.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    await pool.query(
      `INSERT INTO contact_champion_blocker_signals (contact_id, status, contributing_signals)
       VALUES ($1, 'champion', '[{"description": "Alice: we will sign", "detected_at": "2026-01-01"}]')`,
      [contact.id],
    );

    await eraseContact(contact.id, adminActor);

    const after = await pool.query<{ subject: string; version: number; scrubbed: boolean }>(
      `SELECT subject, version, EXISTS (SELECT 1 FROM redacted_records r WHERE r.record_type = 'activity' AND r.record_id = activities.id) AS scrubbed
         FROM activities WHERE id = $1`,
      [activityId],
    );
    // The version bump fails an edit form opened before the erasure.
    expect(after.rows).toEqual([{ subject: '[GDPR deleted]', version: 2, scrubbed: true }]);
    const signals = await pool.query(
      'SELECT 1 FROM contact_champion_blocker_signals WHERE contact_id = $1',
      [contact.id],
    );
    expect(signals.rowCount).toBe(0);
  });

  it("deletes meeting briefs and clears churn factors drawn from the contact's activities", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const account = await pool.query<{ id: string }>(
      'INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id',
      [`Derived ${uid()}`, adminId],
    );
    const accountId = account.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    const activities = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, notes, contact_id, account_id, owner_id)
       VALUES ('Call', 'Pricing call', 'Alice says yes', $1, $2, $3),
              ('Meeting', 'Next meeting', NULL, $1, NULL, $3)
       RETURNING id`,
      [contact.id, accountId, adminId],
    );
    const meetingId = activities.rows[1]!.id; // Safe: two rows inserted above.
    await pool.query(
      `INSERT INTO activity_meeting_briefs (activity_id, brief_json, generated_by, generated_at)
       VALUES ($1, '{"recent_activity_summary": ["Alice says yes"]}', $2, now())`,
      [meetingId, adminId],
    );
    await pool.query(
      `INSERT INTO account_churn_expansion_signals
         (account_id, signal_type, confidence, contributing_factors)
       VALUES ($1, 'expansion', 0.9, '[{"description": "Alice says yes"}]')`,
      [accountId],
    );
    const alertRow = await pool.query<{ id: string }>(
      `INSERT INTO notifications (user_id, type, title, body, link_path)
       VALUES ($1, 'churn_risk_detected', 'Churn risk detected: Derived', 'Alice says yes', $2)
       RETURNING id`,
      [adminId, recordPath('account', accountId)],
    );
    const alertId = alertRow.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.

    await eraseContact(contact.id, adminActor);

    const briefs = await pool.query(
      'SELECT 1 FROM activity_meeting_briefs WHERE activity_id = $1',
      [meetingId],
    );
    expect(briefs.rowCount).toBe(0);
    const churn = await pool.query<{ contributing_factors: unknown[] }>(
      'SELECT contributing_factors FROM account_churn_expansion_signals WHERE account_id = $1',
      [accountId],
    );
    expect(churn.rows).toEqual([{ contributing_factors: [] }]);
    const alert = await pool.query<{ title: string; body: string | null }>(
      'SELECT title, body FROM notifications WHERE id = $1',
      [alertId],
    );
    expect(alert.rows).toEqual([{ title: 'Churn risk detected: Derived', body: null }]);
  });

  it('scrubs text written onto an activity after an earlier redaction', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, notes, contact_id, owner_id)
       VALUES ('Email', 'Private email', 'Added later: call her cell', $1, $2) RETURNING id`,
      [contact.id, adminId],
    );
    const activityId = activity.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    // Filed from a private thread, then annotated by hand.
    await pool.query(
      `INSERT INTO redacted_records (record_type, record_id, reason)
       VALUES ('activity', $1, 'private_thread')`,
      [activityId],
    );

    await eraseContact(contact.id, adminActor);

    const after = await pool.query<{ subject: string; notes: string | null }>(
      'SELECT subject, notes FROM activities WHERE id = $1',
      [activityId],
    );
    expect(after.rows).toEqual([{ subject: '[GDPR deleted]', notes: null }]);
  });

  it('clears the quotes of a contact whose activity named the erased person', async () => {
    const erased = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const other = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, contact_id, owner_id)
       VALUES ('Email', 'Intro', $1, $2) RETURNING id`,
      [other.id, adminId],
    );
    await pool.query(
      `INSERT INTO activity_participants (activity_id, record_type, record_id)
       VALUES ($1, 'contact', $2)`,
      [activity.rows[0]!.id, erased.id], // Safe: INSERT ... RETURNING yields one row.
    );
    await pool.query(
      `INSERT INTO contact_champion_blocker_signals (contact_id, status, contributing_signals)
       VALUES ($1, 'champion', '[{"description": "copied colleague agrees", "detected_at": "2026-01-01"}]')`,
      [other.id],
    );

    await eraseContact(erased.id, adminActor);

    const signals = await pool.query<{ status: string; quotes: unknown }>(
      `SELECT status, contributing_signals AS quotes FROM contact_champion_blocker_signals
        WHERE contact_id = $1`,
      [other.id],
    );
    expect(signals.rows).toEqual([{ status: 'champion', quotes: [] }]);
  });

  it('scrubs an activity filed before the address became a contact, by its message', async () => {
    const address = `${uid()}@later-contact.example`;
    const messageId = await storeMessage(mailboxOne, `later-${uid()}`, { to: [address] });
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`${FILE_PREFIX}-acct-${uid()}`, adminId],
    );
    const accountId = account.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    // Filed when the address matched no contact: no participant row ties it to anyone.
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, notes, account_id, owner_id, metadata)
       VALUES ('Email', 'Contract renewal', 'Hi, call me', $1, $2,
               jsonb_build_object('email_message_id', $3::text))
       RETURNING id`,
      [accountId, adminId, messageId],
    );
    const contact = await createContact(
      { ...makeContact(), email: address, owner_id: adminId },
      adminActor,
    );

    try {
      await eraseContact(contact.id, adminActor);

      const after = await pool.query<{ subject: string; notes: string | null }>(
        'SELECT subject, notes FROM activities WHERE id = $1',
        [activity.rows[0]!.id], // Safe: INSERT ... RETURNING yields one row.
      );
      expect(after.rows).toEqual([{ subject: '[GDPR deleted]', notes: null }]);
    } finally {
      await pool.query('DELETE FROM activities WHERE account_id = $1', [accountId]);
      await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    }
  });

  it('exports every activity erasure would redact, on whatever record it was filed', async () => {
    const address = `${uid()}@export-scope.example`;
    const messageId = await storeMessage(mailboxOne, `export-${uid()}`, { to: [address] });
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`${FILE_PREFIX}-acct-${uid()}`, adminId],
    );
    const accountId = account.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, account_id, owner_id, metadata)
       VALUES ('Email', 'Renewal terms', $1, $2, jsonb_build_object('email_message_id', $3::text))
       RETURNING id`,
      [accountId, adminId, messageId],
    );
    const contact = await createContact(
      { ...makeContact(), email: address, owner_id: adminId },
      adminActor,
    );

    try {
      const exported = await getGdprExportForContact(contact.id);

      expect(exported.activities.map((a) => a.id)).toContain(activity.rows[0]!.id); // Safe: as above.
    } finally {
      await pool.query('DELETE FROM activities WHERE account_id = $1', [accountId]);
      await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    }
  });

  it("exports a lead's associated activities, which its erasure would redact", async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`${FILE_PREFIX}-acct-${uid()}`, adminId],
    );
    const accountId = account.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, account_id, owner_id)
       VALUES ('Email', 'Intro', $1, $2) RETURNING id`,
      [accountId, adminId],
    );
    const activityId = activity.rows[0]!.id; // Safe: as above.
    await pool.query(
      `INSERT INTO activity_participants (activity_id, record_type, record_id) VALUES ($1, 'lead', $2)`,
      [activityId, lead.id],
    );

    try {
      const exported = await getGdprExportForLead(lead.id);

      expect(exported.activities.map((a) => a.id)).toEqual([activityId]);
    } finally {
      await pool.query('DELETE FROM activities WHERE account_id = $1', [accountId]);
      await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    }
  });

  it("drops the erased contact's activity associations, the activity reached and redacted", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`${FILE_PREFIX}-acct-${uid()}`, adminId],
    );
    const accountId = account.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, account_id, owner_id)
       VALUES ('Email', 'Renewal call', $1, $2) RETURNING id`,
      [accountId, adminId],
    );
    const activityId = activity.rows[0]!.id; // Safe: as above.
    await pool.query(
      `INSERT INTO activity_participants (activity_id, record_type, record_id) VALUES ($1, 'contact', $2)`,
      [activityId, contact.id],
    );

    try {
      await eraseContact(contact.id, adminActor);

      const rows = await pool.query('SELECT 1 FROM activity_participants WHERE record_id = $1', [
        contact.id,
      ]);
      expect(rows.rowCount).toBe(0);
      const after = await pool.query<{ subject: string }>(
        'SELECT subject FROM activities WHERE id = $1',
        [activityId],
      );
      expect(after.rows[0]?.subject).toBe('[GDPR deleted]');
      // Its only route back to the person is gone with the association, as documented.
      const exported = await getGdprExportForContact(contact.id);
      expect(exported.activities.map((a) => a.id)).not.toContain(activityId);
    } finally {
      await pool.query('DELETE FROM activities WHERE account_id = $1', [accountId]);
      await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    }
  });

  it("finds the subject's mail through the address index", async () => {
    const client = await pool.connect();
    try {
      // A near-empty table plans a seq scan; disabling it proves the index can serve the lookup.
      await client.query('SET enable_seqscan = off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN ${EMAIL_SCOPE_FOR_SUBJECT_SQL}`,
        ['contact', randomUUID(), 'x@example.net'],
      );
      expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
        'email_messages_addresses_idx',
      );
    } finally {
      await client.query('RESET enable_seqscan');
      client.release();
    }
  });

  it("redacts a send's activity on another record, even after its mailbox is gone", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const account = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`${FILE_PREFIX}-acct-${uid()}`, adminId],
    );
    const accountId = account.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
    const activity = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, notes, account_id, owner_id)
       VALUES ('Email', 'Contract renewal', 'Hi Alice, call me', $1, $2) RETURNING id`,
      [accountId, adminId],
    );
    const activityId = activity.rows[0]!.id; // Safe: as above.
    await pool.query(
      `INSERT INTO activity_participants (activity_id, record_type, record_id)
       VALUES ($1, 'contact', $2)`,
      [activityId, contact.id],
    );
    // Disconnecting deletes every message synced from the mailbox.
    await pool.query('DELETE FROM connected_accounts WHERE id = $1', [mailboxOne]);

    try {
      await eraseContact(contact.id, adminActor);

      const after = await pool.query<{ subject: string; notes: string | null; scrubbed: boolean }>(
        `SELECT subject, notes, EXISTS (SELECT 1 FROM redacted_records r WHERE r.record_type = 'activity' AND r.record_id = activities.id) AS scrubbed
           FROM activities WHERE id = $1`,
        [activityId],
      );
      // Stamped, so audit reads mask what the activity's own entries logged.
      expect(after.rows).toEqual([{ subject: '[GDPR deleted]', notes: null, scrubbed: true }]);
    } finally {
      await pool.query('DELETE FROM activities WHERE account_id = $1', [accountId]);
      await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    }
  });

  it('keeps a digest of the erased address, never the address', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);

    await eraseContact(contact.id, adminActor);

    const row = await pool.query<Record<string, unknown>>(
      'SELECT * FROM gdpr_deletion_log WHERE record_id = $1',
      [contact.id],
    );
    // Safe: the erasure above wrote this record's one log row.
    expect(row.rows[0]!.erased_address_hmac).toBe(erasedAddressDigest(contact.email));
    expect(JSON.stringify(row.rows[0])).not.toContain(contact.email);
  });

  it('redacts send intents that named the subject, whatever their status', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await pool.query(
      `INSERT INTO email_send_intents
         (user_id, connected_account_id, rfc_message_id, actor_name, to_addresses,
          activity_notes, status, idempotency_key, request_hash)
       VALUES ($1, $2, $3, 'GDPR Admin', $4, 'Notes about Alice', 'filed', $5, 'gdpr-test')`,
      [adminId, mailboxOne, `${uid()}@x.test`, [contact.email], randomUUID()],
    );

    await eraseContact(contact.id, adminActor);

    const intent = await pool.query<{ to_addresses: string[]; activity_notes: string | null }>(
      'SELECT to_addresses, activity_notes FROM email_send_intents WHERE connected_account_id = $1',
      [mailboxOne],
    );
    expect(intent.rows).toEqual([
      { to_addresses: [placeholder(contact.id)], activity_notes: null },
    ]);
  });

  function claimed(accountId: string, emailAddress: string): ClaimedSyncAccount {
    return {
      id: accountId,
      userId: adminId,
      userRole: 'admin',
      provider: 'imap',
      emailAddress,
      syncCursor: 'already-backfilled',
      syncFailureCount: 0,
      grantedScopes: [],
      excludedDomains: [],
    };
  }

  function providerOf(messages: NormalizedMessage[]): MailProvider {
    // Safe: sync only reads; nothing here sends.
    return {
      async fetchSince() {
        return { messages, cursor: `c-${uid()}`, cursorInvalid: false, hasMore: false };
      },
    } as MailProvider;
  }

  function synced(providerMessageId: string, from: string): NormalizedMessage {
    return {
      providerMessageId,
      threadId: `thread-${providerMessageId}`,
      direction: 'inbound',
      fromAddress: from,
      toAddresses: [`${FILE_PREFIX}-box-one@example.com`],
      ccAddresses: [],
      subject: 'Contract renewal',
      hasAttachments: false,
      sentAt: new Date('2026-09-01T12:00:00Z'),
      bodyText: 'Hi, it is Alice',
      bodyHtml: null,
      snippet: 'Hi, it is Alice',
      rfcMessageId: null,
      references: null,
      replyToAddresses: [],
    };
  }

  const governance = { orgExcludedDomains: [], backfillDays: 90 };

  it('does not let a re-sync restore a redacted message', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const stored = await storeMessage(mailboxOne, 'resync', { from: contact.email });
    await eraseContact(contact.id, adminActor);

    await syncOneAccount(
      claimed(mailboxOne, `${FILE_PREFIX}-box-one@example.com`),
      providerOf([synced('INBOX:resync', contact.email)]),
      undefined,
      false,
      governance,
    );

    expect(await message(stored)).toMatchObject({
      from_address: placeholder(contact.id),
      subject: '[GDPR deleted]',
      message_body_text: null,
    });
  });

  it('redacts, as it arrives, mail a mailbox connected after the erasure brings in', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    await eraseContact(contact.id, adminActor);

    await syncOneAccount(
      claimed(mailboxOne, `${FILE_PREFIX}-box-one@example.com`),
      providerOf([synced('INBOX:late', contact.email.toUpperCase())]),
      undefined,
      false,
      governance,
    );

    const arrived = await pool.query<{ id: string }>(
      `SELECT id FROM email_messages WHERE connected_account_id = $1 AND provider_message_id = 'INBOX:late'`,
      [mailboxOne],
    );
    // Safe: the sync above stored this row.
    expect(await message(arrived.rows[0]!.id)).toMatchObject({
      from_address: placeholder(contact.id),
      message_body_text: null,
      redacted: true,
    });
  });

  it('redacts once per message when two erasures share an address', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const lead = await createLead(
      { ...makeLead(), email: contact.email, owner_id: adminId },
      adminActor,
    );
    await eraseContact(contact.id, adminActor);
    await eraseLead(lead.id, adminActor);

    await syncOneAccount(
      claimed(mailboxOne, `${FILE_PREFIX}-box-one@example.com`),
      providerOf([synced('INBOX:shared', contact.email)]),
      undefined,
      false,
      governance,
    );

    const arrived = await pool.query<{ from_address: string; redacted: boolean }>(
      `SELECT from_address, gdpr_redacted_at IS NOT NULL AS redacted FROM email_messages
        WHERE connected_account_id = $1 AND provider_message_id = 'INBOX:shared'`,
      [mailboxOne],
    );
    expect(arrived.rows[0]!.redacted).toBe(true); // Safe: the sync above stored this row.
    expect([placeholder(contact.id), placeholder(lead.id)]).toContain(
      arrived.rows[0]!.from_address, // Safe: as above.
    );
  });

  it('waits for a page already being stored, then redacts it too', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const ingesting = await pool.connect();
    let inFlight = '';
    try {
      await ingesting.query('BEGIN');
      await lockForIngest(ingesting);
      const row = await ingesting.query<{ id: string }>(
        `INSERT INTO email_messages
           (connected_account_id, provider_message_id, thread_id, direction, from_address,
            subject)
         VALUES ($1, 'INBOX:inflight', 'thread-inflight', 'inbound', $2, 'Hello')
         RETURNING id`,
        [mailboxOne, contact.email],
      );
      inFlight = row.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.

      const erasing = eraseContact(contact.id, adminActor);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await pool.query(
          `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
              AND classid::bigint = (hashtext('gdpr-email-ingest')::bigint + 4294967296) % 4294967296`,
        );
        if ((waiting.rowCount ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await ingesting.query('COMMIT');
      await erasing;
    } finally {
      ingesting.release();
    }

    expect(await message(inFlight)).toMatchObject({ subject: '[GDPR deleted]', redacted: true });
  });

  it("exports the subject's mail, private threads included, each with its links", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: adminId }, adminActor);
    const privateOne = await storeMessage(mailboxTwo, 'private', {
      from: contact.email,
      isPrivate: true,
    });
    await pool.query(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'contact', $2, 'auto')`,
      [privateOne, contact.id],
    );
    await storeMessage(mailboxOne, 'not-theirs');

    const exported = await getGdprExportForContact(contact.id);

    expect(exported.email_messages).toHaveLength(1);
    expect(exported.email_messages[0]).toMatchObject({
      id: privateOne,
      mailbox: `${FILE_PREFIX}-box-two@example.com`,
      from_address: contact.email,
      body_text: 'Hi Alice, call me',
      is_private: true,
      links: [{ record_type: 'contact', record_id: contact.id }],
    });
  });

  it('exports a lead with every section, including its mail', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    // Safe: leads.email is NOT NULL, whatever LeadRow's type allows.
    await storeMessage(mailboxOne, 'lead-mail', { to: [lead.email!] });

    const exported = await getGdprExportForLead(lead.id);

    expect(exported.lead.id).toBe(lead.id);
    for (const key of ['notes', 'custom_fields', 'audit_history', 'email_messages'] as const) {
      expect(Array.isArray(exported[key])).toBe(true);
    }
    expect(exported.email_messages).toHaveLength(1);
  });

  it("erases a lead's linked mail that never names its address", async () => {
    const lead = await createLead({ ...makeLead(), owner_id: adminId }, adminActor);
    const linked = await storeMessage(mailboxOne, 'lead-linked');
    await pool.query(
      `INSERT INTO email_message_links (email_message_id, record_type, record_id, match_type)
       VALUES ($1, 'lead', $2, 'manual')`,
      [linked, lead.id],
    );

    const log = await eraseLead(lead.id, adminActor);

    expect(await message(linked)).toMatchObject({ subject: '[GDPR deleted]', redacted: true });
    expect(log).toMatchObject({ email_messages_redacted: 1, email_links_deleted: 1 });
    // Safe: leads.email is NOT NULL, whatever LeadRow's type allows.
    expect(log.erased_address_hmac).toBe(erasedAddressDigest(lead.email!));
  });
});
