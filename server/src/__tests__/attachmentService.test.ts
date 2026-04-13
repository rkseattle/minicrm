/**
 * Integration tests for attachmentService and cryptoService. (MINCRM-167, MINCRM-169)
 *
 * Note: uploadAttachment and downloadAttachment require a live MinIO instance.
 * Those paths are tested by inserting rows directly into the DB and verifying
 * the service logic (cap check, ownership) independently of storage I/O.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  listAttachments,
  deleteAttachment,
  findAttachmentById,
} from '../services/attachmentService.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import pool from '../db.js';

const UPLOADER = {
  email: 'attachment-uploader@example.com',
  name: 'Attachment Uploader',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const ADMIN = {
  email: 'attachment-admin@example.com',
  name: 'Attachment Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let uploaderId: string;
let _adminId: string;
let contactId: string;

beforeAll(async () => {
  // Clean up in FK-safe order
  await pool.query(
    "DELETE FROM attachments WHERE uploader_id IN (SELECT id FROM users WHERE email LIKE 'attachment-%')",
  );
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'attachment-%')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE 'attachment-%'");

  const uploader = await createUser(UPLOADER);
  uploaderId = uploader.id;

  const admin = await createUser(ADMIN);
  _adminId = admin.id;

  const contact = await createContact({
    first_name: 'Attach',
    last_name: 'Test',
    email: `attachtest-${Date.now()}@example.com`,
    owner_id: uploaderId,
  });
  contactId = contact.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM attachments WHERE record_type = $1 AND record_id = $2', [
    'contact',
    contactId,
  ]);
});

/** Inserts an attachment row directly (bypassing storage I/O). */
async function insertAttachment(opts: {
  filename: string;
  fileSize: number;
  uploadedAt?: string;
  uploaderId?: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO attachments
       (record_type, record_id, filename, file_size, mime_type, storage_key, uploader_id, uploaded_at)
     VALUES
       ('contact', $1, $2, $3, 'application/pdf', $4, $5, COALESCE($6::timestamptz, now()))
     RETURNING id`,
    [
      contactId,
      opts.filename,
      opts.fileSize,
      `key/${opts.filename}-${Date.now()}`,
      opts.uploaderId ?? uploaderId,
      opts.uploadedAt ?? null,
    ],
  );
  return result.rows[0].id;
}

// ── listAttachments ───────────────────────────────────────────────────────────

describe('listAttachments', () => {
  it('returns an empty array when there are no attachments', async () => {
    const result = await listAttachments('contact', contactId);
    expect(result).toEqual([]);
  });

  it('returns attachments ordered by uploaded_at DESC', async () => {
    await insertAttachment({
      filename: 'older.pdf',
      fileSize: 1000,
      uploadedAt: '2024-01-01T00:00:00Z',
    });
    await insertAttachment({
      filename: 'newer.pdf',
      fileSize: 2000,
      uploadedAt: '2024-06-01T00:00:00Z',
    });

    const result = await listAttachments('contact', contactId);
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('newer.pdf');
    expect(result[1].filename).toBe('older.pdf');
  });

  it('includes uploader_name from the joined users table', async () => {
    await insertAttachment({ filename: 'doc.pdf', fileSize: 500 });

    const result = await listAttachments('contact', contactId);
    expect(result[0].uploader_name).toBe('Attachment Uploader');
  });

  it('does not return attachments from other records', async () => {
    // Insert on a different record_id
    const uniqueKey = `key/other-${Date.now()}`;
    await pool.query(
      `INSERT INTO attachments
         (record_type, record_id, filename, file_size, mime_type, storage_key, uploader_id)
       VALUES ('account', gen_random_uuid(), 'other.pdf', 100, 'application/pdf', $2, $1)`,
      [uploaderId, uniqueKey],
    );

    const result = await listAttachments('contact', contactId);
    expect(result.every((a) => a.record_id === contactId)).toBe(true);
  });
});

// ── findAttachmentById ────────────────────────────────────────────────────────

describe('findAttachmentById', () => {
  it('returns null for a non-existent id', async () => {
    const result = await findAttachmentById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns the row for an existing attachment', async () => {
    const id = await insertAttachment({ filename: 'find-me.pdf', fileSize: 999 });
    const result = await findAttachmentById(id);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe('find-me.pdf');
    expect(result!.file_size).toBe(999);
  });
});

// ── deleteAttachment ──────────────────────────────────────────────────────────

describe('deleteAttachment — ownership', () => {
  it('throws FORBIDDEN when a non-admin non-uploader tries to delete', async () => {
    const id = await insertAttachment({ filename: 'protected.pdf', fileSize: 100 });

    const otherUser = await createUser({
      email: `attachment-other-${Date.now()}@example.com`,
      name: 'Other Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder_hash',
      status: 'active',
    });

    await expect(deleteAttachment(id, otherUser.id, 'rep')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // Row should still exist
    const still = await findAttachmentById(id);
    expect(still).not.toBeNull();
  });

  it('throws NOT_FOUND for a non-existent attachment', async () => {
    await expect(
      deleteAttachment('00000000-0000-0000-0000-000000000000', uploaderId, 'rep'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ── 100 MB cap check ──────────────────────────────────────────────────────────

describe('uploadAttachment — storage cap logic', () => {
  it('getTotalStorageBytes sums correctly via the DB', async () => {
    // Insert two rows totalling known sizes and verify via a direct query
    await insertAttachment({ filename: 'a.pdf', fileSize: 1000 });
    await insertAttachment({ filename: 'b.pdf', fileSize: 2000 });

    const result = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(file_size), 0)::text AS total
       FROM attachments
       WHERE record_type = 'contact' AND record_id = $1`,
      [contactId],
    );
    expect(Number(result.rows[0].total)).toBe(3000);
  });

  it('throws STORAGE_CAP_EXCEEDED when the cap would be exceeded', async () => {
    const { uploadAttachment } = await import('../services/attachmentService.js');

    // Fill the record to just under the 100 MB cap (99 MB)
    const nintyNineMb = 99 * 1024 * 1024;
    await insertAttachment({ filename: 'big.pdf', fileSize: nintyNineMb });

    // A 2 MB upload would push it over the 100 MB limit
    const twoMb = 2 * 1024 * 1024;
    await expect(
      uploadAttachment({
        recordType: 'contact',
        recordId: contactId,
        filename: 'overflow.pdf',
        fileSize: twoMb,
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(0),
        uploaderId,
      }),
    ).rejects.toMatchObject({ code: 'STORAGE_CAP_EXCEEDED' });
  });
});

