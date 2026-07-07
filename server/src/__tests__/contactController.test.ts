/**
 * Integration tests for contact controller authorization.
 *
 * Verifies ownership enforcement on PATCH and DELETE endpoints:
 * - Reps may only modify contacts they own.
 * - Admins may modify any contact.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createContact } from '../services/contactService.js';
import { createUser } from '../services/userService.js';
import { createTeam, addTeamMember } from '../services/teamService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'contact-ctrl';

const makeContact = () => ({
  first_name: 'Test',
  last_name: 'Contact',
  email: `${FILE_PREFIX}-${uid()}@example.com`,
});

let repId: string;
let repCookie: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Rep User',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const otherRep = await createUser({
    email: `${FILE_PREFIX}-other@example.com`,
    name: 'Other Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    name: otherRep.name,
    role: otherRep.role,
  });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Admin User',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── PATCH /api/contacts/:id ──────────────────────────────────────────────────

describe('PATCH /api/contacts/:id — ownership', () => {
  it('allows the owning rep to update their own contact', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', repCookie)
      .send({ first_name: 'Updated', version: contact.version });

    expect(res.status).toBe(200);
    expect(res.body.contact.first_name).toBe('Updated');
  });

  it("returns 403 when a rep attempts to update another rep's contact", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie)
      .send({ first_name: 'Hijacked', version: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any contact', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'AdminUpdated', version: contact.version });

    expect(res.status).toBe(200);
    expect(res.body.contact.first_name).toBe('AdminUpdated');
  });

  it('returns 404 for a non-existent contact', async () => {
    const res = await request(app)
      .patch('/api/v1/contacts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ first_name: 'Ghost', version: 1 });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/contacts/:id ─────────────────────────────────────────────────

// Per MINCRM-542 + migration 109: reps have contacts:delete and can delete their
// own contacts. Ownership check in the controller blocks deletion of other users' contacts.
describe('DELETE /api/contacts/:id — ownership', () => {
  it('allows a rep to delete their own contact (MINCRM-542)', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 FORBIDDEN when a rep attempts to delete another rep's contact (MINCRM-542)", async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any contact', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .delete(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent contact when rep has contacts:delete (MINCRM-542)', async () => {
    const res = await request(app)
      .delete('/api/v1/contacts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    // Rep has contacts:delete so the capability gate passes; controller returns 404
    // because the contact does not exist.
    expect(res.status).toBe(404);
  });
});

// ── GET /api/contacts — list + ?account filter ──────────────────────────────

describe('GET /api/contacts — ?account filter', () => {
  it('returns 400 when ?account is not a valid UUID', async () => {
    const res = await request(app)
      .get('/api/v1/contacts?account=not-a-uuid')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with an empty array for a valid UUID that matches no contacts', async () => {
    const res = await request(app)
      .get('/api/v1/contacts?account=00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── GET /api/contacts — ?search filter ──────────────────────────────────────

describe('GET /api/contacts — ?search filter', () => {
  it('returns only contacts matching the search term', async () => {
    await createContact({
      first_name: 'Alice',
      last_name: 'Smith',
      email: `${FILE_PREFIX}-${uid()}-alice@example.com`,
      owner_id: repId,
    });
    await createContact({
      first_name: 'Bob',
      last_name: 'Jones',
      email: `${FILE_PREFIX}-${uid()}-bob@example.com`,
      owner_id: repId,
    });

    const res = await request(app)
      .get('/api/v1/contacts?search=alice&owner=me')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].first_name).toBe('Alice');
  });

  it('returns empty array when search matches no contacts', async () => {
    await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .get('/api/v1/contacts?search=zzznomatch')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── GET /api/contacts — ?accountSearch filter ────────────────────────────────

describe('GET /api/contacts — ?accountSearch filter', () => {
  it('ignores whitespace-only accountSearch', async () => {
    await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .get('/api/v1/contacts?accountSearch=%20')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    // whitespace-only should be treated as no filter — all contacts returned
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── POST /api/contacts — duplicate detection ─────────────────────────────────

describe('POST /api/contacts — duplicate detection', () => {
  it('returns 409 with duplicate info when a contact with the same email exists', async () => {
    const dupContact = makeContact();
    await createContact({ ...dupContact, owner_id: repId });

    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Cookie', repCookie)
      .send({ first_name: 'Other', last_name: 'Person', email: dupContact.email });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(res.body.duplicate).toMatchObject({
      first_name: dupContact.first_name,
      last_name: dupContact.last_name,
      email: dupContact.email,
    });
    expect(res.body.duplicate.id).toBeDefined();
  });

  // MINCRM-247: the DB unique constraint on contacts.email means ?force=true can no
  // longer bypass the duplicate check — the constraint fires at the DB level and the
  // controller returns 409 with DUPLICATE_EMAIL instead of creating a duplicate.
  it('returns 409 DUPLICATE_EMAIL when ?force=true but the DB unique constraint fires', async () => {
    const dupContact = makeContact();
    await createContact({ ...dupContact, owner_id: repId });

    const res = await request(app)
      .post('/api/v1/contacts?force=true')
      .set('Cookie', repCookie)
      .send({ first_name: 'Other', last_name: 'Person', email: dupContact.email });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it('creates a contact without a warning when no duplicate email exists', async () => {
    const newEmail = `${FILE_PREFIX}-${uid()}-brandnew@example.com`;
    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Cookie', repCookie)
      .send({ first_name: 'New', last_name: 'User', email: newEmail });

    expect(res.status).toBe(201);
    expect(res.body.contact.email).toBe(newEmail);
  });
});

// ── GET /api/contacts/:id ────────────────────────────────────────────────────

describe('GET /api/contacts/:id — visibility', () => {
  it('allows any authenticated user to view any contact', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .get(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.contact.id).toBe(contact.id);
  });
});

// ── POST /api/contacts/:id/send-email (MINCRM-275) ──────────────────────────

describe('POST /api/contacts/:id/send-email', () => {
  it('returns 200 with delivered: false and an activityId when SMTP is not configured', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .post(`/api/v1/contacts/${contact.id}/send-email`)
      .set('Cookie', repCookie)
      .send({ subject: 'Hello', body: 'Hi there' });

    expect(res.status).toBe(200);
    expect(res.body.delivered).toBe(false);
    expect(res.body.activityId).toBeTruthy();
  });

  it('logs an Email activity linked to the contact', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    await request(app)
      .post(`/api/v1/contacts/${contact.id}/send-email`)
      .set('Cookie', repCookie)
      .send({ subject: 'Test subject', body: 'Test body' });

    const activityRes = await request(app)
      .get(`/api/v1/activities?contact=${contact.id}`)
      .set('Cookie', repCookie);

    expect(activityRes.status).toBe(200);
    const emailActivities = (activityRes.body.data as { type: string; subject: string }[]).filter(
      (a) => a.type === 'Email',
    );
    expect(emailActivities.length).toBeGreaterThanOrEqual(1);
    expect(emailActivities[0].subject).toBe('Test subject');
  });

  it('returns 400 when the contact has an empty email address', async () => {
    // Bypass the schema validation — insert a contact with an empty email string
    // (the DB column is NOT NULL but the app-layer check rejects empty strings)
    const result = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('No', 'Email', '', $1) RETURNING id`,
      [repId],
    );
    const contactId = result.rows[0].id;

    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/send-email`)
      .set('Cookie', repCookie)
      .send({ subject: 'Hello', body: 'Hi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_EMAIL');
  });

  it('returns 400 when subject is missing', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .post(`/api/v1/contacts/${contact.id}/send-email`)
      .set('Cookie', repCookie)
      .send({ body: 'Hi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when subject exceeds 255 characters', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .post(`/api/v1/contacts/${contact.id}/send-email`)
      .set('Cookie', repCookie)
      .send({ subject: 'a'.repeat(256), body: 'Hi' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a non-existent contact', async () => {
    const res = await request(app)
      .post('/api/v1/contacts/00000000-0000-0000-0000-000000000000/send-email')
      .set('Cookie', repCookie)
      .send({ subject: 'Hello', body: 'Hi' });

    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .post(`/api/v1/contacts/${contact.id}/send-email`)
      .send({ subject: 'Hello', body: 'Hi' });

    expect(res.status).toBe(401);
  });
});

// ── GET /api/contacts — ?owner=my_team filter (MINCRM-545) ──────────────────

describe('GET /api/contacts — ?owner=my_team filter', () => {
  const TEAM_PREFIX = `${FILE_PREFIX}-my-team`;
  const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Actor' };

  it('returns contacts owned by all team co-members including the requesting user', async () => {
    const userA = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-a@example.com`,
      name: 'Team User A',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const userB = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-b@example.com`,
      name: 'Team User B',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const cookieA = makeAuthCookie({
      id: userA.id,
      email: userA.email,
      name: userA.name,
      role: userA.role,
    });

    const team = await createTeam({ name: `${TEAM_PREFIX}-${uid()}` }, ACTOR);
    await addTeamMember(team.id, userA.id, 'member', ACTOR);
    await addTeamMember(team.id, userB.id, 'member', ACTOR);

    const contactA = await createContact({ ...makeContact(), owner_id: userA.id });
    const contactB = await createContact({ ...makeContact(), owner_id: userB.id });

    const res = await request(app).get('/api/v1/contacts?owner=my_team').set('Cookie', cookieA);

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(contactA.id);
    expect(ids).toContain(contactB.id);

    await pool.query('DELETE FROM contacts WHERE id = ANY($1::uuid[])', [
      [contactA.id, contactB.id],
    ]);
    await pool.query('DELETE FROM team_memberships WHERE team_id = $1', [team.id]);
    await pool.query('DELETE FROM teams WHERE id = $1', [team.id]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userA.id, userB.id]]);
  });

  it('falls back to the requesting user only when they belong to no teams', async () => {
    const solo = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-solo@example.com`,
      name: 'Solo User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const other = await createUser({
      email: `${TEAM_PREFIX}-${uid()}-other@example.com`,
      name: 'Other User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const soloCookie = makeAuthCookie({
      id: solo.id,
      email: solo.email,
      name: solo.name,
      role: solo.role,
    });

    const myContact = await createContact({ ...makeContact(), owner_id: solo.id });
    const otherContact = await createContact({ ...makeContact(), owner_id: other.id });

    const res = await request(app).get('/api/v1/contacts?owner=my_team').set('Cookie', soloCookie);

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(myContact.id);
    expect(ids).not.toContain(otherContact.id);

    await pool.query('DELETE FROM contacts WHERE id = ANY($1::uuid[])', [
      [myContact.id, otherContact.id],
    ]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[solo.id, other.id]]);
  });
});

// ── GET /api/contacts/export and /api/contacts/export.pdf ─────────────────── (MINCRM-601)

describe('GET /api/contacts/export', () => {
  it('returns a CSV file with the correct Content-Type and Content-Disposition headers', async () => {
    await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app).get('/api/v1/contacts/export').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('returns 400 when account param is not a valid UUID', async () => {
    const res = await request(app)
      .get('/api/v1/contacts/export?account=not-a-uuid')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/contacts/export').expect(401);
  });
});

describe('GET /api/contacts/export.pdf', () => {
  it('returns a PDF file with the correct Content-Type and Content-Disposition headers', async () => {
    await createContact({ ...makeContact(), owner_id: repId });

    const res = await request(app)
      .get('/api/v1/contacts/export.pdf')
      .set('Cookie', repCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns 400 when account param is not a valid UUID', async () => {
    const res = await request(app)
      .get('/api/v1/contacts/export.pdf?account=not-a-uuid')
      .set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/contacts/export.pdf').expect(401);
  });
});
