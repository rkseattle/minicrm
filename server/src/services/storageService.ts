/**
 * Storage service — wraps the MinIO/S3-compatible client.
 * All object storage I/O goes through this module. (MINCRM-167, MINCRM-169)
 *
 * Configuration is read from system_settings at runtime so an admin can
 * update the storage backend without restarting the server.
 */

import { Client as MinioClient } from 'minio';
import type { Readable } from 'stream';
import pool from '../db.js';
import logger from '../logger.js';
import { decrypt, encrypt } from './cryptoService.js';

// ── system_settings keys ──────────────────────────────────────────────────────

export const STORAGE_ENDPOINT_KEY = 'storage_endpoint';
export const STORAGE_BUCKET_KEY = 'storage_bucket';
export const STORAGE_ACCESS_KEY_ID_KEY = 'storage_access_key_id';
/** Value stored encrypted via cryptoService. */
export const STORAGE_SECRET_ACCESS_KEY_KEY = 'storage_secret_access_key';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Plain-text storage configuration as seen by internal code. */
export interface StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  /** Never returned to the client. */
  secretAccessKey: string;
}

/** Storage config shape safe to return to admin callers (secret masked). */
export interface StorageConfigPublic {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  /** Always '********' — never the real value. */
  secretAccessKey: string;
}

// ── Config read/write ─────────────────────────────────────────────────────────

/**
 * Reads the storage configuration from system_settings.
 * Returns null when storage has not been configured yet.
 *
 * @returns The decrypted config, or null if not configured.
 */
export async function getStorageConfig(): Promise<StorageConfig | null> {
  const result = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings
     WHERE key = ANY($1)`,
    [
      [
        STORAGE_ENDPOINT_KEY,
        STORAGE_BUCKET_KEY,
        STORAGE_ACCESS_KEY_ID_KEY,
        STORAGE_SECRET_ACCESS_KEY_KEY,
      ],
    ],
  );

  const map: Record<string, string> = {};
  for (const row of result.rows) {
    map[row.key] = row.value;
  }

  if (
    !map[STORAGE_ENDPOINT_KEY] ||
    !map[STORAGE_BUCKET_KEY] ||
    !map[STORAGE_ACCESS_KEY_ID_KEY] ||
    !map[STORAGE_SECRET_ACCESS_KEY_KEY]
  ) {
    return null;
  }

  let secretAccessKey: string;
  try {
    secretAccessKey = decrypt(map[STORAGE_SECRET_ACCESS_KEY_KEY]);
  } catch (err) {
    logger.error({ err }, 'Failed to decrypt storage secret — storage unavailable');
    return null;
  }

  return {
    endpoint: map[STORAGE_ENDPOINT_KEY],
    bucket: map[STORAGE_BUCKET_KEY],
    accessKeyId: map[STORAGE_ACCESS_KEY_ID_KEY],
    secretAccessKey,
  };
}

/**
 * Persists storage configuration to system_settings.
 * The secret access key is encrypted before storage.
 * Pass null to clear all storage settings.
 *
 * @param config - The new configuration, or null to clear.
 * @returns The public-safe representation (secret masked), or null if cleared.
 */
export async function setStorageConfig(
  config: (Omit<StorageConfig, 'secretAccessKey'> & { secretAccessKey: string }) | null,
): Promise<StorageConfigPublic | null> {
  if (config === null) {
    await pool.query(
      `DELETE FROM system_settings
       WHERE key = ANY($1)`,
      [
        [
          STORAGE_ENDPOINT_KEY,
          STORAGE_BUCKET_KEY,
          STORAGE_ACCESS_KEY_ID_KEY,
          STORAGE_SECRET_ACCESS_KEY_KEY,
        ],
      ],
    );
    return null;
  }

  const encryptedSecret = encrypt(config.secretAccessKey);

  const upserts: Array<[string, string]> = [
    [STORAGE_ENDPOINT_KEY, config.endpoint],
    [STORAGE_BUCKET_KEY, config.bucket],
    [STORAGE_ACCESS_KEY_ID_KEY, config.accessKeyId],
    [STORAGE_SECRET_ACCESS_KEY_KEY, encryptedSecret],
  ];

  for (const [key, value] of upserts) {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value],
    );
  }

  return {
    endpoint: config.endpoint,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: '********',
  };
}

// ── Client factory ────────────────────────────────────────────────────────────

/**
 * Builds a MinIO client from a StorageConfig.
 * Parses the endpoint URL to extract host, port, and TLS flag.
 *
 * @param config - The storage configuration.
 * @returns A configured MinIO Client instance.
 */
function buildClient(config: StorageConfig): MinioClient {
  const url = new URL(
    config.endpoint.startsWith('http') ? config.endpoint : `http://${config.endpoint}`,
  );
  const useSsl = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : useSsl ? 443 : 80;

  return new MinioClient({
    endPoint: url.hostname,
    port,
    useSSL: useSsl,
    accessKey: config.accessKeyId,
    secretKey: config.secretAccessKey,
  });
}

// ── Public storage operations ─────────────────────────────────────────────────

/**
 * Uploads a buffer to object storage under the given key.
 *
 * @param key - The object key (path within the bucket).
 * @param buffer - File contents.
 * @param mimeType - MIME type for the Content-Type metadata.
 */
export async function uploadObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  const config = await getStorageConfig();
  if (!config) {
    const err = new Error('Storage is not configured');
    (err as NodeJS.ErrnoException).code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }

  const client = buildClient(config);
  await client.putObject(config.bucket, key, buffer, buffer.length, {
    'Content-Type': mimeType,
  });
}

/**
 * Returns a readable stream for the object at the given key.
 *
 * @param key - The object key.
 * @returns A Node.js Readable stream.
 */
export async function getObjectStream(key: string): Promise<Readable> {
  const config = await getStorageConfig();
  if (!config) {
    const err = new Error('Storage is not configured');
    (err as NodeJS.ErrnoException).code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }

  const client = buildClient(config);
  return client.getObject(config.bucket, key);
}

/**
 * Removes an object from storage.
 *
 * @param key - The object key to delete.
 */
export async function deleteObject(key: string): Promise<void> {
  const config = await getStorageConfig();
  if (!config) {
    const err = new Error('Storage is not configured');
    (err as NodeJS.ErrnoException).code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }

  const client = buildClient(config);
  await client.removeObject(config.bucket, key);
}

/**
 * Tests connectivity and bucket accessibility using the provided config.
 * Does NOT use the persisted config — validates candidate credentials.
 *
 * @param config - Candidate storage configuration.
 * @returns True if the bucket is accessible, false otherwise.
 */
export async function testStorageConnection(config: StorageConfig): Promise<boolean> {
  try {
    const client = buildClient(config);
    await client.bucketExists(config.bucket);
    return true;
  } catch (err) {
    logger.warn({ err }, 'Storage connection test failed');
    return false;
  }
}
