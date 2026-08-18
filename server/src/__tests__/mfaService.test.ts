/**
 * Integration tests for mfaService.
 *
 * Covers: MFA setup/verify/disable round-trip, recovery code burn-on-use,
 * TOTP login challenge flow (valid + invalid codes), MFA token issuance/verification,
 * and auth boundary enforcement.
 *
 * Runs against the real minicrm_test PostgreSQL database.
 */

import 'dotenv/config';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  initiateMfaSetup,
  enableMfa,
  disableMfa,
  issueMfaToken,
  verifyMfaToken,
  verifyTotpCode,
  verifyAndConsumeRecoveryCode,
  getMfaStatus,
} from '../services/mfaService.js';
import { decrypt } from '../services/cryptoService.js';
import { makeAuthCookie } from './testUtils.js';

const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Actor' };
const BASE_USER = {
  name: 'MFA Test User',
  role: 'rep' as const,
  passwordHash: '$2b$12$abc',
  status: 'active' as const,
};

let userId: string;
let authCookie: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'mfa-test-%'");

  const user = await createUser({ ...BASE_USER, email: 'mfa-test-main@example.com' });
  userId = user.id;
  authCookie = makeAuthCookie({ id: user.id, email: user.email, name: user.name, role: user.role });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'mfa-test-%'");
  await pool.end();
});

// ── getMfaStatus ───────────────────────────────────────────────────────────────

describe('getMfaStatus', () => {
  it('returns enabled=false and 0 recovery codes for a new user', async () => {
    const status = await getMfaStatus(userId);
    expect(status.enabled).toBe(false);
    expect(status.recoveryCodesRemaining).toBe(0);
  });

  it('throws when user does not exist', async () => {
    await expect(getMfaStatus('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'User not found',
    );
  });
});

// ── initiateMfaSetup ──────────────────────────────────────────────────────────

describe('initiateMfaSetup', () => {
  afterEach(async () => {
    await pool.query('UPDATE users SET mfa_pending_secret = NULL WHERE id = $1', [userId]);
  });

  it('stores an encrypted pending secret', async () => {
    await initiateMfaSetup(userId);
    const row = await pool.query<{ mfa_pending_secret: string | null }>(
      'SELECT mfa_pending_secret FROM users WHERE id = $1',
      [userId],
    );
    expect(row.rows[0]!.mfa_pending_secret).not.toBeNull();
    const decrypted = decrypt(row.rows[0]!.mfa_pending_secret!);
    expect(decrypted.length).toBeGreaterThan(0);
  });

  it('returns a non-empty QR data URL and otpauth URL', async () => {
    const { qrDataUrl, otpauthUrl } = await initiateMfaSetup(userId);
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  });
});

// ── enableMfa ─────────────────────────────────────────────────────────────────

describe('enableMfa', () => {
  let plainSecret: string;

  beforeEach(async () => {
    await pool.query(
      'UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_recovery_codes = $1 WHERE id = $2',
      ['{}', userId],
    );
    const { otpauthUrl } = await initiateMfaSetup(userId);
    // Extract the base32 secret from the otpauth URL to generate valid TOTP
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    plainSecret = match![1]!;
  });

  afterEach(async () => {
    await pool.query(
      'UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_recovery_codes = $1 WHERE id = $2',
      ['{}', userId],
    );
  });

  it('enables MFA and returns 8 plaintext recovery codes on valid TOTP', async () => {
    const validCode = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    const { recoveryCodes } = await enableMfa(userId, validCode, ACTOR);
    expect(recoveryCodes).toHaveLength(8);
    recoveryCodes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{16}$/));
  });

  it('sets mfa_enabled=true in the DB on success', async () => {
    const validCode = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    await enableMfa(userId, validCode, ACTOR);
    const status = await getMfaStatus(userId);
    expect(status.enabled).toBe(true);
    expect(status.recoveryCodesRemaining).toBe(8);
  });

  it('stores hashed recovery codes (not plaintext)', async () => {
    const validCode = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    const { recoveryCodes } = await enableMfa(userId, validCode, ACTOR);
    const row = await pool.query<{ mfa_recovery_codes: string[] }>(
      'SELECT mfa_recovery_codes FROM users WHERE id = $1',
      [userId],
    );
    const stored = row.rows[0]!.mfa_recovery_codes;
    expect(stored).toHaveLength(8);
    // Stored values are bcrypt hashes, not the original codes
    const firstHashMatches = await bcrypt.compare(recoveryCodes[0]!.toLowerCase(), stored[0]!);
    expect(firstHashMatches).toBe(true);
    // Original codes are NOT stored verbatim
    expect(stored[0]).not.toBe(recoveryCodes[0]);
  });

  it('writes an mfa_enabled audit entry', async () => {
    const validCode = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    await enableMfa(userId, validCode, ACTOR);
    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = $1 AND event_type = 'mfa_enabled' ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    expect(audit.rows.length).toBe(1);
  });

  it('throws MFA_INVALID_CODE for a wrong TOTP code', async () => {
    await expect(enableMfa(userId, '000000', ACTOR)).rejects.toThrow('MFA_INVALID_CODE');
  });

  it('throws MFA_SETUP_NOT_INITIATED when no pending secret exists', async () => {
    await pool.query('UPDATE users SET mfa_pending_secret = NULL WHERE id = $1', [userId]);
    await expect(enableMfa(userId, '123456', ACTOR)).rejects.toThrow('MFA_SETUP_NOT_INITIATED');
  });

  it('throws MFA_ALREADY_ENABLED when MFA is already active', async () => {
    const validCode = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    await enableMfa(userId, validCode, ACTOR);
    // Try to enable again
    await initiateMfaSetup(userId);
    const { otpauthUrl } = await initiateMfaSetup(userId);
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    const newSecret = match![1]!;
    const newCode = speakeasy.totp({ secret: newSecret, encoding: 'base32' });
    await expect(enableMfa(userId, newCode, ACTOR)).rejects.toThrow('MFA_ALREADY_ENABLED');
  });
});

