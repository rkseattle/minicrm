/**
 * Integration tests for the pipeline controller (MINCRM-397).
 *
 * Covers all four endpoints: list, create, update (PATCH), and delete.
 * Runs against a real PostgreSQL test database via supertest.
 *
 * This file mutates the pipelines table and must run serially — it is
 * listed in SERIAL_FILES in vitest.config.ts.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'pipe-ctrl';

let repCookie: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Pipeline Ctrl Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Pipeline Ctrl Admin',
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
  await pool.query(`DELETE FROM pipelines WHERE is_default = false AND name LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

afterEach(async () => {
  await pool.query(`DELETE FROM pipelines WHERE is_default = false AND name LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
});

// ── GET /api/v1/pipelines ─────────────────────────────────────────────────────

describe('GET /api/v1/pipelines', () => {
  it('returns 200 with an array containing the default pipeline', async () => {
    const res = await request(app).get('/api/v1/pipelines').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pipelines)).toBe(true);
    expect(res.body.pipelines.some((p: { is_default: boolean }) => p.is_default)).toBe(true);
  });

  it('each pipeline has the expected shape', async () => {
    const res = await request(app).get('/api/v1/pipelines').set('Cookie', repCookie);

    const pipeline = res.body.pipelines[0] as {
      id: string;
      name: string;
      is_default: boolean;
      created_at: string;
      updated_at: string;
    };
    expect(typeof pipeline.id).toBe('string');
    expect(typeof pipeline.name).toBe('string');
    expect(typeof pipeline.is_default).toBe('boolean');
    expect(typeof pipeline.created_at).toBe('string');
  });

  it('returns the default pipeline first', async () => {
    const res = await request(app).get('/api/v1/pipelines').set('Cookie', repCookie);

    expect(res.body.pipelines[0].is_default).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/pipelines');

    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/pipelines ────────────────────────────────────────────────────

describe('POST /api/v1/pipelines — admin only', () => {
  it('creates a pipeline and returns 201 with the new pipeline', async () => {
    const name = `${FILE_PREFIX}-${uid()}`;

    const res = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
    expect(res.body.is_default).toBe(false);
    expect(typeof res.body.id).toBe('string');
  });

  it('trims whitespace from the name', async () => {
    const name = `${FILE_PREFIX}-trim-${uid()}`;

    const res = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name: `  ${name}  ` });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await request(app).post('/api/v1/pipelines').set('Cookie', adminCookie).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when name is blank', async () => {
    const res = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 PIPELINE_NAME_CONFLICT on duplicate name', async () => {
    const name = `${FILE_PREFIX}-dup-${uid()}`;
    await request(app).post('/api/v1/pipelines').set('Cookie', adminCookie).send({ name });

    const res = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PIPELINE_NAME_CONFLICT');
  });

  it('returns 403 when a rep attempts to create a pipeline', async () => {
    const res = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', repCookie)
      .send({ name: `${FILE_PREFIX}-rep-blocked-${uid()}` });

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/pipelines')
      .send({ name: `${FILE_PREFIX}-anon-${uid()}` });

    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/v1/pipelines/:id ───────────────────────────────────────────────

describe('PATCH /api/v1/pipelines/:id — admin only', () => {
  it('renames a pipeline and returns 200 with the updated pipeline', async () => {
    const original = `${FILE_PREFIX}-orig-${uid()}`;
    const createRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name: original });
    const id = createRes.body.id as string;

    const newName = `${FILE_PREFIX}-renamed-${uid()}`;
    const res = await request(app)
      .patch(`/api/v1/pipelines/${id}`)
      .set('Cookie', adminCookie)
      .send({ name: newName });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.name).toBe(newName);
  });

  it('returns 400 VALIDATION_ERROR when body is empty', async () => {
    const createRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-patch-empty-${uid()}` });
    const id = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/v1/pipelines/${id}`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 NOT_FOUND when the pipeline does not exist', async () => {
    const res = await request(app)
      .patch('/api/v1/pipelines/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-ghost-${uid()}` });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 PIPELINE_NAME_CONFLICT when renaming to an existing name', async () => {
    const nameA = `${FILE_PREFIX}-conflict-a-${uid()}`;
    const nameB = `${FILE_PREFIX}-conflict-b-${uid()}`;
    await request(app).post('/api/v1/pipelines').set('Cookie', adminCookie).send({ name: nameA });
    const bRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name: nameB });

    const res = await request(app)
      .patch(`/api/v1/pipelines/${bRes.body.id as string}`)
      .set('Cookie', adminCookie)
      .send({ name: nameA });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PIPELINE_NAME_CONFLICT');
  });

  it('returns 403 when a rep attempts to rename a pipeline', async () => {
    const createRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-rep-rename-${uid()}` });

    const res = await request(app)
      .patch(`/api/v1/pipelines/${createRes.body.id as string}`)
      .set('Cookie', repCookie)
      .send({ name: `${FILE_PREFIX}-rep-rename-new-${uid()}` });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/pipelines/:id ──────────────────────────────────────────────

describe('DELETE /api/v1/pipelines/:id — admin only', () => {
  it('deletes a non-default empty pipeline and returns 200 with the id', async () => {
    const name = `${FILE_PREFIX}-del-${uid()}`;
    const createRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name });
    const id = createRes.body.id as string;

    const res = await request(app).delete(`/api/v1/pipelines/${id}`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);

    // Verify the pipeline is gone
    const listRes = await request(app).get('/api/v1/pipelines').set('Cookie', adminCookie);
    expect((listRes.body.pipelines as { id: string }[]).some((p) => p.id === id)).toBe(false);
  });

  it('returns 404 NOT_FOUND when the pipeline does not exist', async () => {
    const res = await request(app)
      .delete('/api/v1/pipelines/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 PIPELINE_DEFAULT when attempting to delete the default pipeline', async () => {
    const defaultId = await getDefaultPipelineId();

    const res = await request(app)
      .delete(`/api/v1/pipelines/${defaultId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PIPELINE_DEFAULT');
  });

  it('returns 409 PIPELINE_HAS_DEALS when pipeline has deals', async () => {
    const name = `${FILE_PREFIX}-has-deals-${uid()}`;
    const createRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name });
    const pipelineId = createRes.body.id as string;

    // Insert a stage and a deal into the pipeline directly
    const { rows: stageRows } = await pool.query<{ id: string }>(
      `INSERT INTO pipeline_stages (pipeline_id, name, sort_order, probability, is_terminal, is_fixed)
       VALUES ($1, $2, 10, 50, false, false) RETURNING id`,
      [pipelineId, `${FILE_PREFIX}-stage-${uid()}`],
    );
    const { rows: stageNameRows } = await pool.query<{ name: string }>(
      'SELECT name FROM pipeline_stages WHERE id = $1',
      [stageRows[0].id],
    );
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, status) VALUES ($1, 'x', 'Test', 'rep', 'active') RETURNING id`,
      [`${FILE_PREFIX}-has-deals-user-${uid()}@example.com`],
    );
    const userId = userRows[0].id;

    try {
      await pool.query(
        `INSERT INTO deals (pipeline_id, name, stage, currency, owner_id) VALUES ($1, $2, $3, 'USD', $4)`,
        [pipelineId, `${FILE_PREFIX}-deal`, stageNameRows[0].name, userId],
      );

      const res = await request(app)
        .delete(`/api/v1/pipelines/${pipelineId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PIPELINE_HAS_DEALS');
      expect(typeof res.body.error.dealCount).toBe('number');
      expect(res.body.error.dealCount).toBe(1);
    } finally {
      await pool.query('DELETE FROM deals WHERE pipeline_id = $1', [pipelineId]);
      await pool.query('DELETE FROM pipeline_stages WHERE pipeline_id = $1', [pipelineId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.query('DELETE FROM pipelines WHERE id = $1', [pipelineId]);
    }
  });

  it('returns 403 when a rep attempts to delete a pipeline', async () => {
    const name = `${FILE_PREFIX}-rep-del-${uid()}`;
    const createRes = await request(app)
      .post('/api/v1/pipelines')
      .set('Cookie', adminCookie)
      .send({ name });

    const res = await request(app)
      .delete(`/api/v1/pipelines/${createRes.body.id as string}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});
