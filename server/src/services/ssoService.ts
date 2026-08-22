/**
 * SSO service — SAML 2.0 / OIDC single sign-on.
 *
 * Responsibilities:
 *   - Build SAML AuthnRequests and OIDC authorization URLs (initiation)
 *   - Validate SAML assertions and OIDC token responses (callback)
 *   - JIT-provision new users on first SSO login
 *   - Link / unlink SSO identities on existing user accounts
 *
 * The OIDC provider is configured dynamically from system_settings — its
 * Issuer metadata is fetched from the idp_metadata_url on each request.
 * For SAML, the SP key is generated per-instance (stored in process memory)
 * and the IdP certificate from settings is used to validate assertions.
 */

import crypto from 'crypto';
import * as nodeSaml from '@node-saml/node-saml';
import { discovery, buildAuthorizationUrl, authorizationCodeGrant } from 'openid-client';
import pool from '../db.js';
import logger from '../logger.js';
import { getSsoConfigInternal, SSO_JIT_DEFAULT_ROLE_ID_KEY } from './ssoSettingsService.js';
import { encrypt, decrypt } from './cryptoService.js';
import { writeAuditEntry } from './auditService.js';
import type { AuditActor } from './auditService.js';
import type { UserRow } from './userService.js';
import type { SsoProtocol } from '@minicrm/shared/schemas/settingsSchema.js';
import type { UserRole } from '@minicrm/shared/schemas/userSchema.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Denormalized role enum value written to users.role for all JIT-provisioned SSO users.
 * users.role is retained as a cache per the spec design — the authoritative capability
 * source is the custom_roles / user_custom_roles tables.
 */
const SSO_JIT_ROLE = 'rep' as const;

/** System actor used for JIT-provision audit entries */
const SYSTEM_ACTOR: AuditActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

/**
 * Base URL for SP callback and metadata URLs — must point to the API server.
 * In development this is the Express server (port 3001), NOT the Vite dev server.
 * Separate from APP_BASE_URL (the frontend URL used for post-login redirect).
 */
const SSO_CALLBACK_BASE_URL =
  process.env.SSO_CALLBACK_BASE_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3001';

/** system_settings keys for the persisted SP key pair */
const SP_PRIVATE_KEY_KEY = 'sso_sp_private_key_encrypted';
const SP_SIGNING_CERT_KEY = 'sso_sp_signing_cert';

/** Process-level cache — avoids a DB round-trip on every SAML request */
let _samlSpKeyPairCache: { privateKey: string; signingCert: string } | null = null;

/**
 * Returns the SAML SP key pair, loading from system_settings or generating on
 * first use. The private key is stored AES-256-GCM encrypted (same as IdP
 * certificate); the signing cert (public) is stored in plaintext. A stable key
 * pair means IdP registration only needs to happen once — not on every restart.
 */
async function getSamlSpKeyPair(): Promise<{ privateKey: string; signingCert: string }> {
  if (_samlSpKeyPairCache) return _samlSpKeyPairCache;

  // Try to load from system_settings first.
  const rows = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
    [[SP_PRIVATE_KEY_KEY, SP_SIGNING_CERT_KEY]],
  );
  const byKey = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));

  if (byKey[SP_PRIVATE_KEY_KEY] && byKey[SP_SIGNING_CERT_KEY]) {
    const privateKey = decrypt(byKey[SP_PRIVATE_KEY_KEY]);
    const signingCert = byKey[SP_SIGNING_CERT_KEY];
    _samlSpKeyPairCache = { privateKey, signingCert };
    return _samlSpKeyPairCache;
  }

  // Generate a new RSA-2048 SP key pair and persist it.
  // Node 15+ ships with X.509 cert generation via crypto.X509Certificate — however,
  // self-signed cert creation requires the `x509` module which is not yet stable in
  // all LTS versions. We use the PKCS#8 private key PEM directly for signing;
  // the signingCert is the SPKI public key wrapped in cert headers so that
  // @node-saml/node-saml's generateServiceProviderMetadata can embed it in the
  // metadata document. The IdP will strip the headers and use the raw public key material.
  const { privateKey: privPem, publicKey: pubPem } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // Wrap the SPKI public key in X.509 certificate PEM headers.
  const signingCert = pubPem
    .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN CERTIFICATE-----')
    .replace('-----END PUBLIC KEY-----', '-----END CERTIFICATE-----');

  const encryptedPrivKey = encrypt(privPem);

  // Upsert both halves atomically.
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now()), ($3, $4, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SP_PRIVATE_KEY_KEY, encryptedPrivKey, SP_SIGNING_CERT_KEY, signingCert],
  );

  _samlSpKeyPairCache = { privateKey: privPem, signingCert };
  return _samlSpKeyPairCache;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Normalized identity claims extracted from an SSO assertion or token */
