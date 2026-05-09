/**
 * Integration tests for noteService. (MINCRM-352)
 *
 * Runs against the real PostgreSQL minicrm_test database.
 * Covers: CRUD, visibility masking, creator-only visibility-change enforcement,
 * soft-delete, audit entries, and extractBodyText.
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  listNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  extractBodyText,
} from '../services/noteService.js';

const FILE_PREFIX = 'note-svc';

// ── Test document helpers ─────────────────────────────────────────────────────

function makeDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let adminId: string;
let adminActor: { id: string; name: string };
let repId: string;
let repActor: { id: string; name: string };
let contactId: string;

/** Deletes audit_log rows scoped to this test file, bypassing the append-only trigger. */
async function clearAuditLog(whereClause: string, params: unknown[]): Promise<void> {
  await pool.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
  await pool.query(`DELETE FROM audit_log WHERE ${whereClause}`, params);
  await pool.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
}

beforeAll(async () => {
  // Clean up from any previous runs
  await pool.query(
    'DELETE FROM notes WHERE entity_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await clearAuditLog('changed_by_id IN (SELECT id FROM users WHERE email LIKE $1)', [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Note Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminActor = { id: adminId, name: admin.name };

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Note Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repActor = { id: repId, name: rep.name };

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Note', 'Contact', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, adminId],
  );
  contactId = contactResult.rows[0]!.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM notes WHERE entity_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await clearAuditLog('changed_by_id IN (SELECT id FROM users WHERE email LIKE $1)', [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM notes WHERE entity_id = $1', [contactId]);
});

// ── extractBodyText ───────────────────────────────────────────────────────────

describe('extractBodyText', () => {
  it('extracts plain text from a Tiptap doc', () => {
    const doc = makeDoc('Hello world');
    expect(extractBodyText(doc)).toBe('Hello world');
  });

  it('concatenates text across nested nodes', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    });
    expect(extractBodyText(doc)).toBe('First Second');
  });

  it('returns empty string for invalid JSON', () => {
    expect(extractBodyText('not json')).toBe('');
  });

  it('returns empty string for non-object JSON', () => {
    expect(extractBodyText('"a string"')).toBe('');
  });

  it('returns empty string for a doc with no text nodes', () => {
    const doc = JSON.stringify({ type: 'doc', content: [{ type: 'horizontalRule' }] });
    expect(extractBodyText(doc)).toBe('');
  });
});

// ── createNote ────────────────────────────────────────────────────────────────

describe('createNote', () => {
  it('creates a team note and returns it', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Team note'), visibility: 'team', tags: [] },
      adminActor,
    );
    expect(note.body).toBe(makeDoc('Team note'));
    expect(note.visibility).toBe('team');
    expect(note.created_by).toBe(adminId);
    expect(note.is_masked).toBe(false);
  });

  it('creates a private note', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Private note'), visibility: 'private', tags: [] },
      adminActor,
    );
    expect(note.visibility).toBe('private');
    expect(note.body).toBe(makeDoc('Private note')); // creator sees own private note
    expect(note.is_masked).toBe(false);
  });

  it('writes a note_created audit entry', async () => {
    await createNote(
      'contact',
      contactId,
      { body: makeDoc('Audit test XYZ'), visibility: 'team', tags: [] },
      adminActor,
    );
    const audit = await pool.query<{ event_type: string; new_value: string }>(
      `SELECT event_type, new_value FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_created' AND new_value LIKE '%Audit test XYZ%'`,
      [contactId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].new_value).toContain('Audit test XYZ');
  });

  it('writes [private note] to audit log for private notes', async () => {
    await createNote(
      'contact',
      contactId,
      { body: makeDoc('Secret private'), visibility: 'private', tags: [] },
      adminActor,
    );
    const audit = await pool.query<{ new_value: string }>(
      `SELECT new_value FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_created' AND new_value = '[private note]'
       ORDER BY id DESC LIMIT 1`,
      [contactId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].new_value).toBe('[private note]');
  });

  it('throws ENTITY_NOT_FOUND for a non-existent contact', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await expect(
      createNote(
        'contact',
        fakeId,
        { body: makeDoc('x'), visibility: 'team', tags: [] },
        adminActor,
      ),
    ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
  });
});

