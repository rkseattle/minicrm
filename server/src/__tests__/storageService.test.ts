/**
 * Unit + integration tests for storageService. (MINCRM-197)
 *
 * MinIO client calls are intercepted via vi.mock('minio') — no real S3 calls.
 * DB-touching paths (getStorageConfig / setStorageConfig) run against the real
 * test database so the encrypt/decrypt round-trip through system_settings is
 * verified end-to-end.
 */

import 'dotenv/config';
import { Readable } from 'stream';
import { vi } from 'vitest';
import pool from '../db.js';

// ── MinIO mock ────────────────────────────────────────────────────────────────

const mockPutObject = vi.fn().mockResolvedValue(undefined);
const mockGetObject = vi.fn();
const mockRemoveObject = vi.fn().mockResolvedValue(undefined);
const mockBucketExists = vi.fn().mockResolvedValue(true);

// Captured constructor options — lets buildClient parsing tests assert on
// the exact hostname/port/useSSL values forwarded to the MinIO constructor.
const mockClientCtorArgs: unknown[] = [];

vi.mock('minio', () => {
  // Must use a class so `new Client(...)` works — arrow functions cannot be constructors.
  class MockClient {
    constructor(opts: unknown) {
      mockClientCtorArgs.push(opts);
    }
    putObject = mockPutObject;
    getObject = mockGetObject;
    removeObject = mockRemoveObject;
    bucketExists = mockBucketExists;
  }
  return { Client: MockClient };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const STORAGE_KEYS = [
  'storage_endpoint',
  'storage_bucket',
  'storage_access_key_id',
  'storage_secret_access_key',
];

async function clearStorageSettings(): Promise<void> {
  await pool.query('DELETE FROM system_settings WHERE key = ANY($1)', [STORAGE_KEYS]);
}

/** Seeds a valid storage config into system_settings via setStorageConfig. */
async function seedStorageConfig(): Promise<void> {
  const { setStorageConfig } = await import('../services/storageService.js');
  await setStorageConfig({
    endpoint: 'http://minio:9000',
    bucket: 'test-bucket',
    accessKeyId: 'AKIAIOSFODNN7',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  await clearStorageSettings();
  vi.clearAllMocks();
  mockClientCtorArgs.length = 0;
});

afterAll(async () => {
  await clearStorageSettings();
});

// ── getStorageConfig ──────────────────────────────────────────────────────────

describe('getStorageConfig', () => {
  it('returns null when no settings are stored', async () => {
    const { getStorageConfig } = await import('../services/storageService.js');
    expect(await getStorageConfig()).toBeNull();
  });

  it('returns the decrypted config after setStorageConfig', async () => {
    await seedStorageConfig();
    const { getStorageConfig } = await import('../services/storageService.js');
    const config = await getStorageConfig();
    expect(config).not.toBeNull();
    expect(config!.endpoint).toBe('http://minio:9000');
    expect(config!.bucket).toBe('test-bucket');
    expect(config!.accessKeyId).toBe('AKIAIOSFODNN7');
    expect(config!.secretAccessKey).toBe('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });

  it('returns null when the stored secret cannot be decrypted', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES
         ('storage_endpoint',        'http://minio:9000', now()),
         ('storage_bucket',          'bucket',            now()),
         ('storage_access_key_id',   'key',               now()),
         ('storage_secret_access_key', 'not:valid:hex',   now())`,
    );
    const { getStorageConfig } = await import('../services/storageService.js');
    expect(await getStorageConfig()).toBeNull();
  });

  it('returns null when only some keys are present', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('storage_endpoint', 'http://minio:9000', now())`,
    );
    const { getStorageConfig } = await import('../services/storageService.js');
    expect(await getStorageConfig()).toBeNull();
  });
});

// ── setStorageConfig ──────────────────────────────────────────────────────────

describe('setStorageConfig', () => {
  it('returns the public-safe config with masked secret', async () => {
    const { setStorageConfig } = await import('../services/storageService.js');
    const result = await setStorageConfig({
      endpoint: 'http://minio:9000',
      bucket: 'my-bucket',
      accessKeyId: 'access',
      secretAccessKey: 'verysecret',
    });
    expect(result).not.toBeNull();
    expect(result!.secretAccessKey).toBe('********');
    expect(result!.endpoint).toBe('http://minio:9000');
    expect(result!.bucket).toBe('my-bucket');
    expect(result!.accessKeyId).toBe('access');
  });

  it('does not store the plaintext secret in system_settings', async () => {
    const { setStorageConfig } = await import('../services/storageService.js');
    await setStorageConfig({
      endpoint: 'http://minio:9000',
      bucket: 'bucket',
      accessKeyId: 'key',
      secretAccessKey: 'plaintext-secret',
    });
    const row = await pool.query<{ value: string }>(
      `SELECT value FROM system_settings WHERE key = 'storage_secret_access_key'`,
    );
    expect(row.rows[0].value).not.toBe('plaintext-secret');
    expect(row.rows[0].value).toContain(':'); // iv:authTag:ciphertext format
  });

  it('upserts — second call overwrites the first', async () => {
    const { setStorageConfig, getStorageConfig } = await import('../services/storageService.js');
    await setStorageConfig({
      endpoint: 'http://old:9000',
      bucket: 'old-bucket',
      accessKeyId: 'old-key',
      secretAccessKey: 'old-secret',
    });
    await setStorageConfig({
      endpoint: 'http://new:9000',
      bucket: 'new-bucket',
      accessKeyId: 'new-key',
      secretAccessKey: 'new-secret',
    });
    const config = await getStorageConfig();
    expect(config!.endpoint).toBe('http://new:9000');
    expect(config!.secretAccessKey).toBe('new-secret');
  });

  it('passing null clears all storage settings and returns null', async () => {
    await seedStorageConfig();
    const { setStorageConfig } = await import('../services/storageService.js');
    const result = await setStorageConfig(null);
    expect(result).toBeNull();
    const check = await pool.query(
      `SELECT count(*)::int AS n FROM system_settings WHERE key = ANY($1)`,
      [STORAGE_KEYS],
    );
    expect(check.rows[0].n).toBe(0);
  });
});

// ── uploadObject ──────────────────────────────────────────────────────────────

describe('uploadObject', () => {
  it('throws STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    const { uploadObject } = await import('../services/storageService.js');
    await expect(
      uploadObject('path/file.pdf', Buffer.alloc(0), 'application/pdf'),
    ).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it('calls putObject with the correct bucket, key, buffer, and Content-Type', async () => {
    await seedStorageConfig();
    const { uploadObject } = await import('../services/storageService.js');
    const buf = Buffer.from('hello world');

    await uploadObject('attachments/abc123.pdf', buf, 'application/pdf');

    expect(mockPutObject).toHaveBeenCalledOnce();
    expect(mockPutObject).toHaveBeenCalledWith(
      'test-bucket',
      'attachments/abc123.pdf',
      buf,
      buf.length,
      { 'Content-Type': 'application/pdf' },
    );
  });

  it('calls putObject with the correct length for a non-empty buffer', async () => {
    await seedStorageConfig();
    const { uploadObject } = await import('../services/storageService.js');
    const buf = Buffer.alloc(512, 0xff);

    await uploadObject(
      'docs/report.xlsx',
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const [, , , passedLength] = mockPutObject.mock.calls[0];
    expect(passedLength).toBe(512);
  });

  it('propagates errors thrown by the MinIO client', async () => {
    await seedStorageConfig();
    const { uploadObject } = await import('../services/storageService.js');
    mockPutObject.mockRejectedValueOnce(new Error('bucket not found'));

    await expect(uploadObject('key', Buffer.alloc(0), 'text/plain')).rejects.toThrow(
      'bucket not found',
    );
  });
});

// ── getObjectStream ───────────────────────────────────────────────────────────

describe('getObjectStream', () => {
  it('throws STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    const { getObjectStream } = await import('../services/storageService.js');
    await expect(getObjectStream('any/key')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('calls getObject with the correct bucket and key', async () => {
    await seedStorageConfig();
    const fakeStream = Readable.from(['data']);
    mockGetObject.mockResolvedValueOnce(fakeStream);

    const { getObjectStream } = await import('../services/storageService.js');
    const result = await getObjectStream('attachments/abc123.pdf');

    expect(mockGetObject).toHaveBeenCalledOnce();
    expect(mockGetObject).toHaveBeenCalledWith('test-bucket', 'attachments/abc123.pdf');
    expect(result).toBe(fakeStream);
  });

  it('propagates errors thrown by the MinIO client', async () => {
    await seedStorageConfig();
    mockGetObject.mockRejectedValueOnce(new Error('object not found'));
    const { getObjectStream } = await import('../services/storageService.js');
    await expect(getObjectStream('missing/key')).rejects.toThrow('object not found');
  });
});

// ── deleteObject ──────────────────────────────────────────────────────────────

describe('deleteObject', () => {
  it('throws STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    const { deleteObject } = await import('../services/storageService.js');
    await expect(deleteObject('any/key')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
    expect(mockRemoveObject).not.toHaveBeenCalled();
  });

  it('calls removeObject with the correct bucket and key', async () => {
    await seedStorageConfig();
    const { deleteObject } = await import('../services/storageService.js');

    await deleteObject('attachments/file-to-delete.pdf');

    expect(mockRemoveObject).toHaveBeenCalledOnce();
    expect(mockRemoveObject).toHaveBeenCalledWith('test-bucket', 'attachments/file-to-delete.pdf');
  });

  it('propagates errors thrown by the MinIO client', async () => {
    await seedStorageConfig();
    mockRemoveObject.mockRejectedValueOnce(new Error('remote error'));
    const { deleteObject } = await import('../services/storageService.js');
    await expect(deleteObject('key')).rejects.toThrow('remote error');
  });
});

// ── testStorageConnection ─────────────────────────────────────────────────────

describe('testStorageConnection', () => {
  const candidateConfig = {
    endpoint: 'http://minio:9000',
    bucket: 'candidate-bucket',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
  };

  it('returns true when bucketExists resolves without error', async () => {
    mockBucketExists.mockResolvedValueOnce(true);
    const { testStorageConnection } = await import('../services/storageService.js');
    expect(await testStorageConnection(candidateConfig)).toBe(true);
    expect(mockBucketExists).toHaveBeenCalledWith('candidate-bucket');
  });

  it('returns false when bucketExists throws', async () => {
    mockBucketExists.mockRejectedValueOnce(new Error('connection refused'));
    const { testStorageConnection } = await import('../services/storageService.js');
    expect(await testStorageConnection(candidateConfig)).toBe(false);
  });

  it('uses candidate config bucket, not the persisted config bucket', async () => {
    // Seed a different persisted config — candidate must win
    await seedStorageConfig();
    vi.clearAllMocks();
    mockBucketExists.mockResolvedValueOnce(true);

    const { testStorageConnection } = await import('../services/storageService.js');
    const result = await testStorageConnection({
      endpoint: 'http://other-host:8080',
      bucket: 'other-bucket',
      accessKeyId: 'other-key',
      secretAccessKey: 'other-secret',
    });

    // bucketExists must be called with the candidate bucket, not the seeded 'test-bucket'
    expect(mockBucketExists).toHaveBeenCalledWith('other-bucket');
    expect(result).toBe(true);
  });
});

// ── buildClient (endpoint parsing) ───────────────────────────────────────────

describe('buildClient endpoint parsing', () => {
  async function buildClientWithEndpoint(endpoint: string): Promise<unknown> {
    const { setStorageConfig, uploadObject } = await import('../services/storageService.js');
    await setStorageConfig({
      endpoint,
      bucket: 'parse-test-bucket',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
    await uploadObject('test/key', Buffer.alloc(1), 'text/plain');
    return mockClientCtorArgs.at(-1);
  }

  it('parses http endpoint with explicit port', async () => {
    const opts = await buildClientWithEndpoint('http://minio:9000');
    expect(opts).toMatchObject({ endPoint: 'minio', port: 9000, useSSL: false });
  });

  it('defaults to port 80 for http with no port', async () => {
    const opts = await buildClientWithEndpoint('http://storage.example.com');
    expect(opts).toMatchObject({ endPoint: 'storage.example.com', port: 80, useSSL: false });
  });

  it('defaults to port 443 and useSSL=true for https with no port', async () => {
    const opts = await buildClientWithEndpoint('https://storage.example.com');
    expect(opts).toMatchObject({ endPoint: 'storage.example.com', port: 443, useSSL: true });
  });

  it('parses https endpoint with explicit port', async () => {
    const opts = await buildClientWithEndpoint('https://secure-minio:9443');
    expect(opts).toMatchObject({ endPoint: 'secure-minio', port: 9443, useSSL: true });
  });

  it('parses a bare hostname (no scheme) as http', async () => {
    const opts = await buildClientWithEndpoint('minio:9000');
    expect(opts).toMatchObject({ endPoint: 'minio', useSSL: false });
  });

  it('forwards accessKey and secretKey from config', async () => {
    const { setStorageConfig, uploadObject } = await import('../services/storageService.js');
    await setStorageConfig({
      endpoint: 'http://minio:9000',
      bucket: 'b',
      accessKeyId: 'my-access-key',
      secretAccessKey: 'my-secret-key',
    });
    await uploadObject('k', Buffer.alloc(1), 'text/plain');
    expect(mockClientCtorArgs.at(-1)).toMatchObject({
      accessKey: 'my-access-key',
      secretKey: 'my-secret-key',
    });
  });
});
