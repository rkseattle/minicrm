/**
 * Unit tests for GET /api/health deep database connectivity check.
 *
 * The pool is mocked so these tests do not require a live database connection.
 * Each test verifies the response shape and status code for a distinct failure mode.
 */

import 'dotenv/config';
import { vi, describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import pool from '../db.js';
import app from '../app.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/health', () => {
  it('returns 200 with { status: ok, db: ok } when the database is reachable', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    vi.spyOn(pool, 'connect').mockResolvedValue(mockClient as never);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    // client must be released regardless of outcome
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('returns 503 with { status: degraded, db: error } when pool.connect() throws (pool exhaustion / connection refused)', async () => {
    vi.spyOn(pool, 'connect').mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('error');
    expect(res.body.db_error).toBe('Connection refused');
    expect(typeof res.body.uptime_seconds).toBe('number');
    // 503 body must not expose internals
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('code');
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(JSON.stringify(res.body)).not.toContain('pg://');
  });

  it('returns 503 and releases the client when the SELECT 1 query throws', async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error('statement timeout')),
      release: vi.fn(),
    };
    vi.spyOn(pool, 'connect').mockResolvedValue(mockClient as never);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('error');
    expect(res.body.db_error).toBe('statement timeout');
    expect(typeof res.body.uptime_seconds).toBe('number');
    // finally block must release the client — no connection leak
    expect(mockClient.release).toHaveBeenCalledOnce();
    // 503 body must not expose internals
    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});
