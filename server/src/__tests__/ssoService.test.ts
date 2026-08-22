/**
 * Integration tests for ssoService — user provisioning, linking, and enforcement.
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
  findUserForSso,
  isSsoBoundUser,
  unlinkAllSsoUsers,
  initiateSamlLogin,
  initiateOidcLogin,
  validateSamlResponse,
  validateOidcCallback,
  buildSamlSpMetadata,
} from '../services/ssoService.js';
import type { SsoIdentityClaims } from '../services/ssoService.js';
import { setSsoConfig } from '../services/ssoSettingsService.js';

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

// ── Binding overwrite protection ──────────────────────────────────────────────

describe('findOrProvisionSsoUser — binding overwrite protection', () => {
  it('grants the configured custom JIT role on provision', async () => {
    const role = await pool.query<{ id: string }>(
      `INSERT INTO custom_roles (name, description, is_builtin)
       VALUES ('sso-jit-grant-role', 'JIT grant test', false)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
    );
    const roleId = role.rows[0]!.id;
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('sso_jit_default_role_id', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [roleId],
    );

    try {
      const user = await findOrProvisionSsoUser('oidc', {
        subject: 'oidc-jit-grant-subject',
        email: 'sso-test-jit-grant@example.com',
        name: 'JIT Grant',
      });

      const granted = await pool.query(
        `SELECT 1 FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
        [user.id, roleId],
      );
      expect(granted.rows).toHaveLength(1);
    } finally {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at)
         SELECT 'sso_jit_default_role_id', r.id::text, now()
           FROM custom_roles r WHERE r.name = 'rep' AND r.is_builtin = true
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );
      await pool.query(`DELETE FROM custom_roles WHERE name = 'sso-jit-grant-role'`);
    }
  });

  it('ignores a stored privileged built-in JIT role rather than granting it', async () => {
    const builtin = await pool.query<{ id: string }>(
      `SELECT id FROM custom_roles WHERE name = 'admin' AND is_builtin = true`,
    );
    // Written directly: setSsoConfig refuses this value, so the only way a deployment
    // holds it is from before that guard existed.
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('sso_jit_default_role_id', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [builtin.rows[0]!.id],
    );

    try {
      const user = await findOrProvisionSsoUser('oidc', {
        subject: 'oidc-builtin-jit-subject',
        email: 'sso-test-builtin-jit@example.com',
        name: 'Builtin JIT',
      });

      const granted = await pool.query(
        `SELECT 1 FROM user_custom_roles WHERE user_id = $1 AND role_id = $2`,
        [user.id, builtin.rows[0]!.id],
      );
      expect(granted.rows).toHaveLength(0);
    } finally {
      // Restore the migration-seeded value rather than deleting the key, so the test DB
      // still matches a fresh install if this assertion fails.
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at)
         SELECT 'sso_jit_default_role_id', r.id::text, now()
           FROM custom_roles r WHERE r.name = 'rep' AND r.is_builtin = true
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );
    }
  });

  it('rejects a login attempt that would overwrite an existing SSO binding via email match', async () => {
    // First login: SAML IdP binds the user
    const user = await findOrProvisionSsoUser('saml', {
      subject: 'saml-original-subject',
      email: 'sso-test-bind-guard@example.com',
      name: 'Guard Test',
    });

    expect(user.sso_provider).toBe('saml');
    expect(user.sso_subject).toBe('saml-original-subject');

    // Second login: OIDC IdP resolves the same email — the AND sso_subject IS NULL
    // guard skips the email lookup, falls through to JIT-provision, and the
    // unique email constraint rejects it. The original binding stays intact.
    await expect(
      findOrProvisionSsoUser('oidc', {
        subject: 'oidc-attacker-subject',
        email: 'sso-test-bind-guard@example.com',
        name: 'Guard Test',
      }),
    ).rejects.toThrow();

    // Original user's binding must be untouched
    const originalRow = await pool.query(
      'SELECT sso_provider, sso_subject FROM users WHERE id = $1',
      [user.id],
    );
    expect(originalRow.rows[0].sso_provider).toBe('saml');
    expect(originalRow.rows[0].sso_subject).toBe('saml-original-subject');

    // Cleanup
    await pool.query("DELETE FROM users WHERE email = 'sso-test-bind-guard@example.com'");
  });
});

// ── findUserForSso ────────────────────────────────────────────────────────────

describe('findUserForSso', () => {
  it('returns user row when user exists', async () => {
    const provisioned = await findOrProvisionSsoUser('oidc', CLAIMS);
    const result = await findUserForSso(provisioned.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(provisioned.id);
    expect(result?.email).toBe(CLAIMS.email);
  });

  it('returns null when user does not exist', async () => {
    const result = await findUserForSso('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── Error path branches ───────────────────────────────────────────────────────

describe('ssoService — error path branches', () => {
  afterEach(async () => {
    await pool.query("DELETE FROM system_settings WHERE key LIKE 'sso_%'");
  });

  it('initiateSamlLogin throws SSO_NOT_CONFIGURED when no config', async () => {
    await expect(initiateSamlLogin()).rejects.toThrow('SSO_NOT_CONFIGURED');
  });

  it('initiateSamlLogin throws SSO_NOT_CONFIGURED when protocol is oidc', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com',
      entity_id: 'c',
    });
    await expect(initiateSamlLogin()).rejects.toThrow('SSO_NOT_CONFIGURED');
  });

  it('initiateSamlLogin throws SSO_CERTIFICATE_REQUIRED when cert missing', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml',
      entity_id: 'urn:sp',
    });
    await expect(initiateSamlLogin()).rejects.toThrow('SSO_CERTIFICATE_REQUIRED');
  });

  it('initiateOidcLogin throws SSO_NOT_CONFIGURED when no config', async () => {
    await expect(initiateOidcLogin()).rejects.toThrow('SSO_NOT_CONFIGURED');
  });

  it('initiateOidcLogin throws SSO_NOT_CONFIGURED when protocol is saml', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml',
      entity_id: 'urn:sp',
      idp_certificate: 'cert',
    });
    await expect(initiateOidcLogin()).rejects.toThrow('SSO_NOT_CONFIGURED');
  });

  it('validateSamlResponse throws SSO_NOT_CONFIGURED when no config', async () => {
    await expect(validateSamlResponse('dummy')).rejects.toThrow('SSO_NOT_CONFIGURED');
  });

  it('buildSamlSpMetadata returns XML even without a configured IdP cert', async () => {
    const xml = await buildSamlSpMetadata();
    expect(xml).toContain('EntityDescriptor');
  });
});

// ── validateOidcCallback — branch coverage ────────────────────────────────────

describe('validateOidcCallback — error branches', () => {
  afterEach(async () => {
    await pool.query("DELETE FROM system_settings WHERE key LIKE 'sso_%'");
  });

  it('throws SSO_NOT_CONFIGURED when no config', async () => {
    await expect(validateOidcCallback('http://localhost/cb', 'state:nonce')).rejects.toThrow(
      'SSO_NOT_CONFIGURED',
    );
  });

  it('throws SSO_CSRF_MISMATCH when packedRelayState has no colon', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com',
      entity_id: 'c',
    });
    await expect(validateOidcCallback('http://localhost/cb', 'no-colon-here')).rejects.toThrow(
      'SSO_CSRF_MISMATCH',
    );
  });
});
