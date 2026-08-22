/**
 * Integration tests for SCIM 2.0 controller handlers.
 *
 * Covers HTTP-layer behaviour of /scim/v2/Users, /scim/v2/Groups, and
 * /api/v1/scim/group-role-mappings — request validation, error shapes,
 * authentication guard, and happy paths.
 *
 * Uses supertest against the Express app with a real bearer token issued by
 * generateScimToken().
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { generateScimToken } from '../services/scimTokenService.js';
import { createUser } from '../services/userService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'scim-ctrl';

let bearerToken: string;
let adminCookie: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM user_custom_roles WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE team_id IN (
    SELECT id FROM teams WHERE name LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM scim_group_role_mappings WHERE scim_group_id LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM scim_tokens`);
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
}

beforeAll(async () => {
  await cleanup();

  // Create admin user for the scim-token admin endpoints
  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'SCIM Ctrl Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  // Generate a SCIM bearer token using the admin as the actor
  const actor = { id: admin.id, name: admin.name };
  const generated = await generateScimToken(actor);
  bearerToken = generated.rawToken;
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM user_custom_roles WHERE user_id IN (
    SELECT id FROM users WHERE email LIKE $1 AND email != $2
  )`,
    [`${FILE_PREFIX}-%`, `${FILE_PREFIX}-admin@example.com`],
  );
  await pool.query(
    `DELETE FROM team_memberships WHERE team_id IN (
    SELECT id FROM teams WHERE name LIKE $1
  )`,
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(`DELETE FROM scim_group_role_mappings WHERE scim_group_id LIKE $1`, [
    `${FILE_PREFIX}-%`,
  ]);
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1 AND email != $2`, [
    `${FILE_PREFIX}-%`,
    `${FILE_PREFIX}-admin@example.com`,
  ]);
  await pool.query(`DELETE FROM custom_roles WHERE name LIKE $1 AND is_builtin = false`, [
    `${FILE_PREFIX}-%`,
  ]);
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

// ── scimAuth middleware ────────────────────────────────────────────────────────

describe('scimAuth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/scim/v2/Users');
    expect(res.status).toBe(401);
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
    expect(res.body.detail).toContain('SCIM bearer token required');
  });

  it('returns 401 when token is invalid', async () => {
    const res = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', 'Bearer invalid-token-string');
    expect(res.status).toBe(401);
    expect(res.body.detail).toContain('Invalid or revoked SCIM token');
  });

  it('allows requests with a valid bearer token', async () => {
    const res = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(200);
  });
});

// ── GET /scim/v2/Users ────────────────────────────────────────────────────────

describe('GET /scim/v2/Users', () => {
  it('returns a SCIM ListResponse', async () => {
    const res = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
    expect(Array.isArray(res.body.Resources)).toBe(true);
  });

  it('filters by userName eq', async () => {
    // Provision a SCIM user (with externalId so it's visible via listScimUsers)
    await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        userName: `${FILE_PREFIX}-filter-u@example.com`,
        name: { givenName: 'Filter', familyName: 'User' },
        externalId: `${FILE_PREFIX}-filter-ext`,
      });

    const res = await request(app)
      .get(`/scim/v2/Users?filter=userName+eq+"${FILE_PREFIX}-filter-u@example.com"`)
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.Resources).toHaveLength(1);
    expect(res.body.Resources[0].userName).toBe(`${FILE_PREFIX}-filter-u@example.com`);
  });
});

// ── POST /scim/v2/Users ───────────────────────────────────────────────────────

describe('POST /scim/v2/Users', () => {
  it('provisions a new user and returns 201', async () => {
    const res = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        userName: `${FILE_PREFIX}-create@example.com`,
        name: { givenName: 'Create', familyName: 'Test' },
        active: true,
        externalId: `${FILE_PREFIX}-ext-001`,
      });
    expect(res.status).toBe(201);
    expect(res.body.userName).toBe(`${FILE_PREFIX}-create@example.com`);
    expect(res.headers.location).toContain('/scim/v2/Users/');
  });

  it('returns 400 when userName is missing', async () => {
    const res = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ name: { givenName: 'No', familyName: 'Username' } });
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('userName is required');
  });

  it('returns 409 when user already exists', async () => {
    await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ userName: `${FILE_PREFIX}-dup@example.com`, externalId: `${FILE_PREFIX}-dup-001` });

    const res = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ userName: `${FILE_PREFIX}-dup@example.com`, externalId: `${FILE_PREFIX}-dup-002` });
    expect(res.status).toBe(409);
  });
});

// ── GET /scim/v2/Users/:id ────────────────────────────────────────────────────

describe('GET /scim/v2/Users/:id', () => {
  it('returns 404 for a non-existent user', async () => {
    const res = await request(app)
      .get('/scim/v2/Users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(404);
    expect(res.body.detail).toContain('User not found');
  });

  it('returns the user when found', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ userName: `${FILE_PREFIX}-get-u@example.com`, externalId: `${FILE_PREFIX}-get-001` });

    const userId = createRes.body.id as string;
    const res = await request(app)
      .get(`/scim/v2/Users/${userId}`)
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userId);
  });
});

// ── PUT /scim/v2/Users/:id ────────────────────────────────────────────────────

describe('PUT /scim/v2/Users/:id', () => {
  it('returns 400 when userName is missing', async () => {
    const res = await request(app)
      .put('/scim/v2/Users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ name: { givenName: 'X', familyName: 'Y' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .put('/scim/v2/Users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ userName: 'x@example.com', active: true });
    expect(res.status).toBe(404);
  });

  it('replaces user attributes', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ userName: `${FILE_PREFIX}-put-u@example.com`, externalId: `${FILE_PREFIX}-put-001` });
    const userId = createRes.body.id as string;

    const res = await request(app)
      .put(`/scim/v2/Users/${userId}`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        userName: `${FILE_PREFIX}-put-u-new@example.com`,
        name: { givenName: 'Updated', familyName: 'Name' },
        active: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.userName).toBe(`${FILE_PREFIX}-put-u-new@example.com`);
  });
});

// ── PATCH /scim/v2/Users/:id ──────────────────────────────────────────────────

describe('PATCH /scim/v2/Users/:id', () => {
  it('returns 400 when Operations array is missing', async () => {
    const res = await request(app)
      .patch('/scim/v2/Users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'] });
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('Operations array is required');
  });

  it('returns 404 for non-existent user', async () => {
    const res = await request(app)
      .patch('/scim/v2/Users/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(res.status).toBe(404);
  });

  it('patches user and returns 200', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        userName: `${FILE_PREFIX}-patch-u@example.com`,
        externalId: `${FILE_PREFIX}-patch-001`,
      });
    const userId = createRes.body.id as string;

    const res = await request(app)
      .patch(`/scim/v2/Users/${userId}`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ Operations: [{ op: 'replace', path: 'active', value: false }] });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });
});

// ── GET /scim/v2/Groups ───────────────────────────────────────────────────────

describe('GET /scim/v2/Groups', () => {
  it('returns a SCIM ListResponse of groups', async () => {
    const res = await request(app)
      .get('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
  });
});

// ── POST /scim/v2/Groups ──────────────────────────────────────────────────────

describe('POST /scim/v2/Groups', () => {
  it('provisions a new group and returns 201', async () => {
    const res = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ displayName: `${FILE_PREFIX}-grp-create`, externalId: `${FILE_PREFIX}-ext-grp-001` });
    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe(`${FILE_PREFIX}-grp-create`);
    expect(res.headers.location).toContain('/scim/v2/Groups/');
  });

  it('returns 400 when displayName is missing', async () => {
    const res = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ externalId: 'no-name' });
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('displayName is required');
  });

  it('uses id field as externalGroupId when externalId is absent', async () => {
    const res = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ displayName: `${FILE_PREFIX}-grp-idfield`, id: `${FILE_PREFIX}-id-field-001` });
    expect(res.status).toBe(201);
  });

  it('generates a UUID when neither externalId nor id is provided', async () => {
    const res = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ displayName: `${FILE_PREFIX}-grp-uuid` });
    expect(res.status).toBe(201);
  });
});

// ── GET /scim/v2/Groups/:id ───────────────────────────────────────────────────

describe('GET /scim/v2/Groups/:id', () => {
  it('returns 404 for non-existent group', async () => {
    const res = await request(app)
      .get('/scim/v2/Groups/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns the group when found', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ displayName: `${FILE_PREFIX}-grp-get`, externalId: `${FILE_PREFIX}-ext-grp-get` });
    const groupId = createRes.body.id as string;

    const res = await request(app)
      .get(`/scim/v2/Groups/${groupId}`)
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(groupId);
  });
});

// ── PUT /scim/v2/Groups/:id ───────────────────────────────────────────────────

describe('PUT /scim/v2/Groups/:id', () => {
  it('returns 404 for non-existent group', async () => {
    const res = await request(app)
      .put('/scim/v2/Groups/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ members: [] });
    expect(res.status).toBe(404);
  });

  it('syncs group membership', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ displayName: `${FILE_PREFIX}-grp-put`, externalId: `${FILE_PREFIX}-ext-grp-put` });
    const groupId = createRes.body.id as string;

    const res = await request(app)
      .put(`/scim/v2/Groups/${groupId}`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ members: [] });
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([]);
  });

  it('ignores members array entries without a value field', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({
        displayName: `${FILE_PREFIX}-grp-putfilter`,
        externalId: `${FILE_PREFIX}-ext-grp-putf`,
      });
    const groupId = createRes.body.id as string;

    const res = await request(app)
      .put(`/scim/v2/Groups/${groupId}`)
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ members: [{ display: 'no value field' }, null] });
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([]);
  });
});

// ── DELETE /scim/v2/Groups/:id ────────────────────────────────────────────────

describe('DELETE /scim/v2/Groups/:id', () => {
  it('returns 404 for non-existent group', async () => {
    const res = await request(app)
      .delete('/scim/v2/Groups/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(404);
  });

  it('deletes a group and returns 204', async () => {
    const createRes = await request(app)
      .post('/scim/v2/Groups')
      .set('Authorization', `Bearer ${bearerToken}`)
      .send({ displayName: `${FILE_PREFIX}-grp-del`, externalId: `${FILE_PREFIX}-ext-grp-del` });
    const groupId = createRes.body.id as string;

    const res = await request(app)
      .delete(`/scim/v2/Groups/${groupId}`)
      .set('Authorization', `Bearer ${bearerToken}`);
    expect(res.status).toBe(204);
  });
});

// ── Admin: group-role mapping endpoints ───────────────────────────────────────

describe('GET /api/v1/scim/group-role-mappings', () => {
  it('returns mappings list', async () => {
    const res = await request(app)
      .get('/api/v1/scim/group-role-mappings')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.mappings)).toBe(true);
  });
});

describe('PUT /api/v1/scim/group-role-mappings/:scimGroupId', () => {
  it('returns 400 when roleId is missing', async () => {
    const res = await request(app)
      .put('/api/v1/scim/group-role-mappings/some-group')
      .set('Cookie', adminCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_ROLE_ID');
  });

  it('returns 400 when roleId is not a UUID', async () => {
    const res = await request(app)
      .put('/api/v1/scim/group-role-mappings/some-group')
      .set('Cookie', adminCookie)
      .send({ roleId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROLE_ID');
  });

  it('returns 400 when roleId references a non-existent role', async () => {
    const res = await request(app)
      .put('/api/v1/scim/group-role-mappings/some-group')
      .set('Cookie', adminCookie)
      .send({ roleId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROLE_ID');
  });

  it('creates or replaces a mapping and returns 204', async () => {
    const role = await pool.query<{ id: string }>(
      `INSERT INTO custom_roles (name, is_builtin, created_at, updated_at)
       VALUES ($1, false, now(), now()) RETURNING id`,
      [`${FILE_PREFIX}-ctrl-role`],
    );
    const roleId = role.rows[0]!.id;

    const res = await request(app)
      .put('/api/v1/scim/group-role-mappings/ctrl-scim-group')
      .set('Cookie', adminCookie)
      .send({ roleId, groupName: 'Ctrl Group' });
    expect(res.status).toBe(204);

    // cleanup
    await pool.query(
      `DELETE FROM scim_group_role_mappings WHERE scim_group_id = 'ctrl-scim-group'`,
    );
  });

  it('returns 409 when the role is a built-in', async () => {
    const builtin = await pool.query<{ id: string }>(
      `SELECT id FROM custom_roles WHERE name = 'admin' AND is_builtin = true`,
    );

    const res = await request(app)
      .put('/api/v1/scim/group-role-mappings/ctrl-builtin-group')
      .set('Cookie', adminCookie)
      .send({ roleId: builtin.rows[0]!.id, groupName: 'Ctrl Builtin Group' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCIM_MAPPING_BUILTIN_ROLE');
  });
});

describe('DELETE /api/v1/scim/group-role-mappings/:scimGroupId', () => {
  it('returns 404 when no mapping exists', async () => {
    const res = await request(app)
      .delete('/api/v1/scim/group-role-mappings/no-such-group')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAPPING_NOT_FOUND');
  });

  it('deletes the mapping and returns 204', async () => {
    const role = await pool.query<{ id: string }>(
      `INSERT INTO custom_roles (name, is_builtin, created_at, updated_at)
       VALUES ($1, false, now(), now()) RETURNING id`,
      [`${FILE_PREFIX}-ctrl-del-role`],
    );
    const roleId = role.rows[0]!.id;
    await pool.query(
      `INSERT INTO scim_group_role_mappings (scim_group_id, group_name, role_id)
       VALUES ('ctrl-del-group', 'Del Group', $1)`,
      [roleId],
    );

    const res = await request(app)
      .delete('/api/v1/scim/group-role-mappings/ctrl-del-group')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });
});
