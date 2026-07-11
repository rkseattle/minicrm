/**
 * HTTP contract tests for the AI deal health check endpoint. (MINCRM-442)
 *
 * Covers:
 *  - POST /deals/:id/health-check: authenticated, visibility-enforced
 *  - Unauthenticated requests are rejected
 *
 * Health check generation itself is covered by dealHealthService.test.ts —
 * these tests exercise the controller's access-control surface only. The
 * server runs with E2E unset here, so a successful check would require a
 * live/mocked Anthropic call; the visibility check runs before that call,
 * so 401/404/403 paths don't need one.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createDeal } from '../services/dealService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'deal-health-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;
let defaultPipelineId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Deal Health Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Deal Health Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    role: otherRep.role,
    name: otherRep.name,
  });
  defaultPipelineId = await getDefaultPipelineId();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('POST /api/v1/deals/:id/health-check', () => {
  it('returns 401 without authentication', async () => {
    const deal = await createDeal(
      {
        name: 'Health Check Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: repId,
      },
      { id: repId, name: 'Deal Health Rep' },
    );
    await request(app).post(`/api/v1/deals/${deal.id}/health-check`).expect(401);
  });

  it('returns 404 for a non-existent deal', async () => {
    await request(app)
      .post('/api/v1/deals/00000000-0000-0000-0000-000000000000/health-check')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests a health check for a deal owned by another rep under a private visibility policy', async () => {
    // Default org visibility policy is 'org' (all reps see all records) — this
    // test asserts the private-policy denial path, so it must set that policy
    // explicitly rather than relying on an unstated default. Regression
    // coverage for the gap that let F7-DH4 (E2E) silently start failing when
    // the visibility refactor changed the default-policy behavior underneath it.
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'deal'`,
    );
    const deal = await createDeal(
      {
        name: 'Cross-Owner Health Check Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: repId,
      },
      { id: repId, name: 'Deal Health Rep' },
    );

    try {
      await request(app)
        .post(`/api/v1/deals/${deal.id}/health-check`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query('DELETE FROM deals WHERE id = $1', [deal.id]);
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'deal'`,
      );
    }
  });
});