// ── listNotes ─────────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('returns team notes for any authenticated user', async () => {
    await createNote(
      'contact',
      contactId,
      { body: makeDoc('Visible'), visibility: 'team', tags: [] },
      adminActor,
    );
    const result = await listNotes('contact', contactId, repId, 1, 25);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.is_masked).toBe(false);
  });

  it('masks private notes from other users', async () => {
    await createNote(
      'contact',
      contactId,
      { body: makeDoc('Secret'), visibility: 'private', tags: [] },
      adminActor,
    );
    const result = await listNotes('contact', contactId, repId, 1, 25);
    // The note appears but body is masked
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.is_masked).toBe(true);
    expect(result.data[0]!.body).toBeNull();
  });

  it('shows own private notes unmasked', async () => {
    await createNote(
      'contact',
      contactId,
      { body: makeDoc('Mine'), visibility: 'private', tags: [] },
      adminActor,
    );
    const result = await listNotes('contact', contactId, adminId, 1, 25);
    expect(result.data[0]!.is_masked).toBe(false);
    expect(result.data[0]!.body).toBe(makeDoc('Mine'));
  });

  it('excludes soft-deleted notes', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Gone'), visibility: 'team', tags: [] },
      adminActor,
    );
    await deleteNote('contact', contactId, note.id, adminActor, 'admin');
    const result = await listNotes('contact', contactId, adminId, 1, 25);
    expect(result.data).toHaveLength(0);
  });

  it('returns paginated results', async () => {
    for (let i = 0; i < 5; i++) {
      await createNote(
        'contact',
        contactId,
        { body: makeDoc(`Note ${i}`), visibility: 'team', tags: [] },
        adminActor,
      );
    }
    const page1 = await listNotes('contact', contactId, adminId, 1, 3);
    const page2 = await listNotes('contact', contactId, adminId, 2, 3);
    expect(page1.data).toHaveLength(3);
    expect(page2.data).toHaveLength(2);
    expect(page1.total).toBe(5);
  });
});

// ── getNoteById ───────────────────────────────────────────────────────────────

describe('getNoteById', () => {
  it('returns a note for the correct entity', async () => {
    const created = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Get me'), visibility: 'team', tags: [] },
      adminActor,
    );
    const fetched = await getNoteById('contact', contactId, created.id, adminId);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
  });

  it('returns null for a non-existent note', async () => {
    const result = await getNoteById(
      'contact',
      contactId,
      '00000000-0000-0000-0000-000000000000',
      adminId,
    );
    expect(result).toBeNull();
  });

  it('returns null for wrong entity', async () => {
    const created = await createNote(
      'contact',
      contactId,
      { body: makeDoc('x'), visibility: 'team', tags: [] },
      adminActor,
    );
    // Wrong entity ID
    const result = await getNoteById(
      'contact',
      '00000000-0000-0000-0000-000000000000',
      created.id,
      adminId,
    );
    expect(result).toBeNull();
  });

  it('masks private notes from other users', async () => {
    const created = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Private'), visibility: 'private', tags: [] },
      adminActor,
    );
    const fetched = await getNoteById('contact', contactId, created.id, repId);
    expect(fetched).toBeNull(); // private + wrong caller = null (not found per visibility)
  });
});

// ── updateNote ────────────────────────────────────────────────────────────────

