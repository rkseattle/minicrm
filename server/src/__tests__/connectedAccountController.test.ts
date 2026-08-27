/**
 * HTTP contract tests for connectedAccountController.
 *
 * Covers the auth boundary on every route, the Zod boundary, the horizontal-privilege
 * boundary over HTTP, and that no response carries credential material.
 *
 * The success path of an IMAP connect is not exercised: it requires a reachable IMAP
 * server, and the test stack runs none. The connection-refused path is real coverage of
 * the same code, since it proves nothing is persisted when the test fails.
 */

import 'dotenv/config';
import request from 'supertest';

import app from '../app.js';
import pool from '../db.js';
import { createImapAccount, upsertOAuthAccount } from '../services/connectedAccountService.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { createUser } from '../services/userService.js';

import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'connacctctl';

let repACookie: string;
let repBCookie: string;
let adminCookie: string;
let repAId: string;
let repBId: string;

/** A port nothing listens on, so a permitted host is refused rather than hanging. */
const CLOSED_PORT = 9;

/**
 * Reserved by RFC 2606 and guaranteed never to resolve, so the attempt fails at DNS
 * without leaving the machine. A private or loopback host would be refused by the SSRF
 * guard before any connect, which is a different code path.
 */
const VALID_BODY = {
  email_address: `${FILE_PREFIX}-box@example.com`,
  host: 'imap.invalid',
  port: CLOSED_PORT,
  username: `${FILE_PREFIX}-box@example.com`,
  password: 'a-very-secret-password',
  secure: false,
};

async function deleteFixtureUsers(): Promise<void> {
  await pool.query(`DELETE FROM users WHERE email LIKE '${FILE_PREFIX}-%@example.com'`);
}

