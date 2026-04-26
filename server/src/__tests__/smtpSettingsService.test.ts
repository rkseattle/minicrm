/**
 * Integration tests for smtpSettingsService. (MINCRM-254)
 *
 * Verifies that SMTP config is read/written correctly, that the password is
 * encrypted at rest and never returned in the public view, and that omitting
 * smtp_pass on update preserves the stored password.
 */

import 'dotenv/config';
import pool from '../db.js';
import {
  getSmtpConfig,
  getSmtpConfigInternal,
  setSmtpConfig,
} from '../services/smtpSettingsService.js';

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass_encrypted', 'smtp_enabled'];

async function resetSmtpSettings(): Promise<void> {
  await pool.query(
    `UPDATE system_settings SET value = CASE
       WHEN key = 'smtp_port'    THEN '587'
       WHEN key = 'smtp_enabled' THEN 'false'
       ELSE ''
     END, updated_at = now()
     WHERE key = ANY($1)`,
    [SMTP_KEYS],
  );
}

beforeEach(async () => {
  await resetSmtpSettings();
});

afterAll(async () => {
  await resetSmtpSettings();
  await pool.end();
});

describe('getSmtpConfig', () => {
  it('returns default values when nothing is configured', async () => {
    const config = await getSmtpConfig();
    expect(config.smtp_host).toBe('');
    expect(config.smtp_port).toBe(587);
    expect(config.smtp_user).toBe('');
    expect(config.smtp_pass_set).toBe(false);
    expect(config.smtp_enabled).toBe(false);
  });

  it('never returns smtp_pass_encrypted as a field', async () => {
    const config = await getSmtpConfig();
    expect('smtp_pass_encrypted' in config).toBe(false);
    expect('smtp_pass' in config).toBe(false);
  });
});

describe('setSmtpConfig', () => {
  it('stores and retrieves non-sensitive fields correctly', async () => {
    await setSmtpConfig({
      smtp_host: 'smtp.example.com',
      smtp_port: 465,
      smtp_user: 'user@example.com',
      smtp_pass: 'hunter2',
      smtp_enabled: true,
    });

    const config = await getSmtpConfig();
    expect(config.smtp_host).toBe('smtp.example.com');
    expect(config.smtp_port).toBe(465);
    expect(config.smtp_user).toBe('user@example.com');
    expect(config.smtp_pass_set).toBe(true);
    expect(config.smtp_enabled).toBe(true);
  });

  it('stores the password encrypted (ciphertext differs from plaintext)', async () => {
    await setSmtpConfig({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_pass: 'supersecret',
      smtp_enabled: false,
    });

    const row = await pool.query<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = 'smtp_pass_encrypted'",
    );
    const storedValue = row.rows[0]?.value ?? '';
    expect(storedValue).not.toBe('supersecret');
    // Encrypted format is iv:authTag:ciphertext (two colons minimum)
    expect(storedValue.split(':').length).toBeGreaterThanOrEqual(3);
  });

  it('can decrypt the stored password via getSmtpConfigInternal', async () => {
    await setSmtpConfig({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_pass: 'roundtrip_password',
      smtp_enabled: false,
    });

    const internal = await getSmtpConfigInternal();
    expect(internal.smtp_pass).toBe('roundtrip_password');
  });

  it('preserves the existing password when smtp_pass is omitted', async () => {
    await setSmtpConfig({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_pass: 'original_password',
      smtp_enabled: false,
    });

    // Update without smtp_pass
    await setSmtpConfig({
      smtp_host: 'smtp.updated.com',
      smtp_port: 465,
      smtp_user: 'updated@example.com',
      smtp_enabled: true,
    });

    const internal = await getSmtpConfigInternal();
    expect(internal.smtp_host).toBe('smtp.updated.com');
    expect(internal.smtp_port).toBe(465);
    expect(internal.smtp_pass).toBe('original_password');
  });

  it('overwrites the password when a new smtp_pass is provided', async () => {
    await setSmtpConfig({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_pass: 'old_password',
      smtp_enabled: false,
    });

    await setSmtpConfig({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_user: 'user@example.com',
      smtp_pass: 'new_password',
      smtp_enabled: false,
    });

    const internal = await getSmtpConfigInternal();
    expect(internal.smtp_pass).toBe('new_password');
  });
});

describe('getSmtpConfigInternal', () => {
  it('returns null for smtp_pass when no password is stored', async () => {
    const internal = await getSmtpConfigInternal();
    expect(internal.smtp_pass).toBeNull();
  });
});
