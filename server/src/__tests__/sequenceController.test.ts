/**
 * HTTP contract tests for sequenceController.
 * Verifies request validation, response shapes, error codes, and role enforcement.
 * Business logic is exercised by sequenceService.test.ts; these tests cover the HTTP layer.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'seq-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

/** Minimal valid sequence payload */
const BASE_SEQUENCE = {
  name: 'Test Sequence',
  description: 'A test sequence',
  enabled: true,
};

/** Minimal valid step payload */
const BASE_STEP = {
  sort_order: 1,
  action_type: 'create_task',
  action_config: { subject: 'Follow up' },
  delay_days: 0,
};

let adminCookie: string;
let repCookie: string;
let adminId: string;
let contactId: string;

beforeAll(async () => {
  // Clean prior runs
  await pool.query(
    `DELETE FROM sequence_enrollment_logs WHERE enrollment_id IN (
       SELECT e.id FROM sequence_enrollments e
       JOIN sales_sequences s ON s.id = e.sequence_id
       WHERE s.created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sequence_enrollments WHERE sequence_id IN (
       SELECT id FROM sales_sequences
       WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sales_sequences WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Seq Admin',
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
    email: REP_EMAIL,
    name: 'Seq Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Ctrl', 'Contact', $1, $2) RETURNING id`,
    [`${FILE_PREFIX}-contact@example.com`, adminId],
  );
  contactId = contactResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM sequence_enrollment_logs WHERE enrollment_id IN (
       SELECT e.id FROM sequence_enrollments e
       JOIN sales_sequences s ON s.id = e.sequence_id
       WHERE s.created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sequence_enrollments WHERE sequence_id IN (
       SELECT id FROM sales_sequences
       WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sales_sequences WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM sequence_enrollment_logs WHERE enrollment_id IN (
       SELECT e.id FROM sequence_enrollments e
       JOIN sales_sequences s ON s.id = e.sequence_id
       WHERE s.created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sequence_enrollments WHERE sequence_id IN (
       SELECT id FROM sales_sequences
       WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)
     )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM sales_sequences WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/v1/sequences ─────────────────────────────────────────────────────

describe('POST /api/v1/sequences', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/sequences').send(BASE_SEQUENCE);
    expect(res.status).toBe(401);
  });

  it('returns 403 when a rep tries to create a sequence', async () => {
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', repCookie)
      .send(BASE_SEQUENCE);
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 201 with the created sequence for an admin', async () => {
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);
    expect(res.status).toBe(201);
    expect(res.body.sequence.name).toBe(BASE_SEQUENCE.name);
    expect(res.body.sequence.id).toBeDefined();
    expect(res.body.sequence.step_count).toBe(0);
  });
});

// ── GET /api/v1/sequences ──────────────────────────────────────────────────────

describe('GET /api/v1/sequences', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/sequences');
    expect(res.status).toBe(401);
  });

  it('returns 200 with paginated sequences for a rep', async () => {
    const res = await request(app).get('/api/v1/sequences').set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns sequences including the one just created', async () => {
    await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send({ ...BASE_SEQUENCE, name: 'Listed Sequence' });

    const res = await request(app).get('/api/v1/sequences').set('Cookie', adminCookie);
    const names = (res.body.data as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain('Listed Sequence');
  });
});

// ── GET /api/v1/sequences/:id ──────────────────────────────────────────────────

describe('GET /api/v1/sequences/:id', () => {
  it('returns 404 for an unknown sequence id', async () => {
    const res = await request(app)
      .get('/api/v1/sequences/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SEQUENCE_NOT_FOUND');
  });

  it('returns 200 with the sequence for a known id', async () => {
    const created = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .get(`/api/v1/sequences/${created.body.sequence.id}`)
      .set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(res.body.sequence.id).toBe(created.body.sequence.id);
  });
});

// ── PATCH /api/v1/sequences/:id ────────────────────────────────────────────────

