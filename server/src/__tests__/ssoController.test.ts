/**
 * Integration tests for SSO controller endpoints.
 *
 * Covers:
 *   - GET /api/v1/settings/sso/status — public status endpoint
 *   - GET/PUT/DELETE /api/v1/settings/sso — admin-only config management
 *   - GET /api/v1/auth/sso/login — initiates SSO redirect (or returns 400 when not configured)
 *   - GET /api/v1/auth/sso/metadata — always returns XML
 *   - POST /api/v1/auth/login — rejects SSO-bound non-admin with AUTH_SSO_REQUIRED
 *
 * Runs against the real minicrm_test PostgreSQL database.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { setSsoConfig } from '../services/ssoSettingsService.js';
import { makeAuthCookie } from './testUtils.js';

// Spy on ssoService functions so we can simulate a successful SSO round-trip
// without needing a real IdP. The actual service logic is tested in ssoService.test.ts.
vi.mock('../services/ssoService.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    initiateOidcLogin: vi.fn(),
    initiateSamlLogin: vi.fn(),
    validateOidcCallback: vi.fn(),
    validateSamlResponse: vi.fn(),
    findOrProvisionSsoUser: vi.fn(),
  };
});

// Import after vi.mock so we get the mocked versions.
const { initiateOidcLogin, validateOidcCallback, findOrProvisionSsoUser } =
  await import('../services/ssoService.js');

const SSO_KEYS = [
  'sso_enabled',
  'sso_protocol',
  'sso_idp_metadata_url',
  'sso_entity_id',
  'sso_idp_certificate_encrypted',
];

let adminCookie!: string;
let repCookie!: string;

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'sso-ctrl-test%'");
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [SSO_KEYS]);

  const admin = await createUser({
    email: 'sso-ctrl-test-admin@example.com',
    name: 'SSO Admin',
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

  const rep = await createUser({
    email: 'sso-ctrl-test-rep@example.com',
    name: 'SSO Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE 'sso-ctrl-test%'");
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [SSO_KEYS]);
  await pool.end();
});

afterEach(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [SSO_KEYS]);
});

// ── GET /api/v1/settings/sso/status ──────────────────────────────────────────

describe('GET /api/v1/settings/sso/status', () => {
  it('returns enabled=false when SSO is not configured', async () => {
    const res = await request(app).get('/api/v1/settings/sso/status').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.protocol).toBeNull();
  });

  it('returns enabled=true when SSO is configured', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    const res = await request(app).get('/api/v1/settings/sso/status').set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.protocol).toBe('oidc');
  });

  it('returns 200 without authentication — endpoint is public', async () => {
    const res = await request(app).get('/api/v1/settings/sso/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });
});

// ── GET /api/v1/settings/sso ──────────────────────────────────────────────────

describe('GET /api/v1/settings/sso', () => {
  it('returns null sso when not configured', async () => {
    const res = await request(app).get('/api/v1/settings/sso').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.sso).toBeNull();
  });

  it('returns config for admin', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'urn:sp:minicrm',
    });

    const res = await request(app).get('/api/v1/settings/sso').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.sso.protocol).toBe('saml');
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).get('/api/v1/settings/sso').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

// ── PUT /api/v1/settings/sso ──────────────────────────────────────────────────

describe('PUT /api/v1/settings/sso', () => {
  it('saves SSO config and returns the public view', async () => {
    const res = await request(app).put('/api/v1/settings/sso').set('Cookie', adminCookie).send({
      protocol: 'oidc',
      idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
      entity_id: 'google-client-id',
    });

    expect(res.status).toBe(200);
    expect(res.body.sso.protocol).toBe('oidc');
    expect(res.body.sso.entity_id).toBe('google-client-id');
    expect(res.body.sso).not.toHaveProperty('idp_certificate');
  });

  it('returns 409 for a privileged built-in JIT default role', async () => {
    const builtin = await pool.query<{ id: string }>(
      `SELECT id FROM custom_roles WHERE name = 'admin' AND is_builtin = true`,
    );

    const res = await request(app).put('/api/v1/settings/sso').set('Cookie', adminCookie).send({
      protocol: 'oidc',
      idp_metadata_url: 'https://accounts.google.com/.well-known/openid-configuration',
      entity_id: 'google-client-id',
      jit_default_role_id: builtin.rows[0]!.id,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SSO_JIT_ROLE_BUILTIN');
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(app)
      .put('/api/v1/settings/sso')
      .set('Cookie', adminCookie)
      .send({ protocol: 'oidc' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid protocol', async () => {
    const res = await request(app).put('/api/v1/settings/sso').set('Cookie', adminCookie).send({
      protocol: 'oauth2',
      idp_metadata_url: 'https://idp.example.com',
      entity_id: 'client-id',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid idp_metadata_url', async () => {
    const res = await request(app).put('/api/v1/settings/sso').set('Cookie', adminCookie).send({
      protocol: 'oidc',
      idp_metadata_url: 'not-a-url',
      entity_id: 'client-id',
    });

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).put('/api/v1/settings/sso').set('Cookie', repCookie).send({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/v1/settings/sso ───────────────────────────────────────────────

describe('DELETE /api/v1/settings/sso', () => {
  it('disables SSO and returns ok:true', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    const res = await request(app).delete('/api/v1/settings/sso').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 403 for non-admin', async () => {
    const res = await request(app).delete('/api/v1/settings/sso').set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

// ── GET /api/v1/auth/sso/login ────────────────────────────────────────────────

describe('GET /api/v1/auth/sso/login', () => {
  it('returns 400 when SSO is not configured', async () => {
    const res = await request(app).get('/api/v1/auth/sso/login');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SSO_NOT_ENABLED');
  });
});

// ── POST /api/v1/auth/sso/callback — SAML CSRF protection ────────────────────

describe('POST /api/v1/auth/sso/callback — SAML CSRF', () => {
  it('rejects SAML POST with no relay-state cookie (SSO_CSRF_MISMATCH)', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'urn:sp:minicrm',
      idp_certificate: 'placeholder-cert',
    });

    const res = await request(app)
      .post('/api/v1/auth/sso/callback')
      .send({ SAMLResponse: Buffer.from('<saml/>').toString('base64'), RelayState: 'abc' });

    // Should redirect to login with CSRF mismatch error
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/sso_error=SSO_CSRF_MISMATCH/);
  });

  it('rejects SAML POST when cookie/body RelayState mismatch', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'urn:sp:minicrm',
      idp_certificate: 'placeholder-cert',
    });

    const res = await request(app)
      .post('/api/v1/auth/sso/callback')
      .set('Cookie', 'sso_relay_state=correct-state')
      .send({ SAMLResponse: Buffer.from('<saml/>').toString('base64'), RelayState: 'wrong-state' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/sso_error=SSO_CSRF_MISMATCH/);
  });

  it('rejects SAML POST with missing SAMLResponse', async () => {
    await setSsoConfig({
      protocol: 'saml',
      idp_metadata_url: 'https://idp.example.com/saml/metadata',
      entity_id: 'urn:sp:minicrm',
      idp_certificate: 'placeholder-cert',
    });

    const res = await request(app)
      .post('/api/v1/auth/sso/callback')
      .set('Cookie', 'sso_relay_state=my-relay-state')
      .send({ RelayState: 'my-relay-state' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/sso_error=SSO_MISSING_RESPONSE/);
  });
});

// ── GET /api/v1/auth/sso/callback — OIDC CSRF protection ─────────────────────

describe('GET /api/v1/auth/sso/callback — OIDC CSRF', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('rejects OIDC callback with no relay-state cookie (SSO_CSRF_MISMATCH)', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    const res = await request(app)
      .get('/api/v1/auth/sso/callback')
      .query({ code: 'abc', state: 'xyz' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/sso_error=SSO_CSRF_MISMATCH/);
  });

  it('maps unknown library exceptions to opaque SSO_CALLBACK_FAILED code', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    // Simulate a library-internal error with a URL in the message (the kind that
    // must NOT be forwarded to the browser).
    vi.mocked(validateOidcCallback).mockRejectedValue(
      new Error('fetch failed: https://idp.example.com/token unreachable'),
    );

    const res = await request(app)
      .get('/api/v1/auth/sso/callback')
      .set('Cookie', 'sso_relay_state=valid-state:valid-nonce')
      .query({ code: 'abc', state: 'valid-state' });

    expect(res.status).toBe(302);
    // Must be an opaque domain code only — must NOT contain library error text (URLs, stack paths)
    const location = res.headers.location as string;
    const errorParam = new URL(location).searchParams.get('sso_error');
    expect(errorParam).toBe('SSO_CALLBACK_FAILED');
  });
});

// ── GET /api/v1/auth/sso/metadata ────────────────────────────────────────────

describe('GET /api/v1/auth/sso/metadata', () => {
  it('returns XML with SP metadata', async () => {
    const res = await request(app).get('/api/v1/auth/sso/metadata');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('EntityDescriptor');
    expect(res.text).toContain('AssertionConsumerService');
  });
});

// ── POST /api/v1/auth/login — SSO enforcement ─────────────────────────────────

describe('POST /api/v1/auth/login — SSO enforcement', () => {
  const PASSWORD = 'TestPass1!';

  it('rejects SSO-bound non-admin user with AUTH_SSO_REQUIRED', async () => {
    // Create a user with a real password hash
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(PASSWORD, 12);

    const ssoUser = await createUser({
      email: 'sso-ctrl-test-bound@example.com',
      name: 'SSO Bound Rep',
      role: 'rep',
      passwordHash: hash,
      status: 'active',
    });

    // Bind SSO identity directly
    await pool.query(
      `UPDATE users SET sso_provider = 'oidc', sso_subject = 'sub-sso-bound' WHERE id = $1`,
      [ssoUser.id],
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sso-ctrl-test-bound@example.com', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_SSO_REQUIRED');

    // Cleanup
    await pool.query("DELETE FROM users WHERE email = 'sso-ctrl-test-bound@example.com'");
  });

  it('allows SSO-bound admin to use password login as escape hatch', async () => {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(PASSWORD, 12);

    const ssoAdmin = await createUser({
      email: 'sso-ctrl-test-bound-admin@example.com',
      name: 'SSO Bound Admin',
      role: 'admin',
      passwordHash: hash,
      status: 'active',
    });

    await pool.query(
      `UPDATE users SET sso_provider = 'oidc', sso_subject = 'sub-sso-admin' WHERE id = $1`,
      [ssoAdmin.id],
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'sso-ctrl-test-bound-admin@example.com', password: PASSWORD });

    // Admin bypasses the SSO enforcement — should get a session cookie
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();

    // Cleanup
    await pool.query("DELETE FROM users WHERE email = 'sso-ctrl-test-bound-admin@example.com'");
  });
});

// ── SSO callback success path (mocked service) ────────────────────────────────

describe('GET /api/v1/auth/sso/callback — OIDC success path', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('issues a JWT cookie and redirects to app on successful OIDC callback', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    // Create a real active user to return from the mocked provisioner
    const mockUser = await createUser({
      email: 'sso-ctrl-test-success@example.com',
      name: 'SSO Success User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    vi.mocked(validateOidcCallback).mockResolvedValue({
      subject: 'sub-success',
      email: mockUser.email,
      name: mockUser.name,
    });
    vi.mocked(findOrProvisionSsoUser).mockResolvedValue({
      ...mockUser,
      sso_provider: 'oidc',
      sso_subject: 'sub-success',
    });

    const res = await request(app)
      .get('/api/v1/auth/sso/callback')
      .set('Cookie', 'sso_relay_state=valid-state:valid-nonce')
      .query({ code: 'auth-code', state: 'valid-state' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/');
    expect(res.headers['set-cookie']).toBeDefined();
    const cookieHeader = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookieHeader).toContain('token=');

    // Cleanup
    await pool.query("DELETE FROM users WHERE email = 'sso-ctrl-test-success@example.com'");
  });

  it('redirects to /login?sso_error=SSO_USER_INACTIVE when user is inactive', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    const inactiveUser = await createUser({
      email: 'sso-ctrl-test-inactive@example.com',
      name: 'Inactive User',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'inactive',
    });

    vi.mocked(validateOidcCallback).mockResolvedValue({
      subject: 'sub-inactive',
      email: inactiveUser.email,
      name: inactiveUser.name,
    });
    vi.mocked(findOrProvisionSsoUser).mockResolvedValue({
      ...inactiveUser,
      sso_provider: 'oidc',
      sso_subject: 'sub-inactive',
    });

    const res = await request(app)
      .get('/api/v1/auth/sso/callback')
      .set('Cookie', 'sso_relay_state=valid-state:valid-nonce')
      .query({ code: 'auth-code', state: 'valid-state' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/sso_error=SSO_USER_INACTIVE/);

    // Cleanup
    await pool.query("DELETE FROM users WHERE email = 'sso-ctrl-test-inactive@example.com'");
  });
});

// ── GET /api/v1/auth/sso/login — OIDC redirect (mocked service) ──────────────

describe('GET /api/v1/auth/sso/login — OIDC redirect', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('redirects to IdP when SSO is configured', async () => {
    await setSsoConfig({
      protocol: 'oidc',
      idp_metadata_url: 'https://idp.example.com/.well-known/openid-configuration',
      entity_id: 'client-id',
    });

    vi.mocked(initiateOidcLogin).mockResolvedValue({
      redirectUrl: 'https://idp.example.com/auth?client_id=client-id&state=abc',
      relayState: 'abc:nonce',
    });

    const res = await request(app).get('/api/v1/auth/sso/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('idp.example.com/auth');
    expect(res.headers['set-cookie']).toBeDefined();
  });
});
