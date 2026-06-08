/**
 * SMTP settings service — read/write SMTP configuration stored in the
 * smtp_configuration singleton table.
 * The password is stored encrypted via cryptoService; it is never returned in plaintext.
 * (MINCRM-254, MINCRM-502)
 */

import type { PoolClient } from 'pg';
import pool from '../db.js';
import logger from '../logger.js';
import { encryptVersioned, decryptVersioned } from './cryptoService.js';

// ── Row type ──────────────────────────────────────────────────────────────────

interface SmtpConfigRow {
  host: string;
  port: number;
  username: string;
  pass_encrypted: string;
  pass_key_version: number;
  enabled: boolean;
}

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

/** Fetch the singleton smtp_configuration row. */
async function fetchSmtpRow(client?: PoolClient): Promise<SmtpConfigRow | null> {
  const q =
    'SELECT host, port, username, pass_encrypted, pass_key_version, enabled FROM smtp_configuration LIMIT 1';
  const result = client ? await client.query<SmtpConfigRow>(q) : await pool.query<SmtpConfigRow>(q);
  return result.rows[0] ?? null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the SMTP configuration safe for returning to clients.
 * The encrypted password is never included; smtp_pass_set indicates whether one is stored.
 */
export async function getSmtpConfig(): Promise<SmtpConfigPublic> {
  const row = await fetchSmtpRow();
  return {
    smtp_host: row?.host ?? '',
    smtp_port: row?.port ?? 587,
    smtp_user: row?.username ?? '',
    smtp_pass_set: Boolean(row?.pass_encrypted),
    smtp_enabled: row?.enabled ?? false,
  };
}

/**
 * Returns the full SMTP configuration including the decrypted password for internal use.
 * Returns null for smtp_pass when no password has been stored or decryption fails.
 */
export async function getSmtpConfigInternal(): Promise<SmtpConfigInternal> {
  const row = await fetchSmtpRow();

  let smtp_pass: string | null = null;
  const ciphertext = row?.pass_encrypted ?? '';
  if (ciphertext) {
    try {
      smtp_pass = decryptVersioned(ciphertext, row?.pass_key_version ?? 1);
    } catch (err) {
      logger.error(
        { err },
        'smtpSettingsService: failed to decrypt pass_encrypted — treating as unset',
      );
    }
  }

  return {
    smtp_host: row?.host ?? '',
    smtp_port: row?.port ?? 587,
    smtp_user: row?.username ?? '',
    smtp_pass,
    smtp_enabled: row?.enabled ?? false,
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
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    if (input.smtp_pass !== undefined) {
      const versionedPass = encryptVersioned(input.smtp_pass);
      await client.query(
        `UPDATE smtp_configuration SET
           host = $1, port = $2, username = $3,
           pass_encrypted = $4, pass_key_version = $5, enabled = $6,
           updated_at = now()`,
        [
          input.smtp_host,
          input.smtp_port,
          input.smtp_user,
          versionedPass.ciphertext,
          versionedPass.keyVersion,
          input.smtp_enabled,
        ],
      );
    } else {
      await client.query(
        `UPDATE smtp_configuration SET
           host = $1, port = $2, username = $3,
           enabled = $4, updated_at = now()`,
        [input.smtp_host, input.smtp_port, input.smtp_user, input.smtp_enabled],
      );
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
