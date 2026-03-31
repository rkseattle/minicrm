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
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const BASE_CONTACT = {
  first_name: 'Test',
  last_name: 'Contact',
  email: 'test@example.com',
};

let repId: string;
let repCookie: string;
let otherRepCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM users');

  const rep = await createUser({
    email: 'rep@example.com',
    name: 'Rep User',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const otherRep = await createUser({
    email: 'other@example.com',
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
    email: 'admin@example.com',
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
  await pool.query('DELETE FROM contacts');
});

afterAll(async () => {
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM users');
  await pool.end();
});

// ── PATCH /api/contacts/:id ──────────────────────────────────────────────────

describe('PATCH /api/contacts/:id — ownership', () => {
  it('allows the owning rep to update their own contact', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set('Cookie', repCookie)
      .send({ first_name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.contact.first_name).toBe('Updated');
  });

  it("returns 403 when a rep attempts to update another rep's contact", async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie)
      .send({ first_name: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to update any contact', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'AdminUpdated' });

    expect(res.status).toBe(200);
    expect(res.body.contact.first_name).toBe('AdminUpdated');
  });

  it('returns 404 for a non-existent contact', async () => {
    const res = await request(app)
      .patch('/api/contacts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ first_name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/contacts/:id ─────────────────────────────────────────────────

describe('DELETE /api/contacts/:id — ownership', () => {
  it('allows the owning rep to delete their own contact', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app).delete(`/api/contacts/${contact.id}`).set('Cookie', repCookie);

    expect(res.status).toBe(204);
  });

  it("returns 403 when a rep attempts to delete another rep's contact", async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app)
      .delete(`/api/contacts/${contact.id}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin to delete any contact', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app).delete(`/api/contacts/${contact.id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent contact', async () => {
    const res = await request(app)
      .delete('/api/contacts/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(404);
  });
});

// ── GET /api/contacts — list + ?account filter ──────────────────────────────

describe('GET /api/contacts — ?account filter', () => {
  it('returns 400 when ?account is not a valid UUID', async () => {
    const res = await request(app).get('/api/contacts?account=not-a-uuid').set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with an empty array for a valid UUID that matches no contacts', async () => {
    const res = await request(app)
      .get('/api/contacts?account=00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.contacts).toEqual([]);
  });
});

// ── GET /api/contacts — ?search filter ──────────────────────────────────────

describe('GET /api/contacts — ?search filter', () => {
  it('returns only contacts matching the search term', async () => {
    await createContact({
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      owner_id: repId,
    });
    await createContact({
      first_name: 'Bob',
      last_name: 'Jones',
      email: 'bob@example.com',
      owner_id: repId,
    });

    const res = await request(app).get('/api/contacts?search=alice').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0].first_name).toBe('Alice');
  });

  it('returns empty array when search matches no contacts', async () => {
    await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app).get('/api/contacts?search=zzznomatch').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.contacts).toEqual([]);
  });
});

// ── GET /api/contacts — ?accountSearch filter ────────────────────────────────

describe('GET /api/contacts — ?accountSearch filter', () => {
  it('ignores whitespace-only accountSearch', async () => {
    await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app).get('/api/contacts?accountSearch=%20').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    // whitespace-only should be treated as no filter — all contacts returned
    expect(res.body.contacts.length).toBeGreaterThanOrEqual(1);
  });
});

// ── GET /api/contacts/:id ────────────────────────────────────────────────────

describe('GET /api/contacts/:id — visibility', () => {
  it('allows any authenticated user to view any contact', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: repId });

    const res = await request(app).get(`/api/contacts/${contact.id}`).set('Cookie', otherRepCookie);

    expect(res.status).toBe(200);
    expect(res.body.contact.id).toBe(contact.id);
  });
});
