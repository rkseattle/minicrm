/**
 * HTTP contract tests for lead routing admin endpoints. (MINCRM-475)
 * Covers the admin-configured scoring weights/thresholds and the per-team
 * disable toggle — the pre-create suggestion endpoint itself is covered by
 * leadRoutingService.test.ts (service-level) and the F-ROUTE E2E specs
 * (qa/e2e/tests/apps/minicrm/functional/leads/lead-routing.spec.ts).
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createTeam } from '../services/teamService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'lead-routing-ctrl';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let repCookie: string;
let adminCookie: string;
let teamId: string;

const VALID_CONFIG = {
  territory_weight: 0.25,
  industry_weight: 0.25,
  workload_weight: 0.2,
  win_rate_weight: 0.2,
  availability_weight: 0.1,
  low_confidence_threshold: 0.4,
  medium_confidence_threshold: 0.65,
  min_closed_deals_for_win_rate: 3,
};

async function resetConfig(): Promise<void> {
  await pool.query(
    `UPDATE lead_routing_scoring_config SET
       territory_weight = 0.250, industry_weight = 0.250, workload_weight = 0.200,
       win_rate_weight = 0.200, availability_weight = 0.100,
       low_confidence_threshold = 0.400, medium_confidence_threshold = 0.650,
       min_closed_deals_for_win_rate = 3, updated_at = now(), updated_by = NULL
     WHERE id = true`,
  );
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Routing Ctrl Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Routing Ctrl Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
  });

  const team = await createTeam({ name: `${FILE_PREFIX} Team ${uid()}` }, ACTOR);
  teamId = team.id;
});

beforeEach(async () => {
  await resetConfig();
  await pool.query(
    `DELETE FROM team_feature_overrides WHERE team_id = $1 AND flag_key = 'ai_lead_routing_suggestion'`,
    [teamId],
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM team_feature_overrides WHERE team_id = $1 AND flag_key = 'ai_lead_routing_suggestion'`,
    [teamId],
  );
  await pool.query(`DELETE FROM teams WHERE name LIKE $1`, [`${FILE_PREFIX}%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await resetConfig();
});

describe('GET/PATCH /api/v1/admin/ai/lead-routing-config', () => {
  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/admin/ai/lead-routing-config').expect(401);
  });

  it('returns 403 for a non-admin', async () => {
    await request(app)
      .get('/api/v1/admin/ai/lead-routing-config')
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('allows an admin to read the current configuration', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/lead-routing-config')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.min_closed_deals_for_win_rate).toBe(3);
  });

  it('403s a non-admin attempting to update the configuration', async () => {
    await request(app)
      .patch('/api/v1/admin/ai/lead-routing-config')
      .set('Cookie', repCookie)
      .send(VALID_CONFIG)
      .expect(403);
  });

  it('allows an admin to persist a valid configuration update', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/lead-routing-config')
      .set('Cookie', adminCookie)
      .send({ ...VALID_CONFIG, territory_weight: 0.3, industry_weight: 0.2 })
      .expect(200);

    expect(res.body.territory_weight).toBe(0.3);
  });

  it('returns 400 when the weights do not sum to 1.0', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/lead-routing-config')
      .set('Cookie', adminCookie)
      .send({ ...VALID_CONFIG, territory_weight: 0.9 })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when medium_confidence_threshold does not exceed low_confidence_threshold', async () => {
    await request(app)
      .patch('/api/v1/admin/ai/lead-routing-config')
      .set('Cookie', adminCookie)
      .send({ ...VALID_CONFIG, low_confidence_threshold: 0.7, medium_confidence_threshold: 0.5 })
      .expect(400);
  });
});

describe('GET /api/v1/admin/ai/lead-routing/team-overrides', () => {
  it('returns 403 for a non-admin', async () => {
    await request(app)
      .get('/api/v1/admin/ai/lead-routing/team-overrides')
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('allows an admin to list overrides, empty by default', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/lead-routing/team-overrides')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body.overrides.some((o: { team_id: string }) => o.team_id === teamId)).toBe(false);
  });
});

describe('PUT /api/v1/admin/ai/lead-routing/team-overrides/:teamId', () => {
  it('returns 403 for a non-admin', async () => {
    await request(app)
      .put(`/api/v1/admin/ai/lead-routing/team-overrides/${teamId}`)
      .set('Cookie', repCookie)
      .send({ enabled: false })
      .expect(403);
  });

  it('returns 404 for a non-existent team', async () => {
    await request(app)
      .put('/api/v1/admin/ai/lead-routing/team-overrides/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .send({ enabled: false })
      .expect(404);
  });

  it('allows an admin to set and then clear a team override', async () => {
    await request(app)
      .put(`/api/v1/admin/ai/lead-routing/team-overrides/${teamId}`)
      .set('Cookie', adminCookie)
      .send({ enabled: false })
      .expect(200);

    const listedAfterSet = await request(app)
      .get('/api/v1/admin/ai/lead-routing/team-overrides')
      .set('Cookie', adminCookie)
      .expect(200);
    const override = listedAfterSet.body.overrides.find(
      (o: { team_id: string; enabled: boolean }) => o.team_id === teamId,
    );
    expect(override?.enabled).toBe(false);

    await request(app)
      .put(`/api/v1/admin/ai/lead-routing/team-overrides/${teamId}`)
      .set('Cookie', adminCookie)
      .send({ enabled: null })
      .expect(200);

    const listedAfterClear = await request(app)
      .get('/api/v1/admin/ai/lead-routing/team-overrides')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      listedAfterClear.body.overrides.some((o: { team_id: string }) => o.team_id === teamId),
    ).toBe(false);
  });
});