describe('updateNote', () => {
  it('allows creator to update body', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Before'), visibility: 'team', tags: [] },
      adminActor,
    );
    const updated = await updateNote(
      'contact',
      contactId,
      note.id,
      { body: makeDoc('After') },
      adminActor,
      'admin',
    );
    expect(updated!.body).toBe(makeDoc('After'));
  });

  it("allows admin to update body of another user's note", async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Rep note'), visibility: 'team', tags: [] },
      repActor,
    );
    const updated = await updateNote(
      'contact',
      contactId,
      note.id,
      { body: makeDoc('Admin edited') },
      adminActor,
      'admin',
    );
    expect(updated!.body).toBe(makeDoc('Admin edited'));
  });

  it("forbids rep from updating another user's note", async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Admin note'), visibility: 'team', tags: [] },
      adminActor,
    );
    await expect(
      updateNote('contact', contactId, note.id, { body: makeDoc('Hacked') }, repActor, 'rep'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("forbids admin from changing visibility of another user's note", async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Rep note'), visibility: 'team', tags: [] },
      repActor,
    );
    await expect(
      updateNote('contact', contactId, note.id, { visibility: 'private' }, adminActor, 'admin'),
    ).rejects.toMatchObject({ code: 'VISIBILITY_CHANGE_FORBIDDEN' });
  });

  it('allows creator to change their own note visibility', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Public'), visibility: 'team', tags: [] },
      adminActor,
    );
    const updated = await updateNote(
      'contact',
      contactId,
      note.id,
      { visibility: 'private' },
      adminActor,
      'admin',
    );
    expect(updated!.visibility).toBe('private');
  });

  it('writes note_updated audit entry when body changes', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('OldBody-u'), visibility: 'team', tags: [] },
      adminActor,
    );
    await updateNote(
      'contact',
      contactId,
      note.id,
      { body: makeDoc('NewBody-u') },
      adminActor,
      'admin',
    );
    const audit = await pool.query<{ event_type: string; old_value: string; new_value: string }>(
      `SELECT event_type, old_value, new_value FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_updated' AND old_value LIKE '%OldBody-u%'`,
      [contactId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].old_value).toContain('OldBody-u');
    expect(audit.rows[0].new_value).toContain('NewBody-u');
  });

  it('writes note_visibility_changed audit entry', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('vis-change-test'), visibility: 'team', tags: [] },
      adminActor,
    );
    await updateNote('contact', contactId, note.id, { visibility: 'public' }, adminActor, 'admin');
    const audit = await pool.query<{ event_type: string; old_value: string; new_value: string }>(
      `SELECT event_type, old_value, new_value FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_visibility_changed'
         AND old_value = 'team' AND new_value = 'public'`,
      [contactId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    expect(audit.rows[0].old_value).toBe('team');
    expect(audit.rows[0].new_value).toBe('public');
  });

  it('masks audit values for private notes', async () => {
    const countBefore = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_updated' AND new_value = '[private note]'`,
      [contactId],
    );
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('priv-mask-unique'), visibility: 'private', tags: [] },
      adminActor,
    );
    await updateNote(
      'contact',
      contactId,
      note.id,
      { body: makeDoc('priv-mask-updated') },
      adminActor,
      'admin',
    );
    const countAfter = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_updated' AND new_value = '[private note]'`,
      [contactId],
    );
    expect(parseInt(countAfter.rows[0]!.count)).toBe(parseInt(countBefore.rows[0]!.count) + 1);
  });

  it('returns null for non-existent note', async () => {
    const result = await updateNote(
      'contact',
      contactId,
      '00000000-0000-0000-0000-000000000000',
      { body: makeDoc('x') },
      adminActor,
      'admin',
    );
    expect(result).toBeNull();
  });
});

// ── deleteNote ────────────────────────────────────────────────────────────────

describe('deleteNote', () => {
  it('soft-deletes a note — returns true and note disappears from list', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Delete me'), visibility: 'team', tags: [] },
      adminActor,
    );
    const deleted = await deleteNote('contact', contactId, note.id, adminActor, 'admin');
    expect(deleted).toBe(true);

    const listed = await listNotes('contact', contactId, adminId, 1, 25);
    expect(listed.data.map((n) => n.id)).not.toContain(note.id);
  });

  it('preserves the row in the DB (soft-delete)', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Soft'), visibility: 'team', tags: [] },
      adminActor,
    );
    await deleteNote('contact', contactId, note.id, adminActor, 'admin');

    const row = await pool.query(`SELECT deleted_at FROM notes WHERE id = $1`, [note.id]);
    expect(row.rows[0]!.deleted_at).not.toBeNull();
  });

  it('writes note_deleted audit entry', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('ByeUnique'), visibility: 'team', tags: [] },
      adminActor,
    );
    await deleteNote('contact', contactId, note.id, adminActor, 'admin');

    const audit = await pool.query<{ event_type: string; old_value: string }>(
      `SELECT event_type, old_value FROM audit_log
       WHERE record_id = $1 AND event_type = 'note_deleted' AND old_value LIKE '%ByeUnique%'`,
      [contactId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].old_value).toContain('ByeUnique');
  });

  it("forbids rep from deleting another user's note", async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Admin note'), visibility: 'team', tags: [] },
      adminActor,
    );
    await expect(deleteNote('contact', contactId, note.id, repActor, 'rep')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allows admin to delete any note', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: makeDoc('Rep note'), visibility: 'team', tags: [] },
      repActor,
    );
    const result = await deleteNote('contact', contactId, note.id, adminActor, 'admin');
    expect(result).toBe(true);
  });

  it('returns false for a non-existent note', async () => {
    const result = await deleteNote(
      'contact',
      contactId,
      '00000000-0000-0000-0000-000000000000',
      adminActor,
      'admin',
    );
    expect(result).toBe(false);
  });
});