export interface SsoIdentityClaims {
  /** Stable external identifier (SAML nameID or OIDC sub) */
  subject: string;
  /** Email address from the IdP */
  email: string;
  /** Display name from the IdP, or email if not provided */
  name: string;
}

/** Result of initiating an SSO login flow */
export interface SsoInitiateResult {
  /** URL to redirect the browser to */
  redirectUrl: string;
  /** SAML request ID or OIDC state, stored in a secure signed cookie for CSRF protection */
  relayState: string;
}

// ── SP callback URL helpers ───────────────────────────────────────────────────

export function getSamlCallbackUrl(): string {
  return `${SSO_CALLBACK_BASE_URL}/api/v1/auth/sso/callback`;
}

export function getOidcCallbackUrl(): string {
  return `${SSO_CALLBACK_BASE_URL}/api/v1/auth/sso/callback`;
}

// ── SAML initiation ───────────────────────────────────────────────────────────

/**
 * Builds a SAML SP-initiated AuthnRequest and returns the redirect URL.
 */
export async function initiateSamlLogin(): Promise<SsoInitiateResult> {
  const config = await getSsoConfigInternal();
  if (!config.enabled || config.protocol !== 'saml') {
    throw new Error('SSO_NOT_CONFIGURED');
  }

  if (!config.idp_certificate) {
    throw new Error('SSO_CERTIFICATE_REQUIRED');
  }

  /* v8 ignore start */
  const { privateKey } = await getSamlSpKeyPair();

  const saml = new nodeSaml.SAML({
    entryPoint: config.idp_metadata_url,
    issuer: config.entity_id,
    callbackUrl: getSamlCallbackUrl(),
    idpCert: config.idp_certificate,
    privateKey,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    wantAuthnResponseSigned: true,
    wantAssertionsSigned: false,
  });

  const relayState = crypto.randomBytes(16).toString('hex');
  const redirectUrl = await saml.getAuthorizeUrlAsync(relayState, undefined, {});

  return { redirectUrl, relayState };
  /* v8 ignore stop */
}

// ── SAML callback ─────────────────────────────────────────────────────────────

/**
 * Validates a SAML POST binding response and extracts identity claims.
 */
export async function validateSamlResponse(samlResponse: string): Promise<SsoIdentityClaims> {
  const config = await getSsoConfigInternal();
  if (!config.enabled || config.protocol !== 'saml') {
    throw new Error('SSO_NOT_CONFIGURED');
  }

  if (!config.idp_certificate) {
    throw new Error('SSO_CERTIFICATE_REQUIRED');
  }

  /* v8 ignore start */
  const { privateKey } = await getSamlSpKeyPair();

  const saml = new nodeSaml.SAML({
    entryPoint: config.idp_metadata_url,
    issuer: config.entity_id,
    callbackUrl: getSamlCallbackUrl(),
    idpCert: config.idp_certificate,
    privateKey,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    wantAuthnResponseSigned: true,
    wantAssertionsSigned: false,
  });

  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });

  if (!profile) throw new Error('SSO_EMPTY_PROFILE');

  const subject =
    profile.nameID ??
    (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] as
      string | undefined);

  if (!subject) throw new Error('SSO_MISSING_SUBJECT');

  const email =
    (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] as
      string | undefined) ??
    profile.email ??
    (typeof profile.nameID === 'string' && profile.nameID.includes('@') ? profile.nameID : null);

  if (!email) throw new Error('SSO_MISSING_EMAIL');

  const name =
    (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] as string | undefined) ??
    profile.displayName ??
    email;

  return {
    subject: String(subject),
    email: String(email).toLowerCase().trim(),
    name: String(name),
  };
  /* v8 ignore stop */
}

