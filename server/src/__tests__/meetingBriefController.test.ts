/**
 * HTTP contract tests for meeting brief endpoints.
 *
 * Covers:
 *  - POST /activities/:id/brief: authenticated, flag-gated, ownership-enforced
 *  - GET /activities/:id/brief: authenticated, flag-gated, ownership-enforced
 *  - Unauthenticated requests are rejected
 */

import 'dotenv/config';
import { vi } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
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
import pool from '../db.js';
import { utcDayOffset } from '../utils/utcDate.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createActivity } from '../services/activityService.js';
import { encryptVersioned } from '../services/cryptoService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'meeting-brief-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Meeting Brief Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });

  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Meeting Brief Rep',
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
});

beforeEach(async () => {
  vi.clearAllMocks();
  const { ciphertext, keyVersion } = encryptVersioned('sk-ant-mock-key-for-tests');
  await pool.query(
    `UPDATE ai_configuration SET enabled = true, api_key_encrypted = $1, api_key_key_version = $2, model = 'claude-sonnet-4-20250514'`,
    [ciphertext, keyVersion],
  );
  // Avoid analyzeContactSignals/scoreActivitySentiment cross-contaminating mockCreate
  // (both fire on createActivity() with a contact_id set).
  await pool.query(
    `UPDATE feature_flags SET enabled = false
     WHERE flag_key IN ('ai_sentiment_tracking', 'ai_champion_blocker_detection')`,
  );
  // Guard against the ai_features master toggle being left disabled by another
  // serial-project test file's in-flight PATCH (e.g. aiConfigController.test.ts's
  // master-toggle test) — every ai_* sub-feature flag, including ai_meeting_brief,
  // is gated on ai_features being enabled. Same defensive pattern as
  // objectionMatchingController.test.ts's ensureAiFeaturesEnabled().
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'ai_features'`);
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(`UPDATE ai_configuration SET enabled = false, api_key_encrypted = ''`);
  // Restore the flags disabled in beforeEach — feature_flags is a shared global table and
  // this file runs serially alongside every other test file, so leaving them disabled would
  // break unrelated later suites (e.g. championBlockerService/-Controller, sentimentService).
  await pool.query(
    `UPDATE feature_flags SET enabled = true
     WHERE flag_key IN ('ai_sentiment_tracking', 'ai_champion_blocker_detection')`,
  );
  invalidateFeatureFlagCache();
});

async function createTestActivity(): Promise<string> {
  const contact = await createContact(
    {
      first_name: 'Jane',
      last_name: `Doe-${Date.now()}-${Math.random()}`,
      email: `jane-${Date.now()}-${Math.random()}@example.com`,
      owner_id: repId,
    },
    { id: repId, name: 'Meeting Brief Rep' },
  );
  // due_date must be present and today-or-future — the brief generation
  // endpoint enforces the same future-dated Call/Meeting eligibility gate the
  // UI applies (see ActivityTimeline's BRIEF_ELIGIBLE_TYPES).
  // utcDayOffset, not local setDate(+1): a DST transition makes the local shift
  // land on the same UTC day, so "tomorrow" would not be in the future.
  // CI runs TZ=Pacific/Auckland.
  const tomorrowUtc = utcDayOffset(new Date(), 1);
  const activity = await createActivity(
    {
      type: 'Call',
      subject: 'Upcoming call',
      contact_id: contact.id,
      owner_id: repId,
      due_date: tomorrowUtc,
    },
    { id: repId, name: 'Meeting Brief Rep' },
  );
  return activity.id;
}

function mockBriefResponse(): void {
  mockCreate.mockResolvedValue({
    usage: { input_tokens: 50, output_tokens: 20 },
    content: [
      {
        type: 'tool_use',
        name: 'report_meeting_brief',
        input: {
          account_summary: 'Summary.',
          recent_activity_summary: [],
          suggested_talking_points: ['Point one.', 'Point two.', 'Point three.'],
          next_steps: [],
        },
      },
    ],
  });
}

describe('POST /api/v1/activities/:id/brief', () => {
  it('returns 401 without authentication', async () => {
    const activityId = await createTestActivity();
    await request(app).post(`/api/v1/activities/${activityId}/brief`).expect(401);
  });

  it('generates and returns a brief for an owned activity', async () => {
    const activityId = await createTestActivity();
    mockBriefResponse();

    const res = await request(app)
      .post(`/api/v1/activities/${activityId}/brief`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.brief.account_summary).toBe('Summary.');
  });

  it('returns 404 for a non-existent activity', async () => {
    await request(app)
      .post('/api/v1/activities/00000000-0000-0000-0000-000000000000/brief')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests a brief for an activity owned by another rep', async () => {
    const activityId = await createTestActivity();
    await request(app)
      .post(`/api/v1/activities/${activityId}/brief`)
      .set('Cookie', otherRepCookie)
      .expect(403);
  });
});

describe('GET /api/v1/activities/:id/brief', () => {
  it('returns 401 without authentication', async () => {
    const activityId = await createTestActivity();
    await request(app).get(`/api/v1/activities/${activityId}/brief`).expect(401);
  });

  it('returns 404 when no brief has been generated yet', async () => {
    const activityId = await createTestActivity();
    await request(app)
      .get(`/api/v1/activities/${activityId}/brief`)
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns the persisted brief after generation', async () => {
    const activityId = await createTestActivity();
    mockBriefResponse();
    await request(app)
      .post(`/api/v1/activities/${activityId}/brief`)
      .set('Cookie', repCookie)
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/activities/${activityId}/brief`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.brief.account_summary).toBe('Summary.');
  });

  it('returns 403 when a rep requests a brief for an activity owned by another rep', async () => {
    const activityId = await createTestActivity();
    await request(app)
      .get(`/api/v1/activities/${activityId}/brief`)
      .set('Cookie', otherRepCookie)
      .expect(403);
  });
});
