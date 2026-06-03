/**
 * Integration tests for ssoService — user provisioning, linking, and enforcement. (MINCRM-399)
 *
 * Covers:
 *   - findOrProvisionSsoUser: match by subject, match by email (bind), JIT provision
 *   - must_change_password forced false on SSO link
 *   - isSsoBoundUser: non-admin SSO-bound users blocked; admins exempt
 *   - unlinkAllSsoUsers: clears bindings and writes audit entries
 *
 * Runs against the real minicrm_test PostgreSQL database.
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import {
  findOrProvisionSsoUser,
  isSsoBoundUser,
  unlinkAllSsoUsers,
} from '../services/ssoService.js';
import type { SsoIdentityClaims } from '../services/ssoService.js';

const ACTOR = { id: '00000000-0000-0000-0000-000000000001', name: 'Test Actor' };

const CLAIMS: SsoIdentityClaims = {
  subject: 'sso-sub-12345',
  email: 'sso-test@example.com',
  name: 'SSO Test User',
};

beforeEach(async () => {
  // audit_log is append-only (trigger prevents DELETE) — skip deleting it in tests.
  await pool.query("DELETE FROM users WHERE email LIKE 'sso-test%'");
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'sso-test%'");
  await pool.end();
});

// ── findOrProvisionSsoUser ────────────────────────────────────────────────────

describe('findOrProvisionSsoUser', () => {
  it('JIT-provisions a new user on first login', async () => {
    const user = await findOrProvisionSsoUser('oidc', CLAIMS);

    expect(user.email).toBe(CLAIMS.email);
    expect(user.name).toBe(CLAIMS.name);
    expect(user.role).toBe('rep');
    expect(user.status).toBe('active');
    expect(user.must_change_password).toBe(false);
    expect(user.sso_provider).toBe('oidc');
    expect(user.sso_subject).toBe(CLAIMS.subject);
  });

  it('returns the same user on subsequent logins (match by subject)', async () => {
    const first = await findOrProvisionSsoUser('oidc', CLAIMS);
    const second = await findOrProvisionSsoUser('oidc', CLAIMS);

    expect(first.id).toBe(second.id);
  });

  it('binds SSO identity to an existing user matched by email', async () => {
    const existing = await createUser({
      email: CLAIMS.email,
      name: 'Existing User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const user = await findOrProvisionSsoUser('saml', {
      ...CLAIMS,
      subject: 'saml-nameID-abc',
    });

    expect(user.id).toBe(existing.id);
    expect(user.sso_provider).toBe('saml');
    expect(user.sso_subject).toBe('saml-nameID-abc');
    expect(user.must_change_password).toBe(false);
  });

  it('clears must_change_password when binding SSO identity', async () => {
    await createUser({
      email: CLAIMS.email,
      name: 'Must Change User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    // Force must_change_password on the user
    await pool.query('UPDATE users SET must_change_password = true WHERE email = $1', [
      CLAIMS.email,
    ]);

    const user = await findOrProvisionSsoUser('oidc', CLAIMS);
    expect(user.must_change_password).toBe(false);
  });

  it('throws SSO_USER_INACTIVE for inactive users matched by subject', async () => {
    // Provision first
    const provisioned = await findOrProvisionSsoUser('oidc', CLAIMS);

    // Deactivate
    await pool.query("UPDATE users SET status = 'inactive' WHERE id = $1", [provisioned.id]);

    await expect(findOrProvisionSsoUser('oidc', CLAIMS)).rejects.toThrow('SSO_USER_INACTIVE');
  });

  it('throws SSO_USER_INACTIVE for inactive users matched by email', async () => {
    await createUser({
      email: CLAIMS.email,
      name: 'Inactive',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'inactive',
    });

    await expect(findOrProvisionSsoUser('oidc', CLAIMS)).rejects.toThrow('SSO_USER_INACTIVE');
  });

  it('writes an sso_provisioned audit entry on JIT provision', async () => {
    const user = await findOrProvisionSsoUser('oidc', CLAIMS);

    const result = await pool.query(
      `SELECT event_type FROM audit_log
       WHERE event_type = 'sso_provisioned'
       AND record_id = $1
       LIMIT 1`,
      [user.id],
    );
    expect(result.rowCount).toBe(1);
  });

  it('writes an sso_linked audit entry when binding to an existing user', async () => {
    await createUser({
      email: CLAIMS.email,
      name: 'Existing',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const user = await findOrProvisionSsoUser('oidc', CLAIMS);

    const result = await pool.query(
      `SELECT event_type FROM audit_log
       WHERE event_type = 'sso_linked'
       AND record_id = $1
       LIMIT 1`,
      [user.id],
    );
    expect(result.rowCount).toBe(1);
  });
});

// ── isSsoBoundUser ────────────────────────────────────────────────────────────

describe('isSsoBoundUser', () => {
  it('returns true for a non-admin with both SSO fields set', () => {
    expect(isSsoBoundUser({ role: 'rep', sso_provider: 'oidc', sso_subject: 'sub-123' })).toBe(
      true,
    );
  });

  it('returns false for admin regardless of SSO binding', () => {
    expect(isSsoBoundUser({ role: 'admin', sso_provider: 'oidc', sso_subject: 'sub-123' })).toBe(
      false,
    );
  });

  it('returns false when sso_subject is null', () => {
    expect(isSsoBoundUser({ role: 'rep', sso_provider: 'oidc', sso_subject: null })).toBe(false);
  });

  it('returns false when sso_provider is null', () => {
    expect(isSsoBoundUser({ role: 'rep', sso_provider: null, sso_subject: 'sub-123' })).toBe(false);
  });

  it('returns false when both SSO fields are null', () => {
    expect(isSsoBoundUser({ role: 'rep', sso_provider: null, sso_subject: null })).toBe(false);
  });
});

// ── unlinkAllSsoUsers ─────────────────────────────────────────────────────────

describe('unlinkAllSsoUsers', () => {
  it('clears SSO provider and subject from bound users', async () => {
    await findOrProvisionSsoUser('oidc', CLAIMS);
    await findOrProvisionSsoUser('oidc', {
      subject: 'sso-sub-99999',
      email: 'sso-test-2@example.com',
      name: 'SSO Test User 2',
    });

    const count = await unlinkAllSsoUsers('oidc', ACTOR);
    expect(count).toBe(2);

    const result = await pool.query(
      "SELECT sso_provider, sso_subject FROM users WHERE email LIKE 'sso-test%' AND sso_provider IS NOT NULL",
    );
    expect(result.rowCount).toBe(0);
  });

  it('does not affect users bound to a different provider', async () => {
    await findOrProvisionSsoUser('saml', {
      subject: 'saml-nameID-only',
      email: 'sso-test-saml@example.com',
      name: 'SAML User',
    });

    const count = await unlinkAllSsoUsers('oidc', ACTOR);
    expect(count).toBe(0);

    const result = await pool.query(
      "SELECT sso_provider FROM users WHERE email = 'sso-test-saml@example.com'",
    );
    expect(result.rows[0]?.sso_provider).toBe('saml');
  });

  it('writes sso_unlinked audit entries for each user', async () => {
    const provisioned = await findOrProvisionSsoUser('oidc', CLAIMS);
    await unlinkAllSsoUsers('oidc', ACTOR);

    const result = await pool.query(
      `SELECT event_type FROM audit_log
       WHERE event_type = 'sso_unlinked' AND record_id = $1`,
      [provisioned.id],
    );
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });
});
