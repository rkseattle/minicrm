/**
 * Integration tests for the coverage health control API. (MINCRM-637)
 *
 * Covers what coverageHealthService.test.ts and coverageHealthRouteGating.test.ts
 * deliberately don't: the CONTROLLER's own status-code mapping
 * (health.status === 'ok' ? 200 : 503) through a real HTTP request, not just
 * a direct call to getCoverageHealth() or an assertion that the status is
 * "200 or 503" without pinning which one. Mocks coverageDb.connect() the
 * same way health.test.ts mocks the product pool's own connect() for
 * /api/health's equivalent failure-mode tests.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import coverageDb from '../coverageDb.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'coverage-health-ctrl';

let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Health Controller Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/admin/coverage/health', () => {
  it('returns 200 with status ok when the coverage database is reachable', async () => {
    const res = await request(app).get('/api/v1/admin/coverage/health').set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(typeof res.body.agentRunning).toBe('boolean');
    expect(res.body.featureFlags).toMatchObject({
      coverage_pipeline_ingestion: expect.any(Boolean),
      coverage_mapping_query: expect.any(Boolean),
      coverage_reporting_query: expect.any(Boolean),
    });
  });

  it('returns 503 with status degraded when coverageDb.connect() throws', async () => {
    vi.spyOn(coverageDb, 'connect').mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/api/v1/admin/coverage/health').set('Cookie', adminCookie);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('error');
    expect(res.body.dbError).toBe('Connection refused');
  });

  it('returns 503 with status degraded when the SELECT 1 query throws', async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error('statement timeout')),
      release: vi.fn(),
    };
    vi.spyOn(coverageDb, 'connect').mockResolvedValue(mockClient as never);

    const res = await request(app).get('/api/v1/admin/coverage/health').set('Cookie', adminCookie);

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('error');
    expect(res.body.dbError).toBe('statement timeout');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
