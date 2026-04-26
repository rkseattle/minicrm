/**
 * SMTP settings service — read/write SMTP configuration stored in system_settings.
 * The password is stored encrypted via cryptoService; it is never returned in plaintext.
 * (MINCRM-254)
 */

import pool from '../db.js';
import logger from '../logger.js';
import { encrypt, decrypt } from './cryptoService.js';

// ── system_settings keys ──────────────────────────────────────────────────────

const SMTP_HOST_KEY = 'smtp_host';
const SMTP_PORT_KEY = 'smtp_port';
const SMTP_USER_KEY = 'smtp_user';
/** Value stored as AES-256-GCM ciphertext produced by cryptoService. */
const SMTP_PASS_ENCRYPTED_KEY = 'smtp_pass_encrypted';
const SMTP_ENABLED_KEY = 'smtp_enabled';

// ── Types ─────────────────────────────────────────────────────────────────────

/** SMTP config as safe to return to callers — password never included. */
export interface SmtpConfigPublic {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  /** True when a password has been stored; the ciphertext is never returned. */
  smtp_pass_set: boolean;
  smtp_enabled: boolean;
}

/** Full internal SMTP config including the decrypted password. */
export interface SmtpConfigInternal {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string | null;
  smtp_enabled: boolean;
}

/** Input accepted by setSmtpConfig. smtp_pass is optional; omitting it preserves the stored password. */
export interface SmtpConfigInput {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  /** When undefined the existing encrypted password is left unchanged. */
  smtp_pass?: string;
  smtp_enabled: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Reads one or more system_settings rows by key and returns a map.
 */
async function readSettings(keys: string[]): Promise<Record<string, string>> {
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
 * Returns the SMTP configuration safe for returning to clients.
 * The encrypted password is never included; smtp_pass_set indicates whether one is stored.
 */
export async function getSmtpConfig(): Promise<SmtpConfigPublic> {
  const map = await readSettings([
    SMTP_HOST_KEY,
    SMTP_PORT_KEY,
    SMTP_USER_KEY,
    SMTP_PASS_ENCRYPTED_KEY,
    SMTP_ENABLED_KEY,
  ]);

  return {
    smtp_host: map[SMTP_HOST_KEY] ?? '',
    smtp_port: map[SMTP_PORT_KEY] ? parseInt(map[SMTP_PORT_KEY], 10) : 587,
    smtp_user: map[SMTP_USER_KEY] ?? '',
    smtp_pass_set: Boolean(map[SMTP_PASS_ENCRYPTED_KEY]),
    smtp_enabled: map[SMTP_ENABLED_KEY] === 'true',
  };
}

/**
 * Returns the full SMTP configuration including the decrypted password for internal use.
 * Returns null for smtp_pass when no password has been stored or decryption fails.
 */
export async function getSmtpConfigInternal(): Promise<SmtpConfigInternal> {
  const map = await readSettings([
    SMTP_HOST_KEY,
    SMTP_PORT_KEY,
    SMTP_USER_KEY,
    SMTP_PASS_ENCRYPTED_KEY,
    SMTP_ENABLED_KEY,
  ]);

  let smtp_pass: string | null = null;
  const ciphertext = map[SMTP_PASS_ENCRYPTED_KEY];
  if (ciphertext) {
    try {
      smtp_pass = decrypt(ciphertext);
    } catch (err) {
      logger.error({ err }, 'smtpSettingsService: failed to decrypt smtp_pass — treating as unset');
    }
  }

  return {
    smtp_host: map[SMTP_HOST_KEY] ?? '',
    smtp_port: map[SMTP_PORT_KEY] ? parseInt(map[SMTP_PORT_KEY], 10) : 587,
    smtp_user: map[SMTP_USER_KEY] ?? '',
    smtp_pass,
    smtp_enabled: map[SMTP_ENABLED_KEY] === 'true',
  };
}

/**
 * Persists SMTP configuration.
 * When smtp_pass is omitted the stored encrypted password is left unchanged.
 *
 * @param input - Configuration to persist.
 * @returns The public view of the saved configuration.
 */
export async function setSmtpConfig(input: SmtpConfigInput): Promise<SmtpConfigPublic> {
  const upsert = `
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(upsert, [SMTP_HOST_KEY, input.smtp_host]);
    await client.query(upsert, [SMTP_PORT_KEY, String(input.smtp_port)]);
    await client.query(upsert, [SMTP_USER_KEY, input.smtp_user]);
    await client.query(upsert, [SMTP_ENABLED_KEY, String(input.smtp_enabled)]);

    if (input.smtp_pass !== undefined) {
      const encrypted = encrypt(input.smtp_pass);
      await client.query(upsert, [SMTP_PASS_ENCRYPTED_KEY, encrypted]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getSmtpConfig();
}