describe('PATCH /api/v1/sequences/:id', () => {
  it('returns 403 when a rep tries to update', async () => {
    const created = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .patch(`/api/v1/sequences/${created.body.sequence.id}`)
      .set('Cookie', repCookie)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for an empty update body', async () => {
    const created = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .patch(`/api/v1/sequences/${created.body.sequence.id}`)
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated name for an admin', async () => {
    const created = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .patch(`/api/v1/sequences/${created.body.sequence.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Renamed Sequence' });
    expect(res.status).toBe(200);
    expect(res.body.sequence.name).toBe('Renamed Sequence');
  });
});

// ── DELETE /api/v1/sequences/:id ──────────────────────────────────────────────

describe('DELETE /api/v1/sequences/:id', () => {
  it('returns 403 when a rep tries to delete', async () => {
    const created = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .delete(`/api/v1/sequences/${created.body.sequence.id}`)
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app)
      .delete('/api/v1/sequences/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });

  it('returns 204 when deletion succeeds', async () => {
    const created = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .delete(`/api/v1/sequences/${created.body.sequence.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });
});

// ── POST /api/v1/sequences/:id/steps ──────────────────────────────────────────

describe('POST /api/v1/sequences/:id/steps', () => {
  it('returns 403 when a rep tries to add a step', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', repCookie)
      .send(BASE_STEP);
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid action_config (missing subject)', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send({ sort_order: 1, action_type: 'create_task', action_config: {}, delay_days: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 201 with the step for a valid request', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send(BASE_STEP);
    expect(res.status).toBe(201);
    expect(res.body.step.sort_order).toBe(1);
    expect(res.body.step.action_type).toBe('create_task');
  });

  it('returns 409 for a duplicate sort_order', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send(BASE_STEP);

    const res = await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send(BASE_STEP); // same sort_order = 1
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STEP_SORT_ORDER_CONFLICT');
  });
});

// ── GET /api/v1/sequences/:id/steps ───────────────────────────────────────────

describe('GET /api/v1/sequences/:id/steps', () => {
  it('returns 200 with an empty steps array for a new sequence', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .get(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([]);
  });

  it('returns 404 for an unknown sequence id', async () => {
    const res = await request(app)
      .get('/api/v1/sequences/00000000-0000-0000-0000-000000000000/steps')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/v1/contacts/:id/sequence-enrollments ────────────────────────────

describe('POST /api/v1/contacts/:id/sequence-enrollments', () => {
  it('returns 400 when sequence_id is missing', async () => {
    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown sequence_id', async () => {
    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({ sequence_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SEQUENCE_NOT_FOUND');
  });

  it('returns 400 for a sequence with no steps', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);

    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({ sequence_id: seq.body.sequence.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SEQUENCE_HAS_NO_STEPS');
  });

  it('returns 201 with the enrollment for a valid request', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);
    await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send(BASE_STEP);

    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({ sequence_id: seq.body.sequence.id });
    expect(res.status).toBe(201);
    expect(res.body.enrollment.status).toBe('active');
    expect(res.body.enrollment.contact_id).toBe(contactId);
  });

  it('returns 409 for a duplicate active enrollment', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);
    await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send(BASE_STEP);

    await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({ sequence_id: seq.body.sequence.id });

    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({ sequence_id: seq.body.sequence.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ENROLLMENT_DUPLICATE');
  });
});

// ── GET /api/v1/contacts/:id/sequence-enrollments ─────────────────────────────

describe('GET /api/v1/contacts/:id/sequence-enrollments', () => {
  it('returns 200 with an empty array when no enrollments exist', async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', repCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.enrollments)).toBe(true);
  });
});

// ── DELETE /api/v1/sequence-enrollments/:id ───────────────────────────────────

describe('DELETE /api/v1/sequence-enrollments/:id', () => {
  it('returns 404 for an unknown enrollment id', async () => {
    const res = await request(app)
      .delete('/api/v1/sequence-enrollments/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ENROLLMENT_NOT_FOUND');
  });

  it('returns 200 with status unenrolled after unenrolling', async () => {
    const seq = await request(app)
      .post('/api/v1/sequences')
      .set('Cookie', adminCookie)
      .send(BASE_SEQUENCE);
    await request(app)
      .post(`/api/v1/sequences/${seq.body.sequence.id}/steps`)
      .set('Cookie', adminCookie)
      .send(BASE_STEP);

    const enroll = await request(app)
      .post(`/api/v1/contacts/${contactId}/sequence-enrollments`)
      .set('Cookie', adminCookie)
      .send({ sequence_id: seq.body.sequence.id });

    const res = await request(app)
      .delete(`/api/v1/sequence-enrollments/${enroll.body.enrollment.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.enrollment.status).toBe('unenrolled');
  });
});
