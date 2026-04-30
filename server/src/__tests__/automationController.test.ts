/**
 * HTTP contract tests for automationController.
 * Verifies request validation, response shapes, error codes, and role enforcement.
 * All business logic is exercised by automationService.test.ts; these tests cover the HTTP layer.
 * (MINCRM-195)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'auto-ctrl';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;

/** Minimal valid create_task rule payload */
const BASE_RULE = {
  name: 'Test Rule',
  enabled: true,
  trigger_type: 'deal_created',
  trigger_config: {},
  action_type: 'create_task',
  action_config: {
    subject: 'Follow up',
    task_type: 'Task',
    assignee_type: 'owner',
    due_date_offset_days: 1,
  },
};

let adminCookie: string;
let repCookie: string;
let adminId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Auto Admin',
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
    name: 'Auto Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── POST /api/automation/rules ────────────────────────────────────────────────

describe('POST /api/automation/rules', () => {
  it('creates a rule and returns 201 with rule object', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send(BASE_RULE);

    expect(res.status).toBe(201);
    expect(res.body.rule.id).toBeDefined();
    expect(res.body.rule.name).toBe('Test Rule');
    expect(res.body.rule.trigger_type).toBe('deal_created');
    expect(res.body.rule.action_type).toBe('create_task');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send({ ...BASE_RULE, name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when trigger_type is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send({ ...BASE_RULE, trigger_type: 'not_a_trigger' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when action_config fails deep validation for create_task', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send({
        ...BASE_RULE,
        action_config: {
          subject: '',
          task_type: 'Task',
          assignee_type: 'owner',
          due_date_offset_days: 1,
        },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when deal_stage_changed trigger_config is missing stage', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send({
        ...BASE_RULE,
        trigger_type: 'deal_stage_changed',
        trigger_config: {},
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to create a rule', async () => {
    const res = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', repCookie)
      .send(BASE_RULE);

    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/automation/rules').send(BASE_RULE);

    expect(res.status).toBe(401);
  });
});

// ── GET /api/automation/rules ─────────────────────────────────────────────────

describe('GET /api/automation/rules', () => {
  it('returns empty rules array when none exist', async () => {
    const res = await request(app).get('/api/v1/automation/rules').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rules)).toBe(true);
    const mine = (res.body.rules as { created_by: string }[]).filter(
      (r) => r.created_by === adminId,
    );
    expect(mine).toHaveLength(0);
  });

  it('returns all rules after creation', async () => {
    await request(app).post('/api/v1/automation/rules').set('Cookie', adminCookie).send(BASE_RULE);
    await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send({ ...BASE_RULE, name: 'Second Rule' });

    const res = await request(app).get('/api/v1/automation/rules').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    const mine = (res.body.rules as { created_by: string }[]).filter(
      (r) => r.created_by === adminId,
    );
    expect(mine).toHaveLength(2);
  });

  it('returns 403 when a rep requests the list', async () => {
    const res = await request(app).get('/api/v1/automation/rules').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/automation/rules/:id ─────────────────────────────────────────────

describe('GET /api/automation/rules/:id', () => {
  it('returns the rule when found', async () => {
    const created = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send(BASE_RULE);
    const ruleId = created.body.rule.id as string;

    const res = await request(app)
      .get(`/api/v1/automation/rules/${ruleId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.rule.id).toBe(ruleId);
  });

  it('returns 404 for a non-existent rule', async () => {
    const res = await request(app)
      .get('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when a rep requests a rule', async () => {
    const res = await request(app)
      .get('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/automation/rules/:id ──────────────────────────────────────────

describe('PATCH /api/automation/rules/:id', () => {
  it('updates the rule name and returns 200', async () => {
    const created = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send(BASE_RULE);
    const ruleId = created.body.rule.id as string;

    const res = await request(app)
      .patch(`/api/v1/automation/rules/${ruleId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Updated Rule' });

    expect(res.status).toBe(200);
    expect(res.body.rule.name).toBe('Updated Rule');
  });

  it('returns 400 when update body is empty', async () => {
    const created = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send(BASE_RULE);
    const ruleId = created.body.rule.id as string;

    const res = await request(app)
      .patch(`/api/v1/automation/rules/${ruleId}`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a non-existent rule', async () => {
    const res = await request(app)
      .patch('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ enabled: false });

    expect(res.status).toBe(404);
  });

  it('returns 403 when a rep attempts to update', async () => {
    const res = await request(app)
      .patch('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie)
      .send({ enabled: false });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/automation/rules/:id ─────────────────────────────────────────

describe('DELETE /api/automation/rules/:id', () => {
  it('deletes the rule and returns 204', async () => {
    const created = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send(BASE_RULE);
    const ruleId = created.body.rule.id as string;

    const res = await request(app)
      .delete(`/api/v1/automation/rules/${ruleId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a non-existent rule', async () => {
    const res = await request(app)
      .delete('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when a rep attempts to delete', async () => {
    const res = await request(app)
      .delete('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000')
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/automation/rules/:id/logs ───────────────────────────────────────

describe('GET /api/automation/rules/:id/logs', () => {
  it('returns an empty logs array when no executions have fired', async () => {
    const created = await request(app)
      .post('/api/v1/automation/rules')
      .set('Cookie', adminCookie)
      .send(BASE_RULE);
    const ruleId = created.body.rule.id as string;

    const res = await request(app)
      .get(`/api/v1/automation/rules/${ruleId}/logs`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.logs).toHaveLength(0);
  });

  it('returns 404 when the rule does not exist', async () => {
    const res = await request(app)
      .get('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000/logs')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 403 when a rep requests logs', async () => {
    const res = await request(app)
      .get('/api/v1/automation/rules/00000000-0000-0000-0000-000000000000/logs')
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});
