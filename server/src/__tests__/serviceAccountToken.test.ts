/**
 * Service account API token lifecycle tests (MINCRM-536).
 *
 * Covers:
 *   - issueServiceAccountToken: generates a unique plaintext token, stores its hash,
 *     returns null for non-service-account users, writes an audit entry, rotates
 *     an existing token in one atomic update.
 *   - revokeServiceAccountToken: NULLs the hash columns, returns false for unknown
 *     users, writes an audit entry.
 *   - findUserByApiToken: resolves the matching user by hashing the raw token,
 *     returns null for wrong tokens, inactive accounts, and non-service-account users.
 *   - Bearer token authentication via the HTTP layer (supertest).
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import {
  createUser,
  issueServiceAccountToken,
  revokeServiceAccountToken,
  findUserByApiToken,
} from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'sa-tok';
const ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

beforeEach(async () => {
  await pool.query('DELETE FROM contacts WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

afterAll(async () => {
  await pool.query('DELETE FROM contacts WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── issueServiceAccountToken ──────────────────────────────────────────────────

describe('issueServiceAccountToken', () => {
  it('returns a plaintext token and issuedAt when user is a service_account', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-1@example.com`,
      name: 'Service Account 1',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });

    const result = await issueServiceAccountToken(sa.id, ACTOR);

    expect(result).not.toBeNull();
    expect(typeof result!.plaintextToken).toBe('string');
    expect(result!.plaintextToken.length).toBeGreaterThan(0);
    expect(result!.issuedAt).toBeInstanceOf(Date);
  });

  it('stores a non-null api_token_hash in the database after issuance', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-hash@example.com`,
      name: 'SA Hash Check',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });

    await issueServiceAccountToken(sa.id, ACTOR);

    const { rows } = await pool.query<{ api_token_hash: string | null }>(
      'SELECT api_token_hash FROM users WHERE id = $1',
      [sa.id],
    );
    expect(rows[0].api_token_hash).not.toBeNull();
    // The plaintext token must not be stored — only its hash
    const result = await issueServiceAccountToken(sa.id, ACTOR);
    expect(rows[0].api_token_hash).not.toBe(result!.plaintextToken);
  });

  it('returns null for a non-service-account user (role=rep)', async () => {
    const rep = await createUser({
      email: `${FILE_PREFIX}-rep@example.com`,
      name: 'Rep Not SA',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const result = await issueServiceAccountToken(rep.id, ACTOR);

    expect(result).toBeNull();
  });

  it('returns null for a non-existent user ID', async () => {
    const result = await issueServiceAccountToken('00000000-0000-0000-0000-999999999999', ACTOR);
    expect(result).toBeNull();
  });

  it('rotates an existing token — new hash differs from the previous one', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-rotate@example.com`,
      name: 'SA Rotate',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });

    await issueServiceAccountToken(sa.id, ACTOR);
    const { rows: before } = await pool.query<{ api_token_hash: string }>(
      'SELECT api_token_hash FROM users WHERE id = $1',
      [sa.id],
    );
    const firstHash = before[0].api_token_hash;

    await issueServiceAccountToken(sa.id, ACTOR);
    const { rows: after } = await pool.query<{ api_token_hash: string }>(
      'SELECT api_token_hash FROM users WHERE id = $1',
      [sa.id],
    );
    expect(after[0].api_token_hash).not.toBe(firstHash);
  });

  it('writes an api_token_issued audit entry in the same transaction', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-audit-issue@example.com`,
      name: 'SA Audit Issue',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });

    await issueServiceAccountToken(sa.id, ACTOR);

    const { rows } = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log
       WHERE record_type = 'user' AND record_id = $1 AND event_type = 'api_token_issued'
       ORDER BY created_at DESC LIMIT 1`,
      [sa.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('api_token_issued');
  });
});

// ── revokeServiceAccountToken ─────────────────────────────────────────────────

describe('revokeServiceAccountToken', () => {
  it('returns true and NULLs both token columns after revocation', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-revoke@example.com`,
      name: 'SA Revoke',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    await issueServiceAccountToken(sa.id, ACTOR);

    const revoked = await revokeServiceAccountToken(sa.id, ACTOR);

    expect(revoked).toBe(true);
    const { rows } = await pool.query<{
      api_token_hash: string | null;
      api_token_issued_at: Date | null;
    }>('SELECT api_token_hash, api_token_issued_at FROM users WHERE id = $1', [sa.id]);
    expect(rows[0].api_token_hash).toBeNull();
    expect(rows[0].api_token_issued_at).toBeNull();
  });

  it('returns false for a non-existent user ID', async () => {
    const result = await revokeServiceAccountToken('00000000-0000-0000-0000-999999999999', ACTOR);
    expect(result).toBe(false);
  });

  it('returns false when the service account has no active token', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-no-token@example.com`,
      name: 'SA No Token',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });

    const result = await revokeServiceAccountToken(sa.id, ACTOR);

    expect(result).toBe(false);
  });

  it('returns false for a non-service-account user', async () => {
    const rep = await createUser({
      email: `${FILE_PREFIX}-rep-revoke@example.com`,
      name: 'Rep Cannot Revoke',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const result = await revokeServiceAccountToken(rep.id, ACTOR);

    expect(result).toBe(false);
  });

  it('writes an api_token_revoked audit entry in the same transaction', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-audit-revoke@example.com`,
      name: 'SA Audit Revoke',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    await issueServiceAccountToken(sa.id, ACTOR);
    await revokeServiceAccountToken(sa.id, ACTOR);

    const { rows } = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_log
       WHERE record_type = 'user' AND record_id = $1 AND event_type = 'api_token_revoked'
       ORDER BY created_at DESC LIMIT 1`,
      [sa.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('api_token_revoked');
  });
});

// ── findUserByApiToken ────────────────────────────────────────────────────────

describe('findUserByApiToken', () => {
  it('returns the matching UserRow for a valid active service account token', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-find@example.com`,
      name: 'SA Find',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);

    const found = await findUserByApiToken(issued!.plaintextToken);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(sa.id);
    expect(found!.role).toBe('service_account');
  });

  it('returns null for an incorrect token', async () => {
    const result = await findUserByApiToken('not-a-real-token');
    expect(result).toBeNull();
  });

  it('returns null after the token has been revoked', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-find-revoked@example.com`,
      name: 'SA Find Revoked',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);
    await revokeServiceAccountToken(sa.id, ACTOR);

    const result = await findUserByApiToken(issued!.plaintextToken);

    expect(result).toBeNull();
  });

  it('returns null when the service account is inactive', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-inactive@example.com`,
      name: 'SA Inactive',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);

    // Deactivate the account
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [sa.id]);

    const result = await findUserByApiToken(issued!.plaintextToken);

    expect(result).toBeNull();
  });
});

// ── Bearer token HTTP authentication ─────────────────────────────────────────

describe('MINCRM-536 — Bearer token HTTP authentication', () => {
  it('authenticates a service account via Authorization: Bearer and returns 200 on GET contacts', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-http@example.com`,
      name: 'SA HTTP',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);

    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${issued!.plaintextToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 401 AUTH_INVALID_TOKEN for an unknown Bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Authorization', 'Bearer totally-fake-token');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 401 AUTH_INVALID_TOKEN for a revoked Bearer token', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-http-revoked@example.com`,
      name: 'SA HTTP Revoked',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);
    await revokeServiceAccountToken(sa.id, ACTOR);

    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Authorization', `Bearer ${issued!.plaintextToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('service account cannot access admin-only endpoints (403 AUTH_FORBIDDEN)', async () => {
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-http-admin@example.com`,
      name: 'SA HTTP Admin',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);

    // POST /api/v1/users is admin-only
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${issued!.plaintextToken}`)
      .send({
        email: 'new@example.com',
        name: 'New User',
        role: 'rep',
      });

    expect(res.status).toBe(403);
  });

  it('service account can create contacts via bearer token (contacts:create in built-in role, MINCRM-542)', async () => {
    // Migration 107 grants contacts:create (and other data capabilities) to the service_account
    // built-in role. Bearer-authenticated requests from service accounts go through normal
    // capability resolution — SERVICE_ACCOUNT_UI_BLOCKED only fires for cookie-authenticated
    // service accounts, which is the wrong auth method for a machine-to-machine caller.
    const sa = await createUser({
      email: `${FILE_PREFIX}-sa-write@example.com`,
      name: 'SA Write',
      role: 'service_account',
      passwordHash: null,
      status: 'active',
    });
    const issued = await issueServiceAccountToken(sa.id, ACTOR);

    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${issued!.plaintextToken}`)
      .send({
        first_name: 'API',
        last_name: 'Created',
        email: `${FILE_PREFIX}-created-contact@example.com`,
      });

    expect(res.status).toBe(201);
    expect(res.body.contact).toMatchObject({ first_name: 'API', last_name: 'Created' });
  });
});
