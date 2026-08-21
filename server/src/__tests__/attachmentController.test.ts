/**
 * HTTP contract tests for attachmentController.
 * Tests listAttachments, uploadAttachment (storage-not-configured path), and deleteAttachment.
 * Attachment rows for list/delete tests are inserted directly into the DB (same pattern as
 * attachmentService.test.ts) to avoid requiring a live storage service.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const UPLOADER_EMAIL = 'uploader-attach-ctrl@example.com';
const OTHER_REP_EMAIL = 'other-rep-attach-ctrl@example.com';
const ADMIN_EMAIL = 'admin-attach-ctrl@example.com';

let uploaderId: string;
let uploaderCookie: string;
let otherRepCookie: string;
let _adminCookie: string;
let contactId: string;

beforeAll(async () => {
  await pool.query(
    "DELETE FROM attachments WHERE uploader_id IN (SELECT id FROM users WHERE email LIKE '%-attach-ctrl@example.com')",
  );
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%-attach-ctrl@example.com')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE '%-attach-ctrl@example.com'");

  const uploader = await createUser({
    email: UPLOADER_EMAIL,
    name: 'Attach Uploader',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  uploaderId = uploader.id;
  uploaderCookie = makeAuthCookie({
    id: uploader.id,
    email: uploader.email,
    name: uploader.name,
    role: uploader.role,
  });

  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Attach Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    name: otherRep.name,
    role: otherRep.role,
  });

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Attach Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  _adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const contact = await createContact({
    first_name: 'Attach',
    last_name: 'Test',
    email: `attach-test-ctrl-${Date.now()}@example.com`,
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

afterAll(async () => {
  await pool.query(
    "DELETE FROM attachments WHERE uploader_id IN (SELECT id FROM users WHERE email LIKE '%-attach-ctrl@example.com')",
  );
  await pool.query(
    "DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%-attach-ctrl@example.com')",
  );
  await pool.query("DELETE FROM users WHERE email LIKE '%-attach-ctrl@example.com'");
});

/**
 * Inserts an attachment row directly into the DB, bypassing storage I/O.
 * Mirrors the pattern from attachmentService.test.ts.
 *
 * @param opts - Partial attachment fields; defaults to small PDF on contactId.
 */
async function insertAttachment(opts: {
  uploaderId?: string;
  filename?: string;
  fileSize?: number;
}): Promise<string> {
  const { uploaderId: uid = uploaderId, filename = 'test.pdf', fileSize = 1024 } = opts;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO attachments
       (record_type, record_id, filename, file_size, mime_type, storage_key, uploader_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    ['contact', contactId, filename, fileSize, 'application/pdf', `test-key/${filename}`, uid],
  );
  return result.rows[0].id;
}

// ── GET /api/v1/attachments ──────────────────────────────────────────────────────

describe('GET /api/v1/attachments', () => {
  it('returns an attachments array for a record with no uploads', async () => {
    const res = await request(app)
      .get(`/api/v1/attachments?recordType=contact&recordId=${contactId}`)
      .set('Cookie', uploaderCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.attachments)).toBe(true);
    expect(res.body.attachments).toHaveLength(0);
  });

  it('returns uploaded attachments for a record', async () => {
    await insertAttachment({ filename: 'doc1.pdf' });
    await insertAttachment({ filename: 'doc2.pdf' });

    const res = await request(app)
      .get(`/api/v1/attachments?recordType=contact&recordId=${contactId}`)
      .set('Cookie', uploaderCookie);

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(2);
    // Attachments are returned newest-first; verify shape of the first entry
    expect(res.body.attachments[0].filename).toBe('doc2.pdf');
    expect(res.body.attachments[0].file_size).toBe(1024);
    expect(res.body.attachments[0].mime_type).toBe('application/pdf');
  });

  it('returns 400 when recordType is invalid', async () => {
    const res = await request(app)
      .get(`/api/v1/attachments?recordType=invoice&recordId=${contactId}`)
      .set('Cookie', uploaderCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('lead');
  });

  it('accepts lead as a valid recordType for GET', async () => {
    const leadResult = await pool.query<{ id: string }>(
      `INSERT INTO leads (first_name, email, status, owner_id)
       VALUES ('Lead', 'attach-ctrl-lead@example.com', 'New', $1) RETURNING id`,
      [uploaderId],
    );
    const leadId = leadResult.rows[0]!.id;
    const res = await request(app)
      .get(`/api/v1/attachments?recordType=lead&recordId=${leadId}`)
      .set('Cookie', uploaderCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.attachments)).toBe(true);

    await pool.query('DELETE FROM leads WHERE id = $1', [leadId]);
  });

  it('returns 400 when recordId is missing', async () => {
    const res = await request(app)
      .get('/api/v1/attachments?recordType=contact')
      .set('Cookie', uploaderCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(
      `/api/v1/attachments?recordType=contact&recordId=${contactId}`,
    );

    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/attachments ─────────────────────────────────────────────────────

describe('POST /api/v1/attachments', () => {
  it('returns 503 STORAGE_NOT_CONFIGURED when storage is not set up', async () => {
    // The test database has no storage config — upload will hit the STORAGE_NOT_CONFIGURED branch
    const res = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', uploaderCookie)
      .field('recordType', 'contact')
      .field('recordId', contactId)
      .attach('file', Buffer.from('%PDF-1.4 minimal'), {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('returns 400 when no file is provided', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', uploaderCookie)
      .field('recordType', 'contact')
      .field('recordId', contactId);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when recordType is invalid', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', uploaderCookie)
      .field('recordType', 'invoice')
      .field('recordId', contactId)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when MIME type is not allowed', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .set('Cookie', uploaderCookie)
      .field('recordType', 'contact')
      .field('recordId', contactId)
      .attach('file', Buffer.from('<html>hi</html>'), {
        filename: 'test.html',
        contentType: 'text/html',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/attachments')
      .field('recordType', 'contact')
      .field('recordId', contactId)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/v1/attachments/:id ───────────────────────────────────────────────
//
// NOTE: The deleteAttachment service deletes the DB row then calls deleteObject()
// on the storage key. In test the storage backend is not configured, so a successful
// ownership check will reach the storage call and raise STORAGE_NOT_CONFIGURED.
// The tests below cover the auth/guard paths that are resolved before any storage
// I/O; the happy-path 204 requires a live storage backend and is covered in E2E.

describe('DELETE /api/v1/attachments/:id', () => {
  it('returns 403 when a non-uploader rep attempts to delete', async () => {
    const attachmentId = await insertAttachment({ uploaderId, filename: 'protected.pdf' });

    const res = await request(app)
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set('Cookie', otherRepCookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when the attachment does not exist', async () => {
    const res = await request(app)
      .delete('/api/v1/attachments/00000000-0000-0000-0000-000000000000')
      .set('Cookie', uploaderCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 401 when unauthenticated', async () => {
    const attachmentId = await insertAttachment({ uploaderId, filename: 'unauth.pdf' });

    const res = await request(app).delete(`/api/v1/attachments/${attachmentId}`);

    expect(res.status).toBe(401);
  });
});
