/**
 * HTTP contract tests for the test-only email sync routes.
 *
 * The success path of a run is covered in emailSyncNow.test.ts with an injected provider.
 * Over HTTP the real driver runs, and under NODE_ENV=test its transport is refuseLiveFetch,
 * which throws before any request leaves the machine; the run fails and is recorded, which
 * is itself the contract worth pinning.
 */

import 'dotenv/config';
import request from 'supertest';

import { connectedAccountEnvelopeSchema } from '@minicrm/shared/schemas/connectedAccountSchema.js';
import { syncNowResponseSchema } from '@minicrm/shared/schemas/testEmailSyncSchema.js';
import app from '../app.js';
import { toSyncNowResponse } from '../controllers/testEmailSyncController.js';
import pool from '../db.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { requestedScopes } from '../services/oauthProviderService.js';
import { getAccountAuthForSync } from '../services/connectedAccountService.js';
import { createUser } from '../services/userService.js';

import { makeAuthCookie, parkFromScheduler, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'testemailsync';
const SEED_URL = '/api/v1/test/connected-accounts/oauth';
const runUrl = (id: string): string => `/api/v1/test/email-sync/accounts/${id}/run`;

let repCookie: string;
let otherCookie: string;
let viewerCookie: string;

const SEED_BODY = {
  provider: 'google',
  email_address: `${FILE_PREFIX}-box@example.com`,
  access_token: 'emulator-token-rep',
};

/** Seeds through the route, then parks any mailbox it stored so no other suite's tick claims it. */
async function seedAs(cookie: string, body: object = SEED_BODY): Promise<request.Response> {
  const res = await request(app).post(SEED_URL).set('Cookie', cookie).send(body);
  const stored = (res.body as { account?: { id?: string } }).account?.id;
  if (stored) await parkFromScheduler(stored);
  return res;
}

beforeAll(async () => {
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  const cookies: Record<string, string> = {};
  for (const [suffix, role] of [
    ['rep', 'rep'],
    ['other', 'rep'],
    ['viewer', 'viewer'],
  ] as const) {
    const user = await createUser({
      email: `${FILE_PREFIX}-${suffix}@example.com`,
      name: `Test Sync ${suffix}`,
      role,
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    cookies[suffix] = makeAuthCookie({ id: user.id, email: user.email, name: user.name, role });
  }
  // Safe: the loop above assigns all three keys.
  repCookie = cookies['rep']!;
  otherCookie = cookies['other']!;
  viewerCookie = cookies['viewer']!;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  vi.stubEnv('EMAIL_SYNC_SCHEDULER', 'off');
  await pool.query(
    `DELETE FROM connected_accounts
      WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`${FILE_PREFIX}-%@example.com`],
  );
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  await pool.end();
});

describe('boundaries', () => {
  it('returns 401 on both routes when unauthenticated', async () => {
    expect((await request(app).post(SEED_URL).send(SEED_BODY)).status).toBe(401);
    expect((await request(app).post(runUrl('00000000-0000-4000-8000-000000000000'))).status).toBe(
      401,
    );
  });

  it('returns 403 when email_sync is off', async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    invalidateFeatureFlagCache();

    expect((await seedAs(repCookie)).status).toBe(403);
  });

  it('returns 403 on both routes while sync is off org-wide, even for a user forced on', async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    await pool.query(
      `INSERT INTO feature_flag_user_overrides (flag_key, user_id, override)
       SELECT 'email_sync', id, 'force_enabled' FROM users WHERE email = $1`,
      [`${FILE_PREFIX}-rep@example.com`],
    );
    invalidateFeatureFlagCache();
    try {
      const seeded = await seedAs(repCookie);
      const run = await request(app)
        .post(runUrl('00000000-0000-4000-8000-000000000000'))
        .set('Cookie', repCookie);

      expect([seeded.status, seeded.body.error?.code]).toEqual([403, 'FEATURE_DISABLED']);
      expect([run.status, run.body.error?.code]).toEqual([403, 'FEATURE_DISABLED']);
    } finally {
      await pool.query(
        `DELETE FROM feature_flag_user_overrides
          WHERE flag_key = 'email_sync'
            AND user_id IN (SELECT id FROM users WHERE email = $1)`,
        [`${FILE_PREFIX}-rep@example.com`],
      );
    }
  });

  it('returns 403 to a role that may not manage mailboxes', async () => {
    expect((await seedAs(viewerCookie)).status).toBe(403);
  });
});

describe('POST /api/v1/test/connected-accounts/oauth', () => {
  it('stores a mailbox with the scopes real consent requests and no refresh token', async () => {
    const res = await seedAs(repCookie);

    expect(res.status).toBe(201);
    const { account } = connectedAccountEnvelopeSchema.parse(res.body);
    expect(account).toMatchObject({ provider: 'google', email_address: SEED_BODY.email_address });
    expect(account.granted_scopes).toEqual([...requestedScopes('google')]);

    const auth = await getAccountAuthForSync(account.id, () => {
      throw new Error('a token that never expires must not be refreshed');
    });
    expect(auth).toMatchObject({
      kind: 'oauth',
      access_token: SEED_BODY.access_token,
      refresh_token: null,
      expires_at: null,
    });
  });

  it('upserts, so seeding the same mailbox twice keeps one row', async () => {
    const first = connectedAccountEnvelopeSchema.parse((await seedAs(repCookie)).body);
    const second = connectedAccountEnvelopeSchema.parse(
      (await seedAs(repCookie, { ...SEED_BODY, access_token: 'rotated' })).body,
    );

    expect(second.account.id).toBe(first.account.id);
  });

  it('returns 400 for an unknown provider, a bad address, or an extra field', async () => {
    for (const body of [
      { ...SEED_BODY, provider: 'imap' },
      { ...SEED_BODY, email_address: 'not-an-address' },
      { ...SEED_BODY, refresh_token: 'smuggled' },
    ]) {
      expect((await seedAs(repCookie, body)).status).toBe(400);
    }
  });
});

describe('POST /api/v1/test/email-sync/accounts/:id/run', () => {
  async function seededId(): Promise<string> {
    const { account } = connectedAccountEnvelopeSchema.parse((await seedAs(repCookie)).body);
    return account.id;
  }

  it('records a failed run and answers with its outcome, not an error', async () => {
    const id = await seededId();

    const res = await request(app).post(runUrl(id)).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(syncNowResponseSchema.parse(res.body)).toEqual({
      // The driver classifies refuseLiveFetch's throw as an unreachable mailbox.
      outcome: { status: 'failed', error_code: 'CONNECTION_FAILED' },
    });
    const row = await pool.query<{ sync_failure_count: number }>(
      'SELECT sync_failure_count FROM connected_accounts WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.sync_failure_count).toBe(1);
  });

  it("returns 404 for another rep's mailbox", async () => {
    const id = await seededId();

    const res = await request(app).post(runUrl(id)).set('Cookie', otherCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 SCHEDULER_RUNNING when the scheduler is on', async () => {
    const id = await seededId();
    vi.stubEnv('EMAIL_SYNC_SCHEDULER', 'on');

    const res = await request(app).post(runUrl(id)).set('Cookie', repCookie);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULER_RUNNING');
  });

  it('answers 500, recording nothing, when an org sync setting is corrupt', async () => {
    const id = await seededId();
    const saved = await pool.query<{ value: string | null }>(
      `SELECT value FROM system_settings WHERE key = 'email_sync_backfill_days'`,
    );
    await pool.query(
      `UPDATE system_settings SET value = 'not-a-number' WHERE key = 'email_sync_backfill_days'`,
    );
    try {
      const res = await request(app).post(runUrl(id)).set('Cookie', repCookie);

      expect(res.status).toBe(500);
      const row = await pool.query<{ sync_failure_count: number }>(
        'SELECT sync_failure_count FROM connected_accounts WHERE id = $1',
        [id],
      );
      expect(row.rows[0]?.sync_failure_count).toBe(0);
    } finally {
      await pool.query(
        `UPDATE system_settings SET value = $1 WHERE key = 'email_sync_backfill_days'`,
        [saved.rows[0]?.value ?? null],
      );
    }
  });

  it('returns 400 for an id that is not a UUID', async () => {
    expect((await request(app).post(runUrl('nope')).set('Cookie', repCookie)).status).toBe(400);
  });

  it('returns 409 while another run of the mailbox holds its lock', async () => {
    const id = await seededId();
    const holder = await pool.connect();
    try {
      await holder.query(
        "SELECT pg_advisory_lock(hashtext('email_sync_now'), hashtext($1::uuid::text))",
        [id],
      );

      const res = await request(app).post(runUrl(id)).set('Cookie', repCookie);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SYNC_IN_PROGRESS');
    } finally {
      await holder.query(
        "SELECT pg_advisory_unlock(hashtext('email_sync_now'), hashtext($1::uuid::text))",
        [id],
      );
      holder.release();
    }
  });
});

describe('toSyncNowResponse', () => {
  it('maps a synced run to the wire form the schema accepts', () => {
    const body = toSyncNowResponse({
      status: 'synced',
      outcome: { accountId: 'a', messagesStored: 3, hasMore: true, cursorInvalid: false },
    });

    expect(syncNowResponseSchema.parse(body)).toEqual({
      outcome: { status: 'synced', messages_stored: 3, has_more: true, cursor_invalid: false },
    });
  });

  it('maps a failed run to its error code', () => {
    const body = toSyncNowResponse({ status: 'failed', errorCode: 'CONNECTION_FAILED' });

    expect(syncNowResponseSchema.parse(body)).toEqual({
      outcome: { status: 'failed', error_code: 'CONNECTION_FAILED' },
    });
  });
});
