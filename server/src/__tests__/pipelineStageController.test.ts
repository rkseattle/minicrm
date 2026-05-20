/**
 * Integration tests for the pipeline stage controller. (MINCRM-295)
 *
 * Covers: list, create, update (including fixed-stage protection and conflict
 * errors), and delete (including deals-in-stage protection).
 * Runs against a real PostgreSQL test database via supertest.
 *
 * This file mutates the pipeline_stages table and must run serially — it is
 * listed in SERIAL_FILES in vitest.config.ts.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createDeal } from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'ps-ctrl';

let repId: string;
let repCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'PS Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'PS Admin',
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

afterAll(async () => {
  // Remove any custom stages added during tests
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM pipeline_stages WHERE is_fixed = false AND name LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// Remove custom stages after each test so sort_order conflicts don't bleed across tests
afterEach(async () => {
  await pool.query(
    `DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM pipeline_stages WHERE is_fixed = false AND name LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
});

// ── GET /api/settings/pipeline-stages ────────────────────────────────────────

describe('GET /api/settings/pipeline-stages', () => {
  it('returns 200 with an array of stages', async () => {
    const res = await request(app).get('/api/v1/settings/pipeline-stages').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stages)).toBe(true);
    expect(res.body.stages.length).toBeGreaterThan(0);
  });

  it('each stage has the expected shape', async () => {
    const res = await request(app).get('/api/v1/settings/pipeline-stages').set('Cookie', repCookie);

    const stage = res.body.stages[0] as {
      id: string;
      name: string;
      sort_order: number;
      probability: number;
      is_terminal: boolean;
      is_fixed: boolean;
    };
    expect(typeof stage.id).toBe('string');
    expect(typeof stage.name).toBe('string');
    expect(typeof stage.probability).toBe('number');
    expect(typeof stage.is_terminal).toBe('boolean');
  });
});

// ── POST /api/settings/pipeline-stages ───────────────────────────────────────

describe('POST /api/settings/pipeline-stages — admin only', () => {
  it('creates a new stage and returns 201', async () => {
    const name = `${FILE_PREFIX}-${uid()}`;

    const res = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name, probability: 40 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
    expect(res.body.probability).toBe(40);
    expect(res.body.is_fixed).toBe(false);
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ probability: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 STAGE_NAME_CONFLICT when a stage with that name already exists', async () => {
    const name = `${FILE_PREFIX}-${uid()}-dup`;
    await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name, probability: 30 });

    const res = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name, probability: 30 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAGE_NAME_CONFLICT');
  });

  it('returns 403 when a rep attempts to create a stage', async () => {
    const res = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', repCookie)
      .send({ name: `${FILE_PREFIX}-${uid()}-rep-blocked`, probability: 20 });

    expect(res.status).toBe(403);
  });
});

// ── PUT /api/settings/pipeline-stages/reorder ────────────────────────────────

describe('PUT /api/settings/pipeline-stages/reorder — admin only', () => {
  it('returns 200 and stages in the new order', async () => {
    const listRes = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie);
    const stageIds: string[] = (listRes.body.stages as { id: string }[]).map((s) => s.id);
    const reversed = [...stageIds].reverse();

    const res = await request(app)
      .put('/api/v1/settings/pipeline-stages/reorder')
      .set('Cookie', adminCookie)
      .send({ stages: reversed });

    expect(res.status).toBe(200);
    expect((res.body.stages as { id: string }[]).map((s) => s.id)).toEqual(reversed);
  });

  it('assigns sort_order 1..N to the stages in the submitted order', async () => {
    const listRes = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie);
    const stageIds: string[] = (listRes.body.stages as { id: string }[]).map((s) => s.id);

    const res = await request(app)
      .put('/api/v1/settings/pipeline-stages/reorder')
      .set('Cookie', adminCookie)
      .send({ stages: stageIds });

    const sortOrders: number[] = (res.body.stages as { sort_order: number }[]).map(
      (s) => s.sort_order,
    );
    expect(sortOrders).toEqual(stageIds.map((_, i) => i + 1));
  });

  it('returns 400 VALIDATION_ERROR when stages array is missing', async () => {
    const res = await request(app)
      .put('/api/v1/settings/pipeline-stages/reorder')
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when stages array contains a non-UUID', async () => {
    const res = await request(app)
      .put('/api/v1/settings/pipeline-stages/reorder')
      .set('Cookie', adminCookie)
      .send({ stages: ['not-a-uuid'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 STAGE_NOT_FOUND when a supplied ID does not exist', async () => {
    const res = await request(app)
      .put('/api/v1/settings/pipeline-stages/reorder')
      .set('Cookie', adminCookie)
      .send({ stages: ['00000000-0000-0000-0000-000000000000'] });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STAGE_NOT_FOUND');
  });

  it('returns 403 when a rep attempts to reorder stages', async () => {
    const listRes = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie);
    const stageIds: string[] = (listRes.body.stages as { id: string }[]).map((s) => s.id);

    const res = await request(app)
      .put('/api/v1/settings/pipeline-stages/reorder')
      .set('Cookie', repCookie)
      .send({ stages: stageIds });

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/settings/pipeline-stages/:id ──────────────────────────────────

describe('PATCH /api/settings/pipeline-stages/:id', () => {
  it('updates a custom stage name and returns 200', async () => {
    const name = `${FILE_PREFIX}-${uid()}-patch-orig`;
    const createRes = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name, probability: 35 });
    const stageId: string = createRes.body.id;
    const newName = `${FILE_PREFIX}-${uid()}-patch-new`;

    const res = await request(app)
      .patch(`/api/v1/settings/pipeline-stages/${stageId}`)
      .set('Cookie', adminCookie)
      .send({ name: newName });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe(newName);
  });

  it('returns 403 STAGE_FIXED when trying to rename a fixed stage', async () => {
    // "Closed Won" is a fixed seed stage
    const listRes = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie);
    const fixedStage = (listRes.body.stages as { id: string; is_fixed: boolean }[]).find(
      (s) => s.is_fixed,
    );
    expect(fixedStage).toBeDefined();

    const res = await request(app)
      .patch(`/api/v1/settings/pipeline-stages/${fixedStage!.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'RenamedFixed' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAGE_FIXED');
  });

  it('returns 404 for a non-existent stage', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/pipeline-stages/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when a rep attempts to update a stage', async () => {
    const listRes = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie);
    const stageId: string = listRes.body.stages[0].id;

    const res = await request(app)
      .patch(`/api/v1/settings/pipeline-stages/${stageId}`)
      .set('Cookie', repCookie)
      .send({ name: 'RepUpdate' });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/settings/pipeline-stages/:id ─────────────────────────────────

describe('DELETE /api/settings/pipeline-stages/:id', () => {
  it('deletes a custom stage with no open deals and returns 200', async () => {
    const name = `${FILE_PREFIX}-${uid()}-del`;
    const createRes = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name, probability: 15 });
    const stageId: string = createRes.body.id;

    const res = await request(app)
      .delete(`/api/v1/settings/pipeline-stages/${stageId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(stageId);
  });

  it('returns 403 STAGE_FIXED when trying to delete a fixed stage', async () => {
    const listRes = await request(app)
      .get('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie);
    const fixedStage = (listRes.body.stages as { id: string; is_fixed: boolean }[]).find(
      (s) => s.is_fixed,
    );
    expect(fixedStage).toBeDefined();

    const res = await request(app)
      .delete(`/api/v1/settings/pipeline-stages/${fixedStage!.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STAGE_FIXED');
  });

  it('returns 409 STAGE_HAS_OPEN_DEALS when the stage has open deals', async () => {
    const stageName = `${FILE_PREFIX}-${uid()}-hasdeals`;
    const createRes = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name: stageName, probability: 55 });
    const stageId: string = createRes.body.id;

    // Create a deal in this stage
    await createDeal({
      name: `Deal for ${stageName}`,
      stage: stageName,
      currency: 'USD',
      owner_id: repId,
    });

    const res = await request(app)
      .delete(`/api/v1/settings/pipeline-stages/${stageId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STAGE_HAS_OPEN_DEALS');
    expect(typeof res.body.error.dealCount).toBe('number');
  });

  it('returns 404 for a non-existent stage', async () => {
    const res = await request(app)
      .delete('/api/v1/settings/pipeline-stages/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when a rep attempts to delete a stage', async () => {
    const name = `${FILE_PREFIX}-${uid()}-rep-del`;
    const createRes = await request(app)
      .post('/api/v1/settings/pipeline-stages')
      .set('Cookie', adminCookie)
      .send({ name, probability: 10 });
    const stageId: string = createRes.body.id;

    const res = await request(app)
      .delete(`/api/v1/settings/pipeline-stages/${stageId}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});