// ── OIDC initiation ───────────────────────────────────────────────────────────

/**
 * Discovers OIDC server metadata and builds the authorization redirect URL.
 */
export async function initiateOidcLogin(): Promise<SsoInitiateResult> {
  const config = await getSsoConfigInternal();
  if (!config.enabled || config.protocol !== 'oidc') {
    throw new Error('SSO_NOT_CONFIGURED');
  }

  /* v8 ignore start */
  const issuer = new URL(config.idp_metadata_url);
  // openid-client v6 discovery — fetches /.well-known/openid-configuration
  const serverConfig = await discovery(issuer, config.entity_id);

  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  const redirectUrl = buildAuthorizationUrl(serverConfig, {
    redirect_uri: getOidcCallbackUrl(),
    scope: 'openid email profile',
    state,
    nonce,
    response_type: 'code',
  });

  // Pack state and nonce into a single relay-state value so the callback can
  // validate both CSRF (state) and ID token replay (nonce) from the cookie alone.
  return { redirectUrl: redirectUrl.href, relayState: `${state}:${nonce}` };
  /* v8 ignore stop */
}

// ── OIDC callback ─────────────────────────────────────────────────────────────

/**
 * Exchanges an OIDC authorization code for tokens and extracts identity claims.
 *
 * @param packedRelayState - The value from the relay-state cookie, in the form
 *   `<state>:<nonce>` as packed by initiateOidcLogin. Both halves are validated
 *   to protect against CSRF (state) and ID token replay (nonce).
 */