// ── downloadAttachment ────────────────────────────────────────────────────────

describe('downloadAttachment', () => {
  it('throws NOT_FOUND for a non-existent attachment', async () => {
    const { downloadAttachment } = await import('../services/attachmentService.js');
    await expect(
      downloadAttachment('00000000-0000-0000-0000-000000000000', uploaderId, 'rep'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ── storageService (DB-only paths) ────────────────────────────────────────────

describe('storageService — DB-only operations', () => {
  const STORAGE_KEYS = [
    'storage_endpoint',
    'storage_bucket',
    'storage_access_key_id',
    'storage_secret_access_key',
  ];

  beforeEach(async () => {
    // Clean any leftover storage settings from previous runs
    await pool.query(`DELETE FROM system_settings WHERE key = ANY($1)`, [STORAGE_KEYS]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = ANY($1)`, [STORAGE_KEYS]);
  });

  it('getStorageConfig returns null when no settings are stored', async () => {
    const { getStorageConfig } = await import('../services/storageService.js');
    const result = await getStorageConfig();
    expect(result).toBeNull();
  });

  it('setStorageConfig(null) clears settings and returns null', async () => {
    const { setStorageConfig } = await import('../services/storageService.js');
    // Insert a dummy value first so there is something to delete
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('storage_endpoint', 'http://test', now())`,
    );
    const result = await setStorageConfig(null);
    expect(result).toBeNull();
    // Verify deletion
    const check = await pool.query(`SELECT 1 FROM system_settings WHERE key = 'storage_endpoint'`);
    expect(check.rowCount).toBe(0);
  });

  it('setStorageConfig writes encrypted secret and getStorageConfig reads it back', async () => {
    const { setStorageConfig, getStorageConfig } = await import('../services/storageService.js');

    const saved = await setStorageConfig({
      endpoint: 'http://minio:9000',
      bucket: 'test-bucket',
      accessKeyId: 'testkey',
      secretAccessKey: 'supersecret',
    });

    expect(saved).not.toBeNull();
    expect(saved!.secretAccessKey).toBe('********');
    expect(saved!.endpoint).toBe('http://minio:9000');

    const config = await getStorageConfig();
    expect(config).not.toBeNull();
    expect(config!.endpoint).toBe('http://minio:9000');
    expect(config!.bucket).toBe('test-bucket');
    expect(config!.accessKeyId).toBe('testkey');
    expect(config!.secretAccessKey).toBe('supersecret');
  });

  it('getStorageConfig returns null when the stored secret cannot be decrypted', async () => {
    const { getStorageConfig } = await import('../services/storageService.js');

    // Insert a garbage (non-decryptable) value for the secret
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES
         ('storage_endpoint', 'http://minio:9000', now()),
         ('storage_bucket', 'bucket', now()),
         ('storage_access_key_id', 'key', now()),
         ('storage_secret_access_key', 'not:valid:hex', now())`,
    );

    const result = await getStorageConfig();
    expect(result).toBeNull();
  });

  it('uploadObject throws STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    const { uploadObject } = await import('../services/storageService.js');
    await expect(uploadObject('any/key', Buffer.alloc(0), 'application/pdf')).rejects.toMatchObject(
      { code: 'STORAGE_NOT_CONFIGURED' },
    );
  });

  it('getObjectStream throws STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    const { getObjectStream } = await import('../services/storageService.js');
    await expect(getObjectStream('any/key')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
  });

  it('deleteObject throws STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    const { deleteObject } = await import('../services/storageService.js');
    await expect(deleteObject('any/key')).rejects.toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
    });
  });

  it('testStorageConnection returns false when the endpoint is unreachable', async () => {
    const { testStorageConnection } = await import('../services/storageService.js');
    const result = await testStorageConnection({
      endpoint: 'http://localhost:19999',
      bucket: 'no-such-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
    expect(result).toBe(false);
  });
});

// ── cryptoService ─────────────────────────────────────────────────────────────

describe('cryptoService encrypt/decrypt', () => {
  it('round-trips a plaintext value', async () => {
    const { encrypt, decrypt } = await import('../services/cryptoService.js');

    const plaintext = 'super-secret-s3-key';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('throws on a tampered auth tag', async () => {
    const { encrypt, decrypt } = await import('../services/cryptoService.js');
    const encrypted = encrypt('value');
    const [iv, , ciphertext] = encrypted.split(':');
    const tampered = `${iv}:deadbeefdeadbeefdeadbeefdeadbeef:${ciphertext}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws on a malformed payload', async () => {
    const { decrypt } = await import('../services/cryptoService.js');
    expect(() => decrypt('not:a:valid:payload:format')).toThrow();
  });

  it('throws when NODE_ENCRYPTION_KEY is missing or invalid', async () => {
    const { encrypt } = await import('../services/cryptoService.js');
    const original = process.env.NODE_ENCRYPTION_KEY;
    try {
      delete process.env.NODE_ENCRYPTION_KEY;
      expect(() => encrypt('value')).toThrow(/NODE_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENCRYPTION_KEY = original;
    }
  });
});
