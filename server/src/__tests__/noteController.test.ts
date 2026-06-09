/**
 * HTTP contract tests for noteController. (MINCRM-352)
 *
 * Covers paths that are not exercised by noteService.test.ts (service-layer unit tests):
 *   - listNotes: pagination params validated with safeParse → 400 on bad input (not 500)
 *   - listNotes: invalid entityType → 400
 *   - listNotes: invalid entityId UUID → 400
 *   - createNote: invalid entityType → 400, ENTITY_NOT_FOUND → 404
 *   - getNote: 404 for missing note, invalid entityType → 400
 *   - updateNote: FORBIDDEN → 403, VISIBILITY_CHANGE_FORBIDDEN → 403, 404 for missing note
 *   - deleteNote: 403 for rep deleting other's note, 404 for missing note
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { createNote } from '../services/noteService.js';
import { setTagsRestrictCreation } from '../services/settingsService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'note-ctrl';

const VALID_BODY = JSON.stringify({
  root: {
    children: [
      {
        children: [{ text: 'hi', type: 'text', version: 1 }],
        direction: 'ltr',
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      },
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
});

let adminId: string;
let adminCookie: string;
let repId: string;
let repCookie: string;
let contactId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM notes WHERE entity_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Note Ctrl Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Note Ctrl Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({
    id: rep.id,
    email: rep.email,
    name: rep.name,
    role: rep.role,
  });

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Note', 'Ctrl', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, admin.id],
  );
  contactId = contactResult.rows[0]!.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM notes WHERE entity_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

describe('GET /api/v1/:entityType/:entityId/notes', () => {
  it('returns 400 with VALIDATION_ERROR when page is not a number', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes?page=abc`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with VALIDATION_ERROR when limit is zero', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes?limit=0`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with VALIDATION_ERROR when entityType is unknown', async () => {
    const res = await request(app)
      .get(`/api/v1/invoice/${contactId}/notes`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with VALIDATION_ERROR when entityId is not a UUID', async () => {
    const res = await request(app)
      .get('/api/v1/contact/not-a-uuid/notes')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with paginated notes for a valid contact entity', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes?page=1&limit=5`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(`/api/v1/contact/${contactId}/notes`);
    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/:entityType/:entityId/notes ───────────────────────────────────

describe('POST /api/v1/:entityType/:entityId/notes', () => {
  it('returns 400 when entityType is invalid', async () => {
    const res = await request(app)
      .post(`/api/v1/invoice/${contactId}/notes`)
      .set('Cookie', adminCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when entityId is not a UUID', async () => {
    const res = await request(app)
      .post('/api/v1/contact/not-a-uuid/notes')
      .set('Cookie', adminCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when body fails schema validation', async () => {
    const res = await request(app)
      .post(`/api/v1/contact/${contactId}/notes`)
      .set('Cookie', adminCookie)
      .send({ visibility: 'team', tags: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 ENTITY_NOT_FOUND for a non-existent contact', async () => {
    const res = await request(app)
      .post('/api/v1/contact/00000000-0000-0000-0000-000000000000/notes')
      .set('Cookie', adminCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: [] });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ENTITY_NOT_FOUND');
  });

  it('creates a note and returns 201', async () => {
    const res = await request(app)
      .post(`/api/v1/contact/${contactId}/notes`)
      .set('Cookie', adminCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: [] });

    expect(res.status).toBe(201);
    expect(res.body.note.visibility).toBe('team');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post(`/api/v1/contact/${contactId}/notes`)
      .send({ body: VALID_BODY, visibility: 'team', tags: [] });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/:entityType/:entityId/notes/:noteId ───────────────────────────

describe('GET /api/v1/:entityType/:entityId/notes/:noteId', () => {
  it('returns 400 when entityType is invalid', async () => {
    const res = await request(app)
      .get(`/api/v1/invoice/${contactId}/notes/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when note does not exist', async () => {
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTE_NOT_FOUND');
  });

  it('returns 200 with the note when it exists', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: adminId, name: 'Note Ctrl Admin' },
    );
    const res = await request(app)
      .get(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.note.id).toBe(note.id);
  });
});

// ── PATCH /api/v1/:entityType/:entityId/notes/:noteId ─────────────────────────

describe('PATCH /api/v1/:entityType/:entityId/notes/:noteId', () => {
  it('returns 400 when entityType is invalid', async () => {
    const res = await request(app)
      .patch(`/api/v1/invoice/${contactId}/notes/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie)
      .send({ title: 'New title' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when note does not exist', async () => {
    const res = await request(app)
      .patch(`/api/v1/contact/${contactId}/notes/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie)
      .send({ title: 'New title' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTE_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN when a rep tries to update another user note', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: adminId, name: 'Note Ctrl Admin' },
    );
    const res = await request(app)
      .patch(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', repCookie)
      .send({ title: 'Hacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 VISIBILITY_CHANGE_FORBIDDEN when a non-creator changes visibility', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: repId, name: 'Note Ctrl Rep' },
    );
    const res = await request(app)
      .patch(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', adminCookie)
      .send({ visibility: 'private' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('VISIBILITY_CHANGE_FORBIDDEN');
  });
});

// ── DELETE /api/v1/:entityType/:entityId/notes/:noteId ────────────────────────

describe('DELETE /api/v1/:entityType/:entityId/notes/:noteId', () => {
  it('returns 400 when entityType is invalid', async () => {
    const res = await request(app)
      .delete(`/api/v1/invoice/${contactId}/notes/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when note does not exist', async () => {
    const res = await request(app)
      .delete(`/api/v1/contact/${contactId}/notes/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTE_NOT_FOUND');
  });

  it('returns 403 when a rep tries to delete another user note', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: adminId, name: 'Note Ctrl Admin' },
    );
    const res = await request(app)
      .delete(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 204 when a note is deleted successfully', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: adminId, name: 'Note Ctrl Admin' },
    );
    const res = await request(app)
      .delete(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).delete(
      `/api/v1/contact/${contactId}/notes/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(401);
  });
});

// ── Tag restriction on create/update (MINCRM-506) ─────────────────────────────

describe('POST /api/v1/:entityType/:entityId/notes — tag restriction', () => {
  afterEach(async () => {
    await setTagsRestrictCreation(false);
  });

  it('returns 403 TAG_CREATION_RESTRICTED when rep submits tags while restriction is enabled', async () => {
    await setTagsRestrictCreation(true);
    const res = await request(app)
      .post(`/api/v1/contact/${contactId}/notes`)
      .set('Cookie', repCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: ['urgent'] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAG_CREATION_RESTRICTED');
  });

  it('allows admin to create note with tags even when restriction is enabled', async () => {
    await setTagsRestrictCreation(true);
    const res = await request(app)
      .post(`/api/v1/contact/${contactId}/notes`)
      .set('Cookie', adminCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: ['urgent'] });

    expect(res.status).toBe(201);
  });

  it('allows rep to create note without tags when restriction is enabled', async () => {
    await setTagsRestrictCreation(true);
    const res = await request(app)
      .post(`/api/v1/contact/${contactId}/notes`)
      .set('Cookie', repCookie)
      .send({ body: VALID_BODY, visibility: 'team', tags: [] });

    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/v1/:entityType/:entityId/notes/:noteId — tag restriction', () => {
  afterEach(async () => {
    await setTagsRestrictCreation(false);
  });

  it('returns 403 TAG_CREATION_RESTRICTED when rep supplies tags in update while restriction is enabled', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: repId, name: 'Note Ctrl Rep' },
    );
    await setTagsRestrictCreation(true);

    const res = await request(app)
      .patch(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', repCookie)
      .send({ tags: ['urgent'] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAG_CREATION_RESTRICTED');
  });

  it('allows rep to update note body without tags even when restriction is enabled', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: repId, name: 'Note Ctrl Rep' },
    );
    await setTagsRestrictCreation(true);

    const res = await request(app)
      .patch(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', repCookie)
      .send({ body: VALID_BODY });

    expect(res.status).toBe(200);
  });

  it('allows rep to send tags: [] to clear tags even when restriction is enabled', async () => {
    const note = await createNote(
      'contact',
      contactId,
      { body: VALID_BODY, visibility: 'team', tags: [] },
      { id: repId, name: 'Note Ctrl Rep' },
    );
    await setTagsRestrictCreation(true);

    const res = await request(app)
      .patch(`/api/v1/contact/${contactId}/notes/${note.id}`)
      .set('Cookie', repCookie)
      .send({ tags: [] });

    expect(res.status).toBe(200);
  });
});