export async function validateOidcCallback(
  callbackUrl: string,
  packedRelayState: string,
): Promise<SsoIdentityClaims> {
  const config = await getSsoConfigInternal();
  if (!config.enabled || config.protocol !== 'oidc') {
    throw new Error('SSO_NOT_CONFIGURED');
  }

  // Unpack state and nonce from the relay-state cookie.
  const colonIdx = packedRelayState.indexOf(':');
  if (colonIdx === -1) throw new Error('SSO_CSRF_MISMATCH');
  const expectedState = packedRelayState.slice(0, colonIdx);
  const expectedNonce = packedRelayState.slice(colonIdx + 1);

  /* v8 ignore start */
  const issuer = new URL(config.idp_metadata_url);
  const serverConfig = await discovery(issuer, config.entity_id);

  const tokens = await authorizationCodeGrant(serverConfig, new URL(callbackUrl), {
    pkceCodeVerifier: undefined,
    expectedState,
    expectedNonce,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error('SSO_EMPTY_CLAIMS');

  const subject = claims.sub;
  if (!subject) throw new Error('SSO_MISSING_SUBJECT');

  const email = (claims.email as string | undefined) ?? null;
  if (!email) throw new Error('SSO_MISSING_EMAIL');

  const name =
    (claims.name as string | undefined) ??
    (claims.given_name && claims.family_name
      ? `${claims.given_name} ${claims.family_name}`
      : email);

  return { subject, email: email.toLowerCase().trim(), name: String(name) };
  /* v8 ignore stop */
}

// ── SAML SP metadata ──────────────────────────────────────────────────────────

/**
 * Returns the SAML SP metadata XML for IdP registration.
 * Uses the library's own metadata generator for spec-compliant output.
 * This endpoint must be public — IdPs fetch it during setup.
 */
export async function buildSamlSpMetadata(): Promise<string> {
  const config = await getSsoConfigInternal();
  const { privateKey, signingCert } = await getSamlSpKeyPair();

  const entityId = config.entity_id || `${SSO_CALLBACK_BASE_URL}/saml/metadata`;
  const callbackUrl = getSamlCallbackUrl();

  // Use a placeholder IdP cert so the SAML instance can be constructed even
  // when SSO is not yet fully configured (e.g. admin fetching metadata before saving cert).
  const idpCert = config.idp_certificate ?? 'placeholder';

  const saml = new nodeSaml.SAML({
    entryPoint: config.idp_metadata_url || 'https://placeholder.idp/sso',
    issuer: entityId,
    callbackUrl,
    idpCert,
    privateKey,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    wantAuthnResponseSigned: true,
    wantAssertionsSigned: false,
  });

  return saml.generateServiceProviderMetadata(null, signingCert);
}

// ── User provisioning ─────────────────────────────────────────────────────────

/** Full SSO user row — only columns needed by the SSO flow */
interface SsoUserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: 'active' | 'invited' | 'inactive';
  must_change_password: boolean;
  sso_provider: SsoProtocol | null;
  sso_subject: string | null;
}

/**
 * Finds an existing user by SSO identity or email, or JIT-provisions a new one.
 *
 * Resolution order:
 *   1. Exact match on (sso_provider, sso_subject) — returning SSO user
 *   2. Email match (sso_subject is NULL) — existing user, binds SSO identity
 *   3. No match — JIT-provisions a new active user
 *
 * @throws 'SSO_USER_INACTIVE' if the resolved user is inactive.
 */
export async function findOrProvisionSsoUser(
  provider: SsoProtocol,
  claims: SsoIdentityClaims,
): Promise<SsoUserRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Look up by stable SSO identity binding.
    const bySubject = await client.query<SsoUserRow>(
      `SELECT id, email, name, role, status, must_change_password, sso_provider, sso_subject
       FROM users
       WHERE sso_provider = $1 AND sso_subject = $2
       LIMIT 1`,
      [provider, claims.subject],
    );

    if (bySubject.rows[0]) {
      const user = bySubject.rows[0];
      if (user.status === 'inactive') throw new Error('SSO_USER_INACTIVE');

      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: user.id,
        recordName: user.name,
        eventType: 'sso_login',
        changedById: user.id,
        changedByName: user.name,
      });

      await client.query('COMMIT');
      return user;
    }

    // 2. Look up by email — bind SSO identity to existing account.
    // The AND sso_subject IS NULL guard prevents silently overwriting an existing
    // SSO binding when a different IdP resolves the same email address.
    const byEmail = await client.query<SsoUserRow>(
      `SELECT id, email, name, role, status, must_change_password, sso_provider, sso_subject
       FROM users
       WHERE email = $1 AND sso_subject IS NULL
       LIMIT 1`,
      [claims.email],
    );

    if (byEmail.rows[0]) {
      const user = byEmail.rows[0];
      if (user.status === 'inactive') throw new Error('SSO_USER_INACTIVE');

      // Bind the SSO identity and force must_change_password=false — SSO users
      // authenticate via their IdP, not a local password.
      await client.query(
        `UPDATE users
         SET sso_provider = $1, sso_subject = $2, must_change_password = false, updated_at = now()
         WHERE id = $3`,
        [provider, claims.subject, user.id],
      );

      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: user.id,
        recordName: user.name,
        eventType: 'sso_linked',
        newValue: `${provider}:${claims.subject}`,
        changedById: user.id,
        changedByName: user.name,
      });

      await client.query('COMMIT');
      return {
        ...user,
        sso_provider: provider,
        sso_subject: claims.subject,
        must_change_password: false,
      };
    }

    // 3. JIT-provision a new user.
    const newUserResult = await client.query<SsoUserRow>(
      `INSERT INTO users (email, name, role, status, must_change_password, sso_provider, sso_subject, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', false, $4, $5, now(), now())
       RETURNING id, email, name, role, status, must_change_password, sso_provider, sso_subject`,
      // SSO_JIT_ROLE is the denormalized cache value — kept in sync with that change design.
      [claims.email, claims.name, SSO_JIT_ROLE, provider, claims.subject],
    );

    // newUserResult.rows[0] is guaranteed non-null — the INSERT above always returns one row.
    const newUser = newUserResult.rows[0]!;

    // Look up the configured JIT default role and assign it via user_custom_roles.
    const jitRoleSettingResult = await client.query<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
      [SSO_JIT_DEFAULT_ROLE_ID_KEY],
    );
    const jitRoleId = jitRoleSettingResult.rows[0]?.value ?? null;

    if (jitRoleId) {
      // Excludes privileged built-ins here as well as on write, so a value stored before
      // that guard existed cannot still grant admin to every provisioned user.
      const roleExistsResult = await client.query<{ id: string }>(
        `SELECT id FROM custom_roles
          WHERE id = $1 AND (is_builtin = false OR name = 'rep')
          LIMIT 1`,
        [jitRoleId],
      );
      if (roleExistsResult.rows[0]) {
        await client.query(
          `INSERT INTO user_custom_roles (user_id, role_id, created_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [newUser.id, jitRoleId],
        );
      } else {
        logger.warn(
          { jitRoleId },
          'ssoService: sso_jit_default_role_id points to a non-existent custom_role — skipping role assignment',
        );
        // Audit the misconfiguration so admins can see it in the audit log.
        await writeAuditEntry(client, {
          recordType: 'system_settings',
          recordId: newUser.id,
          recordName: 'sso_jit_default_role_id',
          eventType: 'updated',
          fieldName: 'jit_role_assignment_skipped',
          oldValue: jitRoleId,
          changedById: SYSTEM_ACTOR.id,
          changedByName: SYSTEM_ACTOR.name,
        });
      }
    }

    await writeAuditEntry(client, {
      recordType: 'user',
      recordId: newUser.id,
      recordName: newUser.name,
      eventType: 'sso_provisioned',
      newValue: `${provider}:${claims.subject}`,
      changedById: SYSTEM_ACTOR.id,
      changedByName: SYSTEM_ACTOR.name,
    });

    await client.query('COMMIT');
    return newUser;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes SSO bindings from all users that are bound to the given provider.
 * Called when an admin disables SSO. Does NOT deactivate users.
 *
 * @returns The number of user rows updated.
 */
export async function unlinkAllSsoUsers(provider: SsoProtocol, actor: AuditActor): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<{ id: string; name: string }>(
      `UPDATE users
       SET sso_provider = NULL, sso_subject = NULL, updated_at = now()
       WHERE sso_provider = $1
       RETURNING id, name`,
      [provider],
    );

    for (const row of result.rows) {
      await writeAuditEntry(client, {
        recordType: 'user',
        recordId: row.id,
        recordName: row.name,
        eventType: 'sso_unlinked',
        oldValue: provider,
        changedById: actor.id,
        changedByName: actor.name,
      });
    }

    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (err) /* v8 ignore next */ {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Checks whether a user account is SSO-bound and therefore must not authenticate
 * via password login.
 *
 * Admins are exempt from this check — they can always use password login as a
 * lockout escape hatch, per the spec design decision.
 */
export function isSsoBoundUser(
  user: Pick<UserRow, 'sso_provider' | 'sso_subject' | 'role'>,
): boolean {
  if (user.role === 'admin') return false;
  return user.sso_provider !== null && user.sso_subject !== null;
}

/**
 * Looks up a user by ID and returns the minimal fields needed for JWT issuance.
 * Separated from userService to keep the SSO service self-contained.
 */
export async function findUserForSso(userId: string): Promise<SsoUserRow | null> {
  const result = await pool.query<SsoUserRow>(
    `SELECT id, email, name, role, status, must_change_password, sso_provider, sso_subject
     FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export type { SsoUserRow };
