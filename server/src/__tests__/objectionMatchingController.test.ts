/**
 * HTTP contract tests for objection matching endpoints. (MINCRM-471)
 */

import 'dotenv/config';
import { vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        usage: { input_tokens: 20, output_tokens: 10 },
        content: [
          {
            type: 'tool_use',
            name: 'report_objection_category',
            input: { objection_detected: true, category: 'Price' },
          },
        ],
      }),
    };
  }
  class AuthenticationError extends Error {}
  class APIConnectionError extends Error {}
  class APIError extends Error {}
  return {
    default: Object.assign(MockAnthropic, { AuthenticationError, APIConnectionError, APIError }),
  };
});

import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { __clearCacheForTest } from '../services/featureFlagService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

/**
 * Guards against the ai_features master toggle being left disabled by another
 * serial-project test file's in-flight PATCH (e.g. aiConfigController.test.ts's
 * master-toggle test) — every ai_* sub-feature flag, including
 * ai_objection_pattern_matching, is gated on ai_features being enabled.
 */
async function ensureAiFeaturesEnabled(): Promise<void> {
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_features'`);
  __clearCacheForTest();
}

const FILE_PREFIX = 'objection-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;
let defaultPipelineId: string;
let dealId: string;
let activityId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Objection Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Objection Rep',
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

  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration
     SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2,
         model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
});

beforeEach(async () => {
  await ensureAiFeaturesEnabled();
  const deal = await createDeal(
    {
      name: `Ctrl Deal ${Date.now()}`,
      stage: 'Prospecting',
      pipeline_id: defaultPipelineId,
      owner_id: repId,
    },
    { id: repId, name: 'Objection Rep' },
  );
  dealId = deal.id;
  const activity = await createActivity(
    {
      type: 'Call',
      subject: 'Sales call',
      notes: 'Too expensive for our budget.',
      deal_id: dealId,
      owner_id: repId,
    },
    { id: repId, name: 'Objection Rep' },
  );
  activityId = activity.id;
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
});

describe('POST /api/v1/activities/:id/classify-objection', () => {
  it('returns 401 without authentication', async () => {
    await request(app).post(`/api/v1/activities/${activityId}/classify-objection`).expect(401);
  });

  it('returns 404 for a non-existent activity', async () => {
    await request(app)
      .post('/api/v1/activities/00000000-0000-0000-0000-000000000000/classify-objection')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('classifies the activity note and returns the category', async () => {
    const res = await request(app)
      .post(`/api/v1/activities/${activityId}/classify-objection`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.category).toBe('Price');
  });

  it('returns 403 when a rep classifies an activity owned by another rep under a private visibility policy', async () => {
    // Default org visibility policy is 'org' (all reps see all records) — this
    // test asserts the private-policy denial path, so it must set that policy
    // explicitly rather than relying on an unstated default. (MINCRM-472 self-review)
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'activity'`,
    );
    try {
      await request(app)
        .post(`/api/v1/activities/${activityId}/classify-objection`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'activity'`,
      );
    }
  });
});

describe('GET /api/v1/activities/:id/objection-precedents', () => {
  it('returns 401 without authentication', async () => {
    await request(app)
      .get(`/api/v1/activities/${activityId}/objection-precedents?category=Price`)
      .expect(401);
  });

  it('returns 400 for an invalid category', async () => {
    await request(app)
      .get(`/api/v1/activities/${activityId}/objection-precedents?category=NotACategory`)
      .set('Cookie', repCookie)
      .expect(400);
  });

  it('returns insufficient-data by default', async () => {
    const res = await request(app)
      .get(`/api/v1/activities/${activityId}/objection-precedents?category=Price`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.has_sufficient_data).toBe(false);
  });

  it('returns 403 when a rep requests precedents anchored on an activity owned by another rep under a private visibility policy', async () => {
    // Default org visibility policy is 'org' (all reps see all records) — this
    // test asserts the private-policy denial path, so it must set that policy
    // explicitly rather than relying on an unstated default. (MINCRM-472 self-review)
    await pool.query(
      `UPDATE org_visibility_settings SET policy = 'private' WHERE object_type = 'activity'`,
    );
    try {
      await request(app)
        .get(`/api/v1/activities/${activityId}/objection-precedents?category=Price`)
        .set('Cookie', otherRepCookie)
        .expect(403);
    } finally {
      await pool.query(
        `UPDATE org_visibility_settings SET policy = 'org' WHERE object_type = 'activity'`,
      );
    }
  });
});
