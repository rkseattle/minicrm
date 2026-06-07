/**
 * Unit tests for importJobService and the async import timing contract.
 * Verifies:
 *   1. POST /api/admin/import/:entity/run returns 202 + job_id within 500ms
 *   2. GET /api/admin/import/jobs/:id returns the current job status
 *   3. pruneOldJobs deletes rows older than 7 days and leaves recent rows intact
 * MINCRM-255
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import {
  createJob,
  getJob,
  pruneOldJobs,
  completeJob,
  updateJobProgress,
} from '../services/importJobService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'import-job';
const ADMIN_EMAIL = `${FILE_PREFIX}-admin@example.com`;

let adminId: string;
let adminCookie: string;

/** Minimal valid contacts CSV */
const CONTACTS_CSV = Buffer.from(
  'First Name,Last Name,Email\nAlice,Smith,alice.job@example.com\nBob,Jones,bob.job@example.com\n',
);

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: ADMIN_EMAIL,
    name: 'Import Job Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM contacts WHERE email IN ('alice.job@example.com','bob.job@example.com')`,
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── 1. POST /run returns 202 + job_id within 500ms ────────────────────────────

describe('POST /api/admin/import/contacts/run — async timing', () => {
  it('returns 202 with job_id within 500ms for a valid CSV', async () => {
    const mapping = JSON.stringify({
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email',
    });

    const start = Date.now();
    const res = await request(app)
      .post('/api/v1/admin/import/contacts/run')
      .set('Cookie', adminCookie)
      .field('mapping', mapping)
      .attach('file', CONTACTS_CSV, { filename: 'contacts.csv', contentType: 'text/csv' });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(typeof res.body.job_id).toBe('string');
    expect(res.body.status).toBe('pending');
    expect(elapsed).toBeLessThan(500);
  });
});

// ── 2. GET /api/admin/import/jobs/:id returns current status ──────────────────

describe('GET /api/admin/import/jobs/:job_id', () => {
  it('returns 404 for a non-existent job', async () => {
    const res = await request(app)
      .get('/api/v1/admin/import/jobs/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns the job row with all expected fields', async () => {
    const job = await createJob('contacts', 10, adminId);

    const res = await request(app)
      .get(`/api/v1/admin/import/jobs/${job.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.job_id).toBe(job.id);
    expect(res.body.type).toBe('contacts');
    expect(res.body.status).toBe('pending');
    expect(res.body.total_rows).toBe(10);
    expect(res.body.processed_rows).toBe(0);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toBe(0);
    expect(res.body.failed).toBe(0);
    expect(res.body.error_csv).toBeNull();
  });

  it('reflects progress updates written by the background runner', async () => {
    const job = await createJob('contacts', 200, adminId);
    await updateJobProgress(job.id, 100, 95, 3, 2);

    const res = await request(app)
      .get(`/api/v1/admin/import/jobs/${job.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.processed_rows).toBe(100);
    expect(res.body.created).toBe(95);
    expect(res.body.skipped).toBe(3);
    expect(res.body.failed).toBe(2);
  });

  it('reflects final counts after completeJob is called', async () => {
    const job = await createJob('accounts', 5, adminId);
    await completeJob(job.id, 4, 1, 0, '');

    const res = await request(app)
      .get(`/api/v1/admin/import/jobs/${job.id}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('complete');
    expect(res.body.created).toBe(4);
    expect(res.body.skipped).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.error_csv).toBeNull();
  });

  it('returns 403 for a rep', async () => {
    const repEmail = `${FILE_PREFIX}-rep@example.com`;
    await pool.query('DELETE FROM users WHERE email = $1', [repEmail]);
    const rep = await createUser({
      email: repEmail,
      name: 'Import Job Rep',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const repCookie = makeAuthCookie({
      id: rep.id,
      email: rep.email,
      name: rep.name,
      role: rep.role,
    });

    const job = await createJob('contacts', 5, adminId);

    const res = await request(app)
      .get(`/api/v1/admin/import/jobs/${job.id}`)
      .set('Cookie', repCookie);

    expect(res.status).toBe(403);
  });
});

// ── 3. pruneOldJobs removes stale records ─────────────────────────────────────

describe('pruneOldJobs', () => {
  it('deletes jobs older than 7 days', async () => {
    // Insert a job with created_at 8 days ago
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO import_jobs (type, created_by, created_at)
       VALUES ('contacts', $1, now() - INTERVAL '8 days')
       RETURNING id`,
      [adminId],
    );
    const staleId = rows[0].id;

    await pruneOldJobs();

    const found = await getJob(staleId);
    expect(found).toBeNull();
  });

  it('does not delete jobs newer than 7 days', async () => {
    const recentJob = await createJob('accounts', 5, adminId);

    await pruneOldJobs();

    const found = await getJob(recentJob.id);
    expect(found).not.toBeNull();
  });

  it('does not delete jobs that are exactly 6 days old', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO import_jobs (type, created_by, created_at)
       VALUES ('deals', $1, now() - INTERVAL '6 days')
       RETURNING id`,
      [adminId],
    );
    const sixDaysOldId = rows[0].id;

    await pruneOldJobs();

    const found = await getJob(sixDaysOldId);
    expect(found).not.toBeNull();
  });
});

// ── 4. FK ON DELETE SET NULL — user deletion preserves import history (MINCRM-505) ──

describe('import_jobs.created_by FK — ON DELETE SET NULL', () => {
  it('preserves import_jobs row with created_by = NULL when the owning user is deleted', async () => {
    const ephemeralUser = await createUser({
      email: `${FILE_PREFIX}-ephemeral@example.com`,
      name: 'Ephemeral Importer',
      role: 'admin',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });

    const job = await createJob('contacts', 5, ephemeralUser.id);

    // Hard-delete the user — this previously cascaded and destroyed the job row
    await pool.query('DELETE FROM users WHERE id = $1', [ephemeralUser.id]);

    const found = await getJob(job.id);
    expect(found).not.toBeNull();
    expect(found!.created_by).toBeNull();

    // Clean up the orphaned job (created_by is now NULL; explicit removal since
    // pruneOldJobs only targets rows older than 7 days)
    await pool.query('DELETE FROM import_jobs WHERE id = $1', [job.id]);
  });
});
