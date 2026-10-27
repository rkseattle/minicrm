/**
 * The SAML SP signing certificate: issued as real X.509, and reissued for its existing key
 * when an older release stored a bare public key under certificate headers.
 *
 * Runs against the real minicrm_test PostgreSQL database.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import crypto from 'crypto';
import pool from '../db.js';
import { encrypt } from '../services/cryptoService.js';
import { purgeFixtureUsers } from './testUtils.js';
import type * as SsoServiceModule from '../services/ssoService.js';
import { buildSamlSpMetadata, _resetSamlSpKeyPairCacheForTesting } from '../services/ssoService.js';

// Restated, not imported: these pin the persisted setting names an upgrade must still find.
const SP_PRIVATE_KEY_KEY = 'sso_sp_private_key_encrypted';
const SP_SIGNING_CERT_KEY = 'sso_sp_signing_cert';

async function storedCertificate(): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = $1',
    [SP_SIGNING_CERT_KEY],
  );
  return rows[0].value;
}

async function databaseNow(): Promise<Date> {
  const { rows } = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return rows[0].now;
}

async function keyPairAuditEvents(since: Date): Promise<string[]> {
  const { rows } = await pool.query<{ event_type: string }>(
    `SELECT event_type FROM audit_log
      WHERE record_type = 'system_settings' AND record_name = $1 AND created_at >= $2
      ORDER BY created_at`,
    [SP_SIGNING_CERT_KEY, since],
  );
  return rows.map((r) => r.event_type);
}

/** Who last wrote each key-pair row; the system is recorded as no user. */
async function storedKeyPairRows(): Promise<{ key: string; updated_by: string | null }[]> {
  const { rows } = await pool.query<{ key: string; updated_by: string | null }>(
    'SELECT key, updated_by FROM system_settings WHERE key = ANY($1) ORDER BY key',
    [[SP_PRIVATE_KEY_KEY, SP_SIGNING_CERT_KEY]],
  );
  return rows;
}

function certificateBody(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s/g, '');
}

const FIXTURE_EMAIL = 'sso-sp-cert-editor@example.com';
let editorId: string;

beforeAll(async () => {
  await purgeFixtureUsers({ emails: [FIXTURE_EMAIL] });
  const editor = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, password_hash, status)
     VALUES ($1, 'SP Cert Editor', 'admin', '$2b$12$placeholder', 'active') RETURNING id`,
    [FIXTURE_EMAIL],
  );
  editorId = editor.rows[0]!.id; // Safe: INSERT ... RETURNING yields one row.
});

beforeEach(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [
    [SP_PRIVATE_KEY_KEY, SP_SIGNING_CERT_KEY],
  ]);
  _resetSamlSpKeyPairCacheForTesting();
});

afterAll(async () => {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [
    [SP_PRIVATE_KEY_KEY, SP_SIGNING_CERT_KEY],
  ]);
  await purgeFixtureUsers({ emails: [FIXTURE_EMAIL] });
  await pool.end();
});

describe('SAML SP signing certificate', () => {
  it('publishes a parseable X.509 certificate in fresh metadata, and audits the generation', async () => {
    // A half-written pair a user last touched: generation replaces it as the system.
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at, updated_by) VALUES ($1, 'stale', now(), $2)`,
      [SP_PRIVATE_KEY_KEY, editorId],
    );
    const since = await databaseNow();
    const xml = await buildSamlSpMetadata();
    const stored = await storedCertificate();

    expect(() => new crypto.X509Certificate(stored)).not.toThrow();
    expect(xml.replace(/\s/g, '')).toContain(certificateBody(stored));
    expect(await keyPairAuditEvents(since)).toEqual(['created']);
    expect(await storedKeyPairRows()).toEqual([
      { key: SP_PRIVATE_KEY_KEY, updated_by: null },
      { key: SP_SIGNING_CERT_KEY, updated_by: null },
    ]);
  });

  it('generates one key pair when two processes race for it', async () => {
    // A query string loads a second module instance: its own cache, the same database.
    const secondInstance = '../services/ssoService.js?second-process';
    // Same source file as the static import, so the same exports.
    const otherProcess = (await import(secondInstance)) as typeof SsoServiceModule;
    const since = await databaseNow();

    const [a, b] = await Promise.all([buildSamlSpMetadata(), otherProcess.buildSamlSpMetadata()]);
    const body = certificateBody(await storedCertificate());

    expect(a.replace(/\s/g, '')).toContain(body);
    expect(b.replace(/\s/g, '')).toContain(body);
    expect(await keyPairAuditEvents(since)).toEqual(['created']);
  });

  it('reissues a legacy bare-key certificate for the same key, and persists it', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const legacy = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '-----BEGIN CERTIFICATE-----')
      .replace('-----END PUBLIC KEY-----', '-----END CERTIFICATE-----');
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2, now(), $5), ($3, $4, now(), $5)`,
      [SP_PRIVATE_KEY_KEY, encrypt(privateKey), SP_SIGNING_CERT_KEY, legacy, editorId],
    );

    const since = await databaseNow();
    const xml = await buildSamlSpMetadata();
    const stored = await storedCertificate();
    const certificate = new crypto.X509Certificate(stored);

    expect(certificate.checkPrivateKey(crypto.createPrivateKey(privateKey))).toBe(true);
    expect(xml.replace(/\s/g, '')).toContain(certificateBody(stored));
    expect(await keyPairAuditEvents(since)).toEqual(['updated']);
    // Only the certificate was rewritten, by the system; the key keeps its last writer.
    expect(await storedKeyPairRows()).toEqual([
      { key: SP_PRIVATE_KEY_KEY, updated_by: editorId },
      { key: SP_SIGNING_CERT_KEY, updated_by: null },
    ]);
  });

  it('keeps a valid stored certificate as it is', async () => {
    await buildSamlSpMetadata();
    const first = await storedCertificate();
    _resetSamlSpKeyPairCacheForTesting();
    const since = await databaseNow();

    await buildSamlSpMetadata();

    expect(await storedCertificate()).toBe(first);
    expect(await keyPairAuditEvents(since)).toEqual([]);
  });

  it('shares one load between concurrent callers in a process', async () => {
    const connect = vi.spyOn(pool, 'connect');
    try {
      const [a, b] = await Promise.all([buildSamlSpMetadata(), buildSamlSpMetadata()]);
      const body = certificateBody(await storedCertificate());

      expect(a.replace(/\s/g, '')).toContain(body);
      expect(b.replace(/\s/g, '')).toContain(body);
      // pool.query checks out with a callback; only a transaction calls connect() bare.
      expect(connect.mock.calls.filter((args) => args[0] === undefined)).toHaveLength(1);
    } finally {
      connect.mockRestore();
    }
  });

  it('rolls back and retries on the next call when a load fails', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, now()), ($3, $4, now())`,
      [SP_PRIVATE_KEY_KEY, 'not-a-ciphertext', SP_SIGNING_CERT_KEY, 'not-a-certificate'],
    );

    await expect(buildSamlSpMetadata()).rejects.toThrow();
    expect(await storedCertificate()).toBe('not-a-certificate');

    await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [
      [SP_PRIVATE_KEY_KEY, SP_SIGNING_CERT_KEY],
    ]);
    await expect(buildSamlSpMetadata()).resolves.toContain('EntityDescriptor');
  });
});