// ── disableMfa ────────────────────────────────────────────────────────────────

describe('disableMfa', () => {
  const PLAINTEXT_PASSWORD = 'TestPass@123';
  let passwordHash: string;
  let enabledUserId: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(PLAINTEXT_PASSWORD, 10);
    const user = await createUser({
      ...BASE_USER,
      email: 'mfa-test-disable@example.com',
      passwordHash,
    });
    enabledUserId = user.id;
  });

  beforeEach(async () => {
    // Enable MFA so we can disable it
    const { otpauthUrl } = await initiateMfaSetup(enabledUserId);
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    const secret = match![1]!;
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    await enableMfa(enabledUserId, code, ACTOR);
  });

  afterEach(async () => {
    await pool.query(
      'UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_recovery_codes = $1 WHERE id = $2',
      ['{}', enabledUserId],
    );
  });

  it('disables MFA when the correct password is supplied', async () => {
    await disableMfa(enabledUserId, passwordHash, PLAINTEXT_PASSWORD, ACTOR);
    const status = await getMfaStatus(enabledUserId);
    expect(status.enabled).toBe(false);
    expect(status.recoveryCodesRemaining).toBe(0);
  });

  it('clears mfa_secret and recovery codes after disable', async () => {
    await disableMfa(enabledUserId, passwordHash, PLAINTEXT_PASSWORD, ACTOR);
    const row = await pool.query<{ mfa_secret: string | null; mfa_recovery_codes: string[] }>(
      'SELECT mfa_secret, mfa_recovery_codes FROM users WHERE id = $1',
      [enabledUserId],
    );
    expect(row.rows[0]!.mfa_secret).toBeNull();
    expect(row.rows[0]!.mfa_recovery_codes).toHaveLength(0);
  });

  it('writes an mfa_disabled audit entry', async () => {
    await disableMfa(enabledUserId, passwordHash, PLAINTEXT_PASSWORD, ACTOR);
    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = $1 AND event_type = 'mfa_disabled' ORDER BY created_at DESC LIMIT 1",
      [enabledUserId],
    );
    expect(audit.rows.length).toBe(1);
  });

  it('throws MFA_INVALID_PASSWORD when the wrong password is given', async () => {
    await expect(disableMfa(enabledUserId, passwordHash, 'wrong-password', ACTOR)).rejects.toThrow(
      'MFA_INVALID_PASSWORD',
    );
  });
});

