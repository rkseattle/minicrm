/**
 * Integration tests for the teams REST API controller.
 *
 * Covers HTTP-layer behaviour: status codes, error codes, and auth/role
 * enforcement. Business-logic correctness is covered by teamService.test.ts.
 * Runs against a real PostgreSQL test database via supertest.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createTeam, addTeamMember } from '../services/teamService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'team-ctrl';
const ACTOR = { id: '00000000-0000-0000-0000-000000000002', name: 'Controller Test Actor' };

let adminCookie: string;
let repCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'TC Admin',
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

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'TC Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

beforeEach(async () => {
  await pool.query('DELETE FROM team_memberships');
  await pool.query('DELETE FROM teams');
});

afterAll(async () => {
  await pool.query('DELETE FROM team_memberships');
  await pool.query('DELETE FROM teams');
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── GET /api/v1/teams ─────────────────────────────────────────────────────────

describe('GET /api/v1/teams', () => {
  it('returns 200 and an empty array when no teams exist', async () => {
    const res = await request(app).get('/api/v1/teams').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.teams).toEqual([]);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/teams');
    expect(res.status).toBe(401);
  });

  it('allows a rep to list teams', async () => {
    const res = await request(app).get('/api/v1/teams').set('Cookie', repCookie);
    expect(res.status).toBe(200);
  });
});

// ── POST /api/v1/teams ────────────────────────────────────────────────────────

describe('POST /api/v1/teams', () => {
  it('creates a team and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: 'New Team' });
    expect(res.status).toBe(201);
    expect(res.body.team.name).toBe('New Team');
  });

  it('returns 400 VALIDATION_ERROR when name is missing', async () => {
    const res = await request(app).post('/api/v1/teams').set('Cookie', adminCookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 TEAM_NAME_DUPLICATE on duplicate name', async () => {
    await createTeam({ name: 'Duplicate Team' }, ACTOR);
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: 'Duplicate Team' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEAM_NAME_DUPLICATE');
  });

  it('returns 400 MANAGER_OR_PARENT_NOT_FOUND when manager_id is a non-existent UUID', async () => {
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', adminCookie)
      .send({ name: 'Bad Manager Team', manager_id: '00000000-0000-0000-0000-000000000099' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MANAGER_OR_PARENT_NOT_FOUND');
  });

  it('returns 403 when a rep attempts to create a team', async () => {
    const res = await request(app)
      .post('/api/v1/teams')
      .set('Cookie', repCookie)
      .send({ name: 'Rep Team' });
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/teams').send({ name: 'Unauth Team' });
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/teams/:id ─────────────────────────────────────────────────────

describe('GET /api/v1/teams/:id', () => {
  it('returns 200 and the team when found', async () => {
    const team = await createTeam({ name: 'Findable' }, ACTOR);
    const res = await request(app).get(`/api/v1/teams/${team.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.team.id).toBe(team.id);
  });

  it('returns 404 TEAM_NOT_FOUND for an unknown ID', async () => {
    const res = await request(app)
      .get('/api/v1/teams/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });
});

// ── PUT /api/v1/teams/:id ─────────────────────────────────────────────────────

describe('PUT /api/v1/teams/:id', () => {
  it('returns 200 and the updated team', async () => {
    const team = await createTeam({ name: 'Old Name' }, ACTOR);
    const res = await request(app)
      .put(`/api/v1/teams/${team.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.team.name).toBe('New Name');
  });

  it('returns 404 TEAM_NOT_FOUND for an unknown ID', async () => {
    const res = await request(app)
      .put('/api/v1/teams/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });

  it('returns 409 TEAM_NAME_DUPLICATE on name collision', async () => {
    await createTeam({ name: 'Existing Name' }, ACTOR);
    const team = await createTeam({ name: 'Rename Target' }, ACTOR);
    const res = await request(app)
      .put(`/api/v1/teams/${team.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Existing Name' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEAM_NAME_DUPLICATE');
  });

  it('returns 400 TEAM_CIRCULAR_REFERENCE on a cycle attempt', async () => {
    const a = await createTeam({ name: 'Cycle A' }, ACTOR);
    const b = await createTeam({ name: 'Cycle B', parent_team_id: a.id }, ACTOR);
    const res = await request(app)
      .put(`/api/v1/teams/${a.id}`)
      .set('Cookie', adminCookie)
      .send({ parent_team_id: b.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TEAM_CIRCULAR_REFERENCE');
  });

  it('returns 400 VALIDATION_ERROR for invalid request body', async () => {
    const team = await createTeam({ name: 'Valid Team' }, ACTOR);
    const res = await request(app)
      .put(`/api/v1/teams/${team.id}`)
      .set('Cookie', adminCookie)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when a rep attempts to update a team', async () => {
    const team = await createTeam({ name: 'Rep Update' }, ACTOR);
    const res = await request(app)
      .put(`/api/v1/teams/${team.id}`)
      .set('Cookie', repCookie)
      .send({ name: 'Changed' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/teams/:id ──────────────────────────────────────────────────

describe('DELETE /api/v1/teams/:id', () => {
  it('returns 204 on successful deletion', async () => {
    const team = await createTeam({ name: 'Delete Me' }, ACTOR);
    const res = await request(app).delete(`/api/v1/teams/${team.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  it('returns 404 TEAM_NOT_FOUND for an unknown ID', async () => {
    const res = await request(app)
      .delete('/api/v1/teams/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });

  it('returns 409 TEAM_HAS_CHILDREN when child teams exist', async () => {
    const parent = await createTeam({ name: 'Has Children' }, ACTOR);
    await createTeam({ name: 'Child', parent_team_id: parent.id }, ACTOR);
    const res = await request(app).delete(`/api/v1/teams/${parent.id}`).set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEAM_HAS_CHILDREN');
  });

  it('returns 403 when a rep attempts to delete a team', async () => {
    const team = await createTeam({ name: 'Rep Delete' }, ACTOR);
    const res = await request(app).delete(`/api/v1/teams/${team.id}`).set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/v1/teams/:id/members ─────────────────────────────────────────────

describe('GET /api/v1/teams/:id/members', () => {
  it('returns 200 and an empty array for a team with no members', async () => {
    const team = await createTeam({ name: 'No Members' }, ACTOR);
    const res = await request(app)
      .get(`/api/v1/teams/${team.id}/members`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([]);
  });

  it('returns 404 TEAM_NOT_FOUND for an unknown team', async () => {
    const res = await request(app)
      .get('/api/v1/teams/00000000-0000-0000-0000-000000000000/members')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });
});

// ── POST /api/v1/teams/:id/members ────────────────────────────────────────────

describe('POST /api/v1/teams/:id/members', () => {
  it('returns 201 when a valid member is added', async () => {
    const team = await createTeam({ name: 'Add Member' }, ACTOR);
    const user = await createUser({
      email: `${FILE_PREFIX}-new-member@example.com`,
      name: 'New Member',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const res = await request(app)
      .post(`/api/v1/teams/${team.id}/members`)
      .set('Cookie', adminCookie)
      .send({ user_id: user.id, role: 'member' });
    expect(res.status).toBe(201);
    expect(res.body.member.user_id).toBe(user.id);
  });

  it('returns 400 VALIDATION_ERROR for an invalid role', async () => {
    const team = await createTeam({ name: 'Invalid Role' }, ACTOR);
    const res = await request(app)
      .post(`/api/v1/teams/${team.id}/members`)
      .set('Cookie', adminCookie)
      .send({ user_id: '00000000-0000-0000-0000-000000000000', role: 'superstar' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 TEAM_NOT_FOUND when adding a member to an unknown team', async () => {
    const res = await request(app)
      .post('/api/v1/teams/00000000-0000-0000-0000-000000000000/members')
      .set('Cookie', adminCookie)
      .send({ user_id: '00000000-0000-0000-0000-000000000001', role: 'member' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });

  it('returns 409 TEAM_MEMBER_ALREADY_EXISTS on duplicate add', async () => {
    const team = await createTeam({ name: 'Dupe Add' }, ACTOR);
    const user = await createUser({
      email: `${FILE_PREFIX}-dupe@example.com`,
      name: 'Dupe User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await addTeamMember(team.id, user.id, 'member', ACTOR);
    const res = await request(app)
      .post(`/api/v1/teams/${team.id}/members`)
      .set('Cookie', adminCookie)
      .send({ user_id: user.id, role: 'member' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TEAM_MEMBER_ALREADY_EXISTS');
  });

  it('returns 403 when a rep attempts to add a member', async () => {
    const team = await createTeam({ name: 'Rep Add Member' }, ACTOR);
    const res = await request(app)
      .post(`/api/v1/teams/${team.id}/members`)
      .set('Cookie', repCookie)
      .send({ user_id: '00000000-0000-0000-0000-000000000000', role: 'member' });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/teams/:id/members/:userId ──────────────────────────────────

describe('DELETE /api/v1/teams/:id/members/:userId', () => {
  it('returns 204 on successful removal', async () => {
    const team = await createTeam({ name: 'Remove Member' }, ACTOR);
    const user = await createUser({
      email: `${FILE_PREFIX}-remove@example.com`,
      name: 'Remove User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await addTeamMember(team.id, user.id, 'member', ACTOR);
    const res = await request(app)
      .delete(`/api/v1/teams/${team.id}/members/${user.id}`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);
  });

  it('returns 404 TEAM_NOT_FOUND when the team does not exist', async () => {
    const res = await request(app)
      .delete(
        '/api/v1/teams/00000000-0000-0000-0000-000000000000/members/00000000-0000-0000-0000-000000000001',
      )
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_NOT_FOUND');
  });

  it('returns 404 TEAM_MEMBER_NOT_FOUND when the user is not a member', async () => {
    const team = await createTeam({ name: 'No Such Member' }, ACTOR);
    const res = await request(app)
      .delete(`/api/v1/teams/${team.id}/members/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TEAM_MEMBER_NOT_FOUND');
  });

  it('returns 403 when a rep attempts to remove a member', async () => {
    const team = await createTeam({ name: 'Rep Remove Member' }, ACTOR);
    const res = await request(app)
      .delete(`/api/v1/teams/${team.id}/members/00000000-0000-0000-0000-000000000000`)
      .set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });
});
