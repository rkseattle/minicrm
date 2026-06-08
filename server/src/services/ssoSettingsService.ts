/**
 * SSO settings service — read/write SSO configuration stored in system_settings.
 * The IdP certificate is stored AES-256-GCM encrypted (same pattern as smtp_pass). (MINCRM-399)
 */

import pool from '../db.js';
import logger from '../logger.js';
import { encrypt, decrypt } from './cryptoService.js';
import type { SsoProtocol, SsoConfigPublic } from '@minicrm/shared/schemas/settingsSchema.js';
import { SSO_PROTOCOLS } from '@minicrm/shared/schemas/settingsSchema.js';
import type { AuditActor } from './auditService.js';
import { SYSTEM_ACTOR, actorIdOrNull } from './auditService.js';

// ── system_settings keys ──────────────────────────────────────────────────────

const SSO_ENABLED_KEY = 'sso_enabled';
const SSO_PROTOCOL_KEY = 'sso_protocol';
const SSO_IDP_METADATA_URL_KEY = 'sso_idp_metadata_url';
const SSO_ENTITY_ID_KEY = 'sso_entity_id';
/** Value stored as AES-256-GCM ciphertext produced by cryptoService. */
const SSO_IDP_CERTIFICATE_ENCRYPTED_KEY = 'sso_idp_certificate_encrypted';

const SSO_KEYS = [
  SSO_ENABLED_KEY,
  SSO_PROTOCOL_KEY,
  SSO_IDP_METADATA_URL_KEY,
  SSO_ENTITY_ID_KEY,
  SSO_IDP_CERTIFICATE_ENCRYPTED_KEY,
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Full internal SSO config including the decrypted IdP certificate. */
export interface SsoConfigInternal {
  enabled: boolean;
  protocol: SsoProtocol | null;
  idp_metadata_url: string;
  entity_id: string;
  /** Decrypted PEM certificate, or null if not set. */
  idp_certificate: string | null;
}

/** Input accepted by setSsoConfig. idp_certificate is optional; omitting it preserves the stored cert. */
export interface SsoConfigInput {
  protocol: SsoProtocol;
  idp_metadata_url: string;
  entity_id: string;
  /** When undefined the existing encrypted certificate is left unchanged. */
  idp_certificate?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readSettings(keys: readonly string[]): Promise<Record<string, string>> {
  const result = await pool.query<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings WHERE key = ANY($1)',
    [keys],
  );
  const map: Record<string, string> = {};
  for (const row of result.rows) {
    map[row.key] = row.value;
  }
  return map;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns SSO configuration safe for returning to admin clients.
 * The IdP certificate value is never included; idp_certificate_set indicates whether one is stored.
 */
export async function getSsoConfig(): Promise<SsoConfigPublic | null> {
  const map = await readSettings(SSO_KEYS);

  if (!map[SSO_ENABLED_KEY] || map[SSO_ENABLED_KEY] !== 'true') {
    return null;
  }

  const rawProtocol = map[SSO_PROTOCOL_KEY] ?? '';
  const protocol = (SSO_PROTOCOLS as readonly string[]).includes(rawProtocol)
    ? (rawProtocol as SsoProtocol)
    : null;

  if (!protocol) {
    logger.warn('ssoSettingsService: sso_protocol value is invalid, returning null');
    return null;
  }

  return {
    protocol,
    idp_metadata_url: map[SSO_IDP_METADATA_URL_KEY] ?? '',
    entity_id: map[SSO_ENTITY_ID_KEY] ?? '',
    idp_certificate_set: Boolean(map[SSO_IDP_CERTIFICATE_ENCRYPTED_KEY]),
  };
}

/**
 * Returns the SSO enabled status and protocol for the login page.
 * Safe to call without admin authentication.
 */
export async function getSsoStatus(): Promise<{ enabled: boolean; protocol: SsoProtocol | null }> {
  const map = await readSettings([SSO_ENABLED_KEY, SSO_PROTOCOL_KEY]);

  const enabled = map[SSO_ENABLED_KEY] === 'true';
  if (!enabled) return { enabled: false, protocol: null };

  const rawProtocol = map[SSO_PROTOCOL_KEY] ?? '';
  const protocol = (SSO_PROTOCOLS as readonly string[]).includes(rawProtocol)
    ? (rawProtocol as SsoProtocol)
    : null;

  return { enabled, protocol };
}

/**
 * Returns the full SSO configuration including the decrypted IdP certificate.
 * For internal use by the SSO auth flow only — never return to clients.
 */
export async function getSsoConfigInternal(): Promise<SsoConfigInternal> {
  const map = await readSettings(SSO_KEYS);

  const enabled = map[SSO_ENABLED_KEY] === 'true';
  const rawProtocol = map[SSO_PROTOCOL_KEY] ?? '';
  const protocol = (SSO_PROTOCOLS as readonly string[]).includes(rawProtocol)
    ? (rawProtocol as SsoProtocol)
    : null;

  let idp_certificate: string | null = null;
  const ciphertext = map[SSO_IDP_CERTIFICATE_ENCRYPTED_KEY];
  if (ciphertext) {
    try {
      idp_certificate = decrypt(ciphertext);
    } catch (err) {
      logger.error(
        { err },
        'ssoSettingsService: failed to decrypt idp_certificate — treating as unset',
      );
    }
  }

  return {
    enabled,
    protocol,
    idp_metadata_url: map[SSO_IDP_METADATA_URL_KEY] ?? '',
    entity_id: map[SSO_ENTITY_ID_KEY] ?? '',
    idp_certificate,
  };
}

// $3 = updated_by uuid (MINCRM-520)
const UPSERT_SQL = `
  INSERT INTO system_settings (key, value, updated_at, updated_by)
  VALUES ($1, $2, now(), $3)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
`;

/**
 * Persists SSO configuration and enables SSO.
 * When idp_certificate is omitted the stored encrypted certificate is left unchanged.
 *
 * @param input - Configuration to persist.
 * @returns The public view of the saved configuration.
 */
export async function setSsoConfig(
  input: SsoConfigInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<SsoConfigPublic> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(UPSERT_SQL, [SSO_ENABLED_KEY, 'true', actorIdOrNull(actor)]);
    await client.query(UPSERT_SQL, [SSO_PROTOCOL_KEY, input.protocol, actorIdOrNull(actor)]);
    await client.query(UPSERT_SQL, [
      SSO_IDP_METADATA_URL_KEY,
      input.idp_metadata_url,
      actorIdOrNull(actor),
    ]);
    await client.query(UPSERT_SQL, [SSO_ENTITY_ID_KEY, input.entity_id, actorIdOrNull(actor)]);

    if (input.idp_certificate !== undefined) {
      const encrypted = encrypt(input.idp_certificate);
      await client.query(UPSERT_SQL, [
        SSO_IDP_CERTIFICATE_ENCRYPTED_KEY,
        encrypted,
        actorIdOrNull(actor),
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const saved = await getSsoConfig();
  // getSsoConfig returns non-null because we just set sso_enabled=true above.
  return saved!;
}

/**
 * Clears all SSO configuration and disables SSO.
 * Existing sso_provider / sso_subject bindings on user rows are NOT cleared here —
 * that is handled by the caller (ssoService.unlinkAllSsoUsers) if desired.
 */
export async function clearSsoConfig(): Promise<void> {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [SSO_KEYS]);
}