// ── MFA token (issueMfaToken / verifyMfaToken) ────────────────────────────────

describe('issueMfaToken / verifyMfaToken', () => {
  it('round-trips: issueMfaToken → verifyMfaToken returns the user ID', () => {
    const token = issueMfaToken(userId);
    const returned = verifyMfaToken(token);
    expect(returned).toBe(userId);
  });

  it('returns null for an invalid token', () => {
    expect(verifyMfaToken('not-a-valid-token')).toBeNull();
  });

  it('returns null for a token with wrong purpose', () => {
    const token = jwt.sign({ sub: userId, purpose: 'session' }, process.env.JWT_SECRET ?? '', {
      expiresIn: 300,
    });
    expect(verifyMfaToken(token)).toBeNull();
  });
});

// ── verifyTotpCode ─────────────────────────────────────────────────────────────

describe('verifyTotpCode', () => {
  let totpUserId: string;
  let plainSecret: string;

  beforeAll(async () => {
    const user = await createUser({
      ...BASE_USER,
      email: 'mfa-test-totp@example.com',
    });
    totpUserId = user.id;
    const { otpauthUrl } = await initiateMfaSetup(totpUserId);
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    plainSecret = match![1]!;
    const code = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    await enableMfa(totpUserId, code, ACTOR);
  });

  it('returns true for a valid TOTP code', async () => {
    const code = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    expect(await verifyTotpCode(totpUserId, code)).toBe(true);
  });

  it('returns false for an invalid TOTP code', async () => {
    expect(await verifyTotpCode(totpUserId, '000000')).toBe(false);
  });

  it('returns false when the user has no MFA secret (MFA not enabled)', async () => {
    expect(await verifyTotpCode(userId, '123456')).toBe(false);
  });
});

// ── verifyAndConsumeRecoveryCode ──────────────────────────────────────────────

describe('verifyAndConsumeRecoveryCode', () => {
  let rcUserId: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    const user = await createUser({
      ...BASE_USER,
      email: 'mfa-test-recovery@example.com',
    });
    rcUserId = user.id;
    const { otpauthUrl } = await initiateMfaSetup(rcUserId);
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    const secret = match![1]!;
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const result = await enableMfa(rcUserId, code, ACTOR);
    recoveryCodes = result.recoveryCodes;
  });

  it('returns true for a valid recovery code', async () => {
    const valid = await verifyAndConsumeRecoveryCode(rcUserId, recoveryCodes[0]!);
    expect(valid).toBe(true);
  });

  it('burns the code — a used code cannot be used again', async () => {
    // recoveryCodes[0] was consumed in the previous test
    const used = await verifyAndConsumeRecoveryCode(rcUserId, recoveryCodes[0]!);
    expect(used).toBe(false);
  });

  it('reduces remaining codes by 1 after a successful use', async () => {
    const before = await getMfaStatus(rcUserId);
    // recoveryCodes[1] has not been used yet
    await verifyAndConsumeRecoveryCode(rcUserId, recoveryCodes[1]!);
    const after = await getMfaStatus(rcUserId);
    expect(after.recoveryCodesRemaining).toBe(before.recoveryCodesRemaining - 1);
  });

  it('returns false for an invalid code', async () => {
    const invalid = await verifyAndConsumeRecoveryCode(rcUserId, 'not-a-real-code');
    expect(invalid).toBe(false);
  });

  it('is case-insensitive and trims whitespace', async () => {
    const code = recoveryCodes[2]!;
    const valid = await verifyAndConsumeRecoveryCode(rcUserId, '  ' + code.toUpperCase() + '  ');
    expect(valid).toBe(true);
  });

  it('accepts a code whose stored hash was rewritten (e.g. by regeneration) between the two DB reads', async () => {
    // Reproduces the race the locked re-read guards against: the plaintext code
    // is still valid, but the hash matched during the initial unlocked bcrypt
    // scan is no longer present in the locked re-read (as if the user's codes
    // were regenerated in between). Rewrite the stored hash for this code
    // in place, then verify — the fallback bcrypt re-compare against the
    // current row must find it rather than rejecting on the stale hash's
    // absence from the freshly re-read array.
    const code = recoveryCodes[3]!;
    const before = await pool.query<{ mfa_recovery_codes: string[] }>(
      'SELECT mfa_recovery_codes FROM users WHERE id = $1',
      [rcUserId],
    );
    const stored = before.rows[0]!.mfa_recovery_codes;
    const staleIndex = (
      await Promise.all(stored.map((hash) => bcrypt.compare(code.toLowerCase(), hash)))
    ).findIndex(Boolean);
    expect(staleIndex).toBeGreaterThanOrEqual(0);
    const rewritten = [...stored];
    rewritten[staleIndex] = await bcrypt.hash(code.toLowerCase(), 10);
    await pool.query('UPDATE users SET mfa_recovery_codes = $1 WHERE id = $2', [
      rewritten,
      rcUserId,
    ]);

    const valid = await verifyAndConsumeRecoveryCode(rcUserId, code);
    expect(valid).toBe(true);
  });
});

