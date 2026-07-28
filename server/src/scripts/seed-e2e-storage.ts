/**
 * seed-e2e-storage.ts — Write MinIO storage config into system_settings for E2E.
 *
 * Inserts (or overwrites) the four storage_* keys so the E2E server process
 * finds a fully configured storage backend without requiring a manual admin
 * setup step. The secret access key is encrypted with AES-256-GCM before
 * storage, matching the pattern used by storageService / cryptoService.
 *
 * Usage:
 *   npm run seed:e2e-storage --workspace=minicrm-server
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT
 *   NODE_ENCRYPTION_KEY   — 64-char hex string (32 bytes)
 *   E2E_STORAGE_ENDPOINT  — e.g. http://localhost:9000
 *   E2E_STORAGE_BUCKET    — e.g. minicrm-test-bucket
 *   E2E_STORAGE_ACCESS_KEY_ID
 *   E2E_STORAGE_SECRET_ACCESS_KEY
 *
 * MINCRM-278
 */

import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';
import { assertTestDatabaseTarget } from './assertTestDatabaseTarget.js';

const { Pool } = pg;

// ── Encryption (mirrors cryptoService.ts) ────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
  const raw = process.env.NODE_ENCRYPTION_KEY ?? '';
  if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error('NODE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  }
  return Buffer.from(raw, 'hex');
}

function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Refuse to run against anything but a test database — this script is destructive.
// The returned target IS the connection config: resolving DB_PORT/DB_NAME again from
// process.env would reintroduce the `|| 5432` fallback the guard exists to remove.
const testDbTarget = assertTestDatabaseTarget('seed-e2e-storage');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: testDbTarget.database,
  host: testDbTarget.host,
  port: Number(testDbTarget.port),
});

async function main(): Promise<void> {
  const endpoint = process.env.E2E_STORAGE_ENDPOINT;
  const bucket = process.env.E2E_STORAGE_BUCKET;
  const accessKeyId = process.env.E2E_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.E2E_STORAGE_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      '[seed-e2e-storage] E2E_STORAGE_ENDPOINT, E2E_STORAGE_BUCKET, ' +
        'E2E_STORAGE_ACCESS_KEY_ID, and E2E_STORAGE_SECRET_ACCESS_KEY must all be set.',
    );
  }

  const encryptedSecret = encrypt(secretAccessKey);

  const upserts: Array<[string, string]> = [
    ['storage_endpoint', endpoint],
    ['storage_bucket', bucket],
    ['storage_access_key_id', accessKeyId],
    ['storage_secret_access_key', encryptedSecret],
  ];

  const client = await pool.connect();
  try {
    for (const [key, value] of upserts) {
      await client.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value],
      );
    }
    console.log(`[seed-e2e-storage] Storage config written: endpoint=${endpoint} bucket=${bucket}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  throw err;
});
