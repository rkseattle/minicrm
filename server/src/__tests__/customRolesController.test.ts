/**
 * Integration tests for customRolesController + user role-assignment sub-resource.
 * MINCRM-542
 *
 * Covers:
 * - GET /api/v1/custom-roles — list, 403 for non-admin
 * - GET /api/v1/custom-roles/:id — found, 404 for unknown, 400 for bad UUID
 * - POST /api/v1/custom-roles — create, 400 validation, 409 duplicate
 * - PUT /api/v1/custom-roles/:id — update, 404 not found, 409 builtin
 * - DELETE /api/v1/custom-roles/:id — delete, 404 not found, 409 builtin, 409 has assignees
 * - GET /api/v1/users/:id/roles — list user roles
 * - POST /api/v1/users/:id/roles — assign role, 404 user not found, 404 role not found
 * - DELETE /api/v1/users/:id/roles/:roleId — remove role
 *
 * Runs against real PostgreSQL minicrm_test DB via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createCustomRole } from '../services/roleService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

const FILE_PREFIX = 'custom-roles-ctrl';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let adminId: string;
let adminCookie: string;
let repCookie: string;
let testRepId: string;

beforeAll(async () => {
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'CR Admin',
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
    name: 'CR Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  testRepId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── GET /api/v1/custom-roles ──────────────────────────────────────────────────

describe('GET /api/v1/custom-roles', () => {
  it('returns list including built-in roles for admin', async () => {
    const res = await request(app).get('/api/v1/custom-roles').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const names = res.body.data.map((r: { name: string }) => r.name);
    expect(names).toContain('admin');
    expect(names).toContain('rep');
  });

  it('returns 403 for a rep (lacks settings:manage)', async () => {
    const res = await request(app).get('/api/v1/custom-roles').set('Cookie', repCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/custom-roles');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/custom-roles/:id ─────────────────────────────────────────────

describe('GET /api/v1/custom-roles/:id', () => {
  it('returns a role by ID', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-get`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );

    const res = await request(app)
      .get(`/api/v1/custom-roles/${role.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(role.id);
    expect(res.body.data.name).toBe(`${FILE_PREFIX}-get`);

    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });

  it('returns 404 for an unknown UUID', async () => {
    const res = await request(app)
      .get('/api/v1/custom-roles/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_NOT_FOUND');
  });

  it('returns 400 for a non-UUID id', async () => {
    const res = await request(app)
      .get('/api/v1/custom-roles/not-a-uuid')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /api/v1/custom-roles ─────────────────────────────────────────────────

describe('POST /api/v1/custom-roles', () => {
  it('creates a custom role and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/custom-roles')
      .set('Cookie', adminCookie)
      .send({
        name: `${FILE_PREFIX}-create`,
        description: 'Test role',
        capabilities: [Capability.ContactsView, Capability.DealsView],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(`${FILE_PREFIX}-create`);
    expect(res.body.data.capabilities).toContain(Capability.ContactsView);

    await pool.query('DELETE FROM custom_roles WHERE id = $1', [res.body.data.id]);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/custom-roles')
      .set('Cookie', adminCookie)
      .send({ capabilities: [Capability.ContactsView] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when capabilities contains an unknown value', async () => {
    const res = await request(app)
      .post('/api/v1/custom-roles')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-badcap`, capabilities: ['not:real'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 CUSTOM_ROLE_DUPLICATE on name conflict', async () => {
    const name = `${FILE_PREFIX}-dup`;
    const role = await createCustomRole({ name, capabilities: [Capability.ContactsView] }, ACTOR);

    const res = await request(app)
      .post('/api/v1/custom-roles')
      .set('Cookie', adminCookie)
      .send({ name, capabilities: [Capability.ContactsView] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_DUPLICATE');

    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });
});

// ── PUT /api/v1/custom-roles/:id ─────────────────────────────────────────────

describe('PUT /api/v1/custom-roles/:id', () => {
  it('updates a custom role', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-upd-before`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );

    const res = await request(app)
      .put(`/api/v1/custom-roles/${role.id}`)
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-upd-after`, capabilities: [Capability.DealsView] });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`${FILE_PREFIX}-upd-after`);
    expect(res.body.data.capabilities).toContain(Capability.DealsView);

    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });

  it('returns 400 for non-UUID id', async () => {
    const res = await request(app)
      .put('/api/v1/custom-roles/not-a-uuid')
      .set('Cookie', adminCookie)
      .send({ name: 'x', capabilities: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown role', async () => {
    const res = await request(app)
      .put('/api/v1/custom-roles/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ name: `${FILE_PREFIX}-ghost`, capabilities: [Capability.ContactsView] });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_NOT_FOUND');
  });

  it('returns 409 CUSTOM_ROLE_BUILTIN for a built-in role', async () => {
    const listRes = await request(app).get('/api/v1/custom-roles').set('Cookie', adminCookie);
    const builtinRole = listRes.body.data.find(
      (r: { is_builtin: boolean; name: string }) => r.is_builtin && r.name === 'rep',
    );

    const res = await request(app)
      .put(`/api/v1/custom-roles/${builtinRole.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'hacked', capabilities: [Capability.ContactsView] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_BUILTIN');
  });
});

// ── DELETE /api/v1/custom-roles/:id ──────────────────────────────────────────

describe('DELETE /api/v1/custom-roles/:id', () => {
  it('deletes a custom role and returns 204', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-del`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );

    const res = await request(app)
      .delete(`/api/v1/custom-roles/${role.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);
  });

  it('returns 400 for non-UUID id', async () => {
    const res = await request(app)
      .delete('/api/v1/custom-roles/not-a-uuid')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown role', async () => {
    const res = await request(app)
      .delete('/api/v1/custom-roles/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_NOT_FOUND');
  });

  it('returns 409 CUSTOM_ROLE_BUILTIN for a built-in role', async () => {
    const listRes = await request(app).get('/api/v1/custom-roles').set('Cookie', adminCookie);
    const builtinRole = listRes.body.data.find(
      (r: { is_builtin: boolean; name: string }) => r.is_builtin && r.name === 'rep',
    );

    const res = await request(app)
      .delete(`/api/v1/custom-roles/${builtinRole.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_BUILTIN');
  });

  it('returns 409 CUSTOM_ROLE_HAS_ASSIGNEES when users are assigned', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-del-blocked`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );
    await pool.query('INSERT INTO user_custom_roles (user_id, role_id) VALUES ($1, $2)', [
      testRepId,
      role.id,
    ]);

    const res = await request(app)
      .delete(`/api/v1/custom-roles/${role.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_HAS_ASSIGNEES');

    await pool.query('DELETE FROM user_custom_roles WHERE role_id = $1', [role.id]);
    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });
});

// ── GET /api/v1/users/:id/roles ───────────────────────────────────────────────

describe('GET /api/v1/users/:id/roles', () => {
  it('returns empty array for a user with no custom roles', async () => {
    const res = await request(app)
      .get(`/api/v1/users/${testRepId}/roles`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 400 for non-UUID user id', async () => {
    const res = await request(app).get('/api/v1/users/not-a-uuid/roles').set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .get('/api/v1/users/00000000-0000-0000-0000-000000000000/roles')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});

// ── POST /api/v1/users/:id/roles ──────────────────────────────────────────────

describe('POST /api/v1/users/:id/roles', () => {
  it('assigns a role to a user and returns 204', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-assign`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );

    const res = await request(app)
      .post(`/api/v1/users/${testRepId}/roles`)
      .set('Cookie', adminCookie)
      .send({ roleId: role.id });

    expect(res.status).toBe(204);

    await pool.query('DELETE FROM user_custom_roles WHERE user_id = $1 AND role_id = $2', [
      testRepId,
      role.id,
    ]);
    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });

  it('returns 400 for missing roleId', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${testRepId}/roles`)
      .set('Cookie', adminCookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for non-UUID user id', async () => {
    const res = await request(app)
      .post('/api/v1/users/not-a-uuid/roles')
      .set('Cookie', adminCookie)
      .send({ roleId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app)
      .post('/api/v1/users/00000000-0000-0000-0000-000000000000/roles')
      .set('Cookie', adminCookie)
      .send({ roleId: '00000000-0000-0000-0000-000000000001' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 404 for unknown role', async () => {
    const res = await request(app)
      .post(`/api/v1/users/${testRepId}/roles`)
      .set('Cookie', adminCookie)
      .send({ roleId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_NOT_FOUND');
  });
});

// ── DELETE /api/v1/users/:id/roles/:roleId ────────────────────────────────────

describe('DELETE /api/v1/users/:id/roles/:roleId', () => {
  it('removes a role assignment and returns 204', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-remove`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );
    await pool.query('INSERT INTO user_custom_roles (user_id, role_id) VALUES ($1, $2)', [
      testRepId,
      role.id,
    ]);

    const res = await request(app)
      .delete(`/api/v1/users/${testRepId}/roles/${role.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);

    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });

  it('returns 400 for non-UUID user id', async () => {
    const res = await request(app)
      .delete('/api/v1/users/not-a-uuid/roles/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for non-UUID role id', async () => {
    const res = await request(app)
      .delete(`/api/v1/users/${testRepId}/roles/not-a-uuid`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is idempotent — removing a role not currently assigned still returns 204', async () => {
    const role = await createCustomRole(
      { name: `${FILE_PREFIX}-remove-noop`, capabilities: [Capability.ContactsView] },
      ACTOR,
    );

    // Role exists but is not assigned to testRepId — service is idempotent (no-op)
    const res = await request(app)
      .delete(`/api/v1/users/${testRepId}/roles/${role.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(204);

    await pool.query('DELETE FROM custom_roles WHERE id = $1', [role.id]);
  });

  it('returns 404 for a completely unknown role ID', async () => {
    const res = await request(app)
      .delete(`/api/v1/users/${testRepId}/roles/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CUSTOM_ROLE_NOT_FOUND');
  });
});

// ── admin-id in URL matches logged-in admin ───────────────────────────────────

describe('GET /api/v1/users/:id/roles — admin self', () => {
  it('returns own roles for admin user', async () => {
    const res = await request(app).get(`/api/v1/users/${adminId}/roles`).set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