// ── HTTP: MFA login flow (verify-login + recovery-login) ─────────────────────

describe('POST /api/v1/auth/mfa/verify-login', () => {
  let mfaEnabledUserId: string;
  let plainSecret: string;

  beforeAll(async () => {
    const user = await createUser({
      ...BASE_USER,
      email: 'mfa-test-login@example.com',
    });
    mfaEnabledUserId = user.id;
    const { otpauthUrl } = await initiateMfaSetup(mfaEnabledUserId);
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    plainSecret = match![1]!;
    const code = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    await enableMfa(mfaEnabledUserId, code, ACTOR);
  });

  it('returns 200 and sets a session cookie for a valid TOTP + mfaToken', async () => {
    const mfaToken = issueMfaToken(mfaEnabledUserId);
    const code = speakeasy.totp({ secret: plainSecret, encoding: 'base32' });
    const res = await request(app).post('/api/v1/auth/mfa/verify-login').send({ mfaToken, code });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    const cookieHeader = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(
      Array.isArray(cookieHeader) && cookieHeader.some((c) => c.startsWith('minicrm_token=')),
    ).toBe(true);
  });

  it('returns 401 for an invalid TOTP code', async () => {
    const mfaToken = issueMfaToken(mfaEnabledUserId);
    const res = await request(app)
      .post('/api/v1/auth/mfa/verify-login')
      .send({ mfaToken, code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_INVALID_CODE');
  });

  it('returns 401 for an expired/invalid mfaToken', async () => {
    const res = await request(app)
      .post('/api/v1/auth/mfa/verify-login')
      .send({ mfaToken: 'invalid.token.here', code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_TOKEN_INVALID');
  });
});

describe('POST /api/v1/auth/mfa/recovery-login', () => {
  let mfaEnabledUserId: string;
  let recoveryCodes: string[];

  beforeAll(async () => {
    const user = await createUser({
      ...BASE_USER,
      email: 'mfa-test-rclogin@example.com',
    });
    mfaEnabledUserId = user.id;
    const { otpauthUrl } = await initiateMfaSetup(mfaEnabledUserId);
    const match = otpauthUrl.match(/secret=([A-Z2-7]+)/);
    const secret = match![1]!;
    const code = speakeasy.totp({ secret, encoding: 'base32' });
    const result = await enableMfa(mfaEnabledUserId, code, ACTOR);
    recoveryCodes = result.recoveryCodes;
  });

  it('returns 200 and sets a session cookie for a valid recovery code + mfaToken', async () => {
    const mfaToken = issueMfaToken(mfaEnabledUserId);
    const res = await request(app)
      .post('/api/v1/auth/mfa/recovery-login')
      .send({ mfaToken, recoveryCode: recoveryCodes[0]! });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    const cookieHeader = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(
      Array.isArray(cookieHeader) && cookieHeader.some((c) => c.startsWith('minicrm_token=')),
    ).toBe(true);
  });

  it('returns 401 for an already-consumed recovery code', async () => {
    const mfaToken = issueMfaToken(mfaEnabledUserId);
    // recoveryCodes[0] was used in the previous test
    const res = await request(app)
      .post('/api/v1/auth/mfa/recovery-login')
      .send({ mfaToken, recoveryCode: recoveryCodes[0]! });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_INVALID_RECOVERY_CODE');
  });

  it('returns 401 for an invalid recovery code', async () => {
    const mfaToken = issueMfaToken(mfaEnabledUserId);
    const res = await request(app)
      .post('/api/v1/auth/mfa/recovery-login')
      .send({ mfaToken, recoveryCode: 'not-a-valid-code' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MFA_INVALID_RECOVERY_CODE');
  });
});

// ── HTTP: MFA setup/status endpoints ─────────────────────────────────────────

describe('GET /api/v1/auth/mfa/status', () => {
  it('returns MFA disabled for a new user', async () => {
    const res = await request(app).get('/api/v1/auth/mfa/status').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.recoveryCodesRemaining).toBe(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/auth/mfa/status');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/mfa/setup', () => {
  afterEach(async () => {
    await pool.query('UPDATE users SET mfa_pending_secret = NULL WHERE id = $1', [userId]);
  });

  it('returns a QR code and otpauth URL', async () => {
    const res = await request(app).post('/api/v1/auth/mfa/setup').set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/v1/auth/mfa/setup');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/mfa/disable', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/auth/mfa/disable')
      .send({ currentPassword: 'anything' });
    expect(res.status).toBe(401);
  });

  it('returns 400 for a missing currentPassword field', async () => {
    const res = await request(app)
      .post('/api/v1/auth/mfa/disable')
      .set('Cookie', authCookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── require_mfa setting ───────────────────────────────────────────────────────

describe('GET /api/v1/settings/mfa-required', () => {
  let adminCookie: string;
  let repCookie: string;

  beforeAll(async () => {
    const admin = await createUser({
      name: 'MFA Admin',
      role: 'admin' as const,
      email: 'mfa-test-admin@example.com',
      passwordHash: '$2b$12$abc',
      status: 'active' as const,
    });
    adminCookie = makeAuthCookie({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    });
    const rep = await createUser({
      name: 'MFA Rep',
      role: 'rep' as const,
      email: 'mfa-test-rep@example.com',
      passwordHash: '$2b$12$abc',
      status: 'active' as const,
    });
    repCookie = makeAuthCookie({
      id: rep.id,
      email: rep.email,
      name: rep.name,
      role: rep.role,
    });
  });

  it('returns mfa_required for an admin', async () => {
    const res = await request(app).get('/api/v1/settings/mfa-required').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.mfa_required).toBe('boolean');
  });

  it('returns 403 for a rep', async () => {
    const res = await request(app).get('/api/v1/settings/mfa-required').set('Cookie', repCookie);
    expect(res.status).toBe(403);
  });

  it('PATCH updates the mfa_required value (admin only)', async () => {
    await request(app)
      .patch('/api/v1/settings/mfa-required')
      .set('Cookie', adminCookie)
      .send({ mfa_required: true });

    const res = await request(app).get('/api/v1/settings/mfa-required').set('Cookie', adminCookie);
    expect(res.body.mfa_required).toBe(true);

    // Reset back to false
    await request(app)
      .patch('/api/v1/settings/mfa-required')
      .set('Cookie', adminCookie)
      .send({ mfa_required: false });
  });

  it('PATCH returns 403 for a rep', async () => {
    const res = await request(app)
      .patch('/api/v1/settings/mfa-required')
      .set('Cookie', repCookie)
      .send({ mfa_required: true });
    expect(res.status).toBe(403);
  });
});
