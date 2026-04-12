/**
 * Integration tests for activity controller behaviour that cannot be covered
 * by service-layer tests alone.
 *
 * Focuses on the cross-field direction null-guard introduced to close the gap
 * where a type-absent PATCH could clear `direction` on an existing Call/Email
 * activity, violating the "direction is required for Call and Email" invariant.
 *
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createActivity } from '../services/activityService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

let repId: string;
let repCookie: string;
/** A contact used as the required parent record for test activities */
let contactId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM contacts WHERE email = $1', ['activity-ctrl-contact@example.com']);
  await pool.query('DELETE FROM users WHERE email = $1', ['activity-ctrl-rep@example.com']);

  const rep = await createUser({
    email: 'activity-ctrl-rep@example.com',
    name: 'Activity Ctrl Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Activity', 'Ctrl', 'activity-ctrl-contact@example.com', $1)
     RETURNING id`,
    [repId],
  );
  contactId = contactResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM activities');
});

afterAll(async () => {
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM contacts WHERE email = $1', ['activity-ctrl-contact@example.com']);
  await pool.query('DELETE FROM users WHERE email = $1', ['activity-ctrl-rep@example.com']);
});

// ── Cross-field direction null-guard ──────────────────────────────────────────

describe('PATCH /api/activities/:id — direction null-guard', () => {
  it('rejects a patch that sets direction: null on an existing Call activity', async () => {
    const call = await createActivity({
      type: 'Call',
      subject: 'Test call',
      direction: 'Outbound',
      contact_id: contactId,
      owner_id: repId,
    });

    const res = await request(app)
      .patch(`/api/activities/${call.id}`)
      .set('Cookie', repCookie)
      .send({ direction: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a patch that sets direction: null on an existing Email activity', async () => {
    const email = await createActivity({
      type: 'Email',
      subject: 'Test email',
      direction: 'Inbound',
      contact_id: contactId,
      owner_id: repId,
    });

    const res = await request(app)
      .patch(`/api/activities/${email.id}`)
      .set('Cookie', repCookie)
      .send({ direction: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('allows patching other fields on a Call without touching direction', async () => {
    const call = await createActivity({
      type: 'Call',
      subject: 'Initial subject',
      direction: 'Outbound',
      contact_id: contactId,
      owner_id: repId,
    });

    const res = await request(app)
      .patch(`/api/activities/${call.id}`)
      .set('Cookie', repCookie)
      .send({ subject: 'Updated subject' });

    expect(res.status).toBe(200);
    expect(res.body.activity.subject).toBe('Updated subject');
    expect(res.body.activity.direction).toBe('Outbound');
  });

  it('allows setting direction: null on a Note (non-communication type)', async () => {
    const note = await createActivity({
      type: 'Note',
      subject: 'Test note',
      contact_id: contactId,
      owner_id: repId,
    });

    const res = await request(app)
      .patch(`/api/activities/${note.id}`)
      .set('Cookie', repCookie)
      .send({ direction: null });

    expect(res.status).toBe(200);
  });

  it('rejects changing type to Call while setting direction: null in the same patch', async () => {
    const note = await createActivity({
      type: 'Note',
      subject: 'About to become a call',
      contact_id: contactId,
      owner_id: repId,
    });

    const res = await request(app)
      .patch(`/api/activities/${note.id}`)
      .set('Cookie', repCookie)
      .send({ type: 'Call', direction: null });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