beforeAll(async () => {
  await deleteFixtureUsers();

  const repA = await createUser({
    email: `${FILE_PREFIX}-a@example.com`,
    name: 'Contract Rep A',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repAId = repA.id;
  repACookie = makeAuthCookie({ id: repA.id, email: repA.email, name: repA.name, role: repA.role });

  const repB = await createUser({
    email: `${FILE_PREFIX}-b@example.com`,
    name: 'Contract Rep B',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repBId = repB.id;
  repBCookie = makeAuthCookie({ id: repB.id, email: repB.email, name: repB.name, role: repB.role });

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Contract Admin',
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

beforeEach(async () => {
  await pool.query('DELETE FROM connected_accounts WHERE user_id = ANY($1::uuid[])', [
    [repAId, repBId],
  ]);
  // Seeded off, since a fresh install has no OAuth apps registered. Every test below
  // exercises the feature itself; the gate has its own describe block.
  await pool.query(`UPDATE feature_flags SET enabled = true WHERE flag_key = 'email_sync'`);
  // The service caches flags for 60s, so the write alone is invisible to the next read.
  invalidateFeatureFlagCache();
});

afterAll(async () => {
  await deleteFixtureUsers();
  await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
  await pool.end();
});

describe('authentication boundary', () => {
  it('returns 401 on GET when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/connected-accounts');
    expect(res.status).toBe(401);
  });

  it('returns 401 on POST when unauthenticated', async () => {
    const res = await request(app).post('/api/v1/connected-accounts').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('returns 401 on DELETE when unauthenticated', async () => {
    const res = await request(app).delete(
      '/api/v1/connected-accounts/00000000-0000-0000-0000-000000000001',
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 on the test endpoint when unauthenticated', async () => {
    const res = await request(app).post(
      '/api/v1/connected-accounts/00000000-0000-0000-0000-000000000001/test',
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/connected-accounts — validation', () => {
  it('rejects a malformed email address', async () => {
    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send({ ...VALID_BODY, email_address: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range port', async () => {
    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send({ ...VALID_BODY, port: 99999 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing password', async () => {
    const { password: _omitted, ...withoutPassword } = VALID_BODY;
    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send(withoutPassword);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/connected-accounts — connection test gates the write', () => {
  it('returns CONNECTION_FAILED and persists nothing when the server is unreachable', async () => {
    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONNECTION_FAILED');

    const stored = await pool.query('SELECT id FROM connected_accounts WHERE user_id = $1', [
      repAId,
    ]);
    expect(stored.rows).toHaveLength(0);
  });

  it('never echoes the submitted password back', async () => {
    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send(VALID_BODY);

    expect(JSON.stringify(res.body)).not.toContain(VALID_BODY.password);
  });
});

describe('SSRF: the server refuses to dial internal addresses', () => {
  // Without the guard these are a port scanner any rep can drive: the response code and
  // its timing distinguish an open internal port from a closed one.
  const INTERNAL_HOSTS = [
    ['loopback', '127.0.0.1'],
    ['cloud metadata', '169.254.169.254'],
    ['RFC 1918 ten', '10.0.0.1'],
    ['RFC 1918 one-ninety-two', '192.168.0.1'],
    ['IPv6 loopback', '::1'],
  ] as const;

  for (const [label, host] of INTERNAL_HOSTS) {
    it(`refuses ${label} (${host}) and persists nothing`, async () => {
      const res = await request(app)
        .post('/api/v1/connected-accounts')
        .set('Cookie', repACookie)
        .send({ ...VALID_BODY, host, port: 80 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CONNECTION_FAILED');

      const stored = await pool.query('SELECT id FROM connected_accounts WHERE user_id = $1', [
        repAId,
      ]);
      expect(stored.rows).toHaveLength(0);
    });
  }

  it('gives a blocked address the same answer as an unreachable one', async () => {
    const blocked = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send({ ...VALID_BODY, host: '127.0.0.1', port: 80 });

    const unreachable = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send(VALID_BODY);

    // Identical bodies: the response must not tell an attacker which hosts exist.
    expect(blocked.body).toEqual(unreachable.body);
  });

  /*
   * Asserting a 400 proves nothing on its own: dialing an internal port fails anyway,
   * because nothing there speaks IMAP. What the guard changes is that no socket is
   * opened at all, so the only honest assertion is that the refusal beats the shortest
   * network path — a real dial cannot return before the greeting timeout.
   */
  it('refuses without opening a socket, faster than any dial could return', async () => {
    const startedAt = process.hrtime.bigint();
    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send({ ...VALID_BODY, host: '127.0.0.1', port: 80 });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    expect(res.status).toBe(400);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});

describe('GET /api/v1/connected-accounts', () => {
  it('returns only the calling user accounts', async () => {
    await createImapAccount(repBId, VALID_BODY, { id: repBId, name: 'Contract Rep B' });

    const res = await request(app).get('/api/v1/connected-accounts').set('Cookie', repACookie);

    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([]);
  });

  it('never includes credential material', async () => {
    await createImapAccount(repAId, VALID_BODY, { id: repAId, name: 'Contract Rep A' });

    const res = await request(app).get('/api/v1/connected-accounts').set('Cookie', repACookie);

    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).not.toHaveProperty('auth_encrypted');
    expect(res.body.accounts[0]).not.toHaveProperty('key_version');
    expect(JSON.stringify(res.body)).not.toContain(VALID_BODY.password);
  });
});

describe('horizontal privilege over HTTP', () => {
  it("returns 404 when rep A deletes rep B's account", async () => {
    const account = await createImapAccount(repBId, VALID_BODY, {
      id: repBId,
      name: 'Contract Rep B',
    });

    const res = await request(app)
      .delete(`/api/v1/connected-accounts/${account.id}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(404);

    const survivors = await pool.query('SELECT id FROM connected_accounts WHERE user_id = $1', [
      repBId,
    ]);
    expect(survivors.rows).toHaveLength(1);
  });

  it("returns 404 when an admin deletes a rep's account", async () => {
    const account = await createImapAccount(repBId, VALID_BODY, {
      id: repBId,
      name: 'Contract Rep B',
    });

    const res = await request(app)
      .delete(`/api/v1/connected-accounts/${account.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  it("returns 404 when rep A tests rep B's account", async () => {
    const account = await createImapAccount(repBId, VALID_BODY, {
      id: repBId,
      name: 'Contract Rep B',
    });

    const res = await request(app)
      .post(`/api/v1/connected-accounts/${account.id}/test`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(404);
  });

  it('deletes the account when its own owner asks', async () => {
    const account = await createImapAccount(repAId, VALID_BODY, {
      id: repAId,
      name: 'Contract Rep A',
    });

    const res = await request(app)
      .delete(`/api/v1/connected-accounts/${account.id}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(204);

    const remaining = await pool.query('SELECT id FROM connected_accounts WHERE user_id = $1', [
      repAId,
    ]);
    expect(remaining.rows).toHaveLength(0);
  });

  // The 404s above must come from ownership, not from a blanket deny.
  it('lets rep B delete their own account after rep A was refused it', async () => {
    const account = await createImapAccount(repBId, VALID_BODY, {
      id: repBId,
      name: 'Contract Rep B',
    });

    const refused = await request(app)
      .delete(`/api/v1/connected-accounts/${account.id}`)
      .set('Cookie', repACookie);
    expect(refused.status).toBe(404);

    const allowed = await request(app)
      .delete(`/api/v1/connected-accounts/${account.id}`)
      .set('Cookie', repBCookie);
    expect(allowed.status).toBe(204);
  });
});

describe('path parameter validation', () => {
  it('returns 400 for a non-UUID account id', async () => {
    const res = await request(app)
      .delete('/api/v1/connected-accounts/not-a-uuid')
      .set('Cookie', repACookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/connected-accounts/:id/test', () => {
  it('returns 200 with success false and records the error on the row', async () => {
    const account = await createImapAccount(repAId, VALID_BODY, {
      id: repAId,
      name: 'Contract Rep A',
    });

    const res = await request(app)
      .post(`/api/v1/connected-accounts/${account.id}/test`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);

    const row = await pool.query<{ status: string; status_detail: string | null }>(
      'SELECT status, status_detail FROM connected_accounts WHERE id = $1',
      [account.id],
    );
    expect(row.rows[0].status).toBe('error');
    expect(row.rows[0].status_detail).not.toBeNull();
  });

  it('returns 404 for an account that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/connected-accounts/00000000-0000-0000-0000-000000000001/test')
      .set('Cookie', repACookie);

    expect(res.status).toBe(404);
  });
});

describe('DELETE of an OAuth account', () => {
  it('deletes it and reaches the revocation branch', async () => {
    const account = await upsertOAuthAccount(
      {
        userId: repAId,
        provider: 'google',
        emailAddress: `${FILE_PREFIX}-oauth@example.com`,
        auth: {
          kind: 'oauth',
          access_token: 'access-one',
          refresh_token: 'refresh-one',
          expires_at: null,
        },
        grantedScopes: [],
      },
      { id: repAId, name: 'Contract Rep A' },
    );

    const res = await request(app)
      .delete(`/api/v1/connected-accounts/${account.id}`)
      .set('Cookie', repACookie);

    expect(res.status).toBe(204);

    const remaining = await pool.query('SELECT id FROM connected_accounts WHERE id = $1', [
      account.id,
    ]);
    expect(remaining.rows).toHaveLength(0);
  });
});

/*
 * The flag is a single row every test in this file shares, so these run in sequence and
 * restore it. Vitest interleaves `it`s within a file, and a parallel block that switched
 * the flag off turned every other test in the file into a 403.
 */
describe.sequential('the email_sync feature flag gates every route', () => {
  /** The file-level beforeEach turns the flag on, so each test here turns it back off. */
  async function disableEmailSync(): Promise<void> {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    invalidateFeatureFlagCache();
  }

  it('returns 403 FEATURE_DISABLED on GET when the flag is off', async () => {
    await disableEmailSync();

    const res = await request(app).get('/api/v1/connected-accounts').set('Cookie', repACookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('returns 403 on POST when the flag is off, without dialing anything', async () => {
    await disableEmailSync();

    const res = await request(app)
      .post('/api/v1/connected-accounts')
      .set('Cookie', repACookie)
      .send(VALID_BODY);

    expect(res.status).toBe(403);
  });
});

/*
 * The OAuth legs redirect on every rejection rather than answering JSON, so their guards
 * are invisible to a status-code assertion alone — the Location value is the only proof
 * that a specific guard fired.
 */
describe.sequential('OAuth routes reject before reaching a provider', () => {
  function connectCode(location: string | undefined): string | null {
    if (!location) return null;
    return new URL(location, 'http://localhost').searchParams.get('connect');
  }

  it('redirects rather than returning JSON when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/connected-accounts/oauth/google/start');

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('SESSION_EXPIRED');
    expect(res.text).not.toContain('AUTH_MISSING_TOKEN');
  });

  it('redirects the callback too when unauthenticated', async () => {
    const res = await request(app).get(
      '/api/v1/connected-accounts/oauth/google/callback?state=abc',
    );

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('SESSION_EXPIRED');
  });

  it('refuses a user whose role lacks the capability', async () => {
    // viewer is never granted connected_accounts:manage by migration 170.
    const viewer = await createUser({
      email: `${FILE_PREFIX}-viewer@example.com`,
      name: 'Contract Viewer',
      role: 'viewer',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const viewerCookie = makeAuthCookie({
      id: viewer.id,
      email: viewer.email,
      name: viewer.name,
      role: viewer.role,
    });

    const res = await request(app)
      .get('/api/v1/connected-accounts/oauth/google/start')
      .set('Cookie', viewerCookie);

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('INSUFFICIENT_CAPABILITY');

    const states = await pool.query('SELECT state FROM connected_account_oauth_states');
    expect(states.rows).toHaveLength(0);
  });

  it('reports an unconfigured provider without starting a flow', async () => {
    // The test stack leaves the client IDs empty on purpose.
    const res = await request(app)
      .get('/api/v1/connected-accounts/oauth/google/start')
      .set('Cookie', repACookie);

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('PROVIDER_NOT_CONFIGURED');

    const states = await pool.query('SELECT state FROM connected_account_oauth_states');
    expect(states.rows).toHaveLength(0);
  });

  it('rejects an unknown provider', async () => {
    const res = await request(app)
      .get('/api/v1/connected-accounts/oauth/yahoo/start')
      .set('Cookie', repACookie);

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('OAUTH_FAILED');
  });

  it('rejects a callback whose state row does not exist', async () => {
    const res = await request(app)
      .get('/api/v1/connected-accounts/oauth/google/callback?state=never-issued&code=x')
      .set('Cookie', repACookie);

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('OAUTH_STATE_INVALID');
  });

  it('rejects a callback with no state at all', async () => {
    const res = await request(app)
      .get('/api/v1/connected-accounts/oauth/google/callback?code=x')
      .set('Cookie', repACookie);

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('OAUTH_STATE_INVALID');
  });

  it('refuses the OAuth legs when the flag is off', async () => {
    await pool.query(`UPDATE feature_flags SET enabled = false WHERE flag_key = 'email_sync'`);
    invalidateFeatureFlagCache();

    const res = await request(app)
      .get('/api/v1/connected-accounts/oauth/google/start')
      .set('Cookie', repACookie);

    expect(res.status).toBe(302);
    expect(connectCode(res.headers.location)).toBe('FEATURE_DISABLED');
  });
});
