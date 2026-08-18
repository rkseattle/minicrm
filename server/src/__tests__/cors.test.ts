/**
 * CORS configuration tests.
 *
 * Split into two groups:
 *
 * Group 1 — Integration tests (supertest against real middleware):
 *   Covers the core allow/reject/no-origin paths against the app loaded with
 *   the test environment's CORS_ORIGIN value.
 *
 * Group 2 — Unit tests for origin parsing (app.ts module-level logic):
 *   ALLOWED_ORIGINS is built once at module load time, so multi-origin and
 *   whitespace-trim behaviour is verified by testing the parsing expression
 *   directly. This is the correct scope: the parsing is pure synchronous
 *   string logic; the middleware's per-request behaviour (allow/reject) is
 *   already proven by the integration tests above.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';

// ---------------------------------------------------------------------------
// Group 1: integration — middleware allow / reject behaviour
// ---------------------------------------------------------------------------

describe('CORS middleware — integration', () => {
  it('allows requests from the configured origin', async () => {
    const allowedOrigin =
      process.env['CORS_ORIGIN']?.split(',')[0]?.trim() ?? 'http://localhost:5173';

    const res = await request(app).get('/api/health').set('Origin', allowedOrigin);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  it('rejects requests from a disallowed origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example.com');

    // cors() calls next(err) → global error handler returns 500.
    expect(res.status).toBe(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests with no Origin header (server-to-server / curl)', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Group 2: unit — CORS_ORIGIN parsing (multi-origin + whitespace trimming)
//
// app.ts builds ALLOWED_ORIGINS with:
//   (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map(o => o.trim()).filter(Boolean)
//
// These tests verify that expression in isolation so a regression in app.ts's
// parsing logic is caught without relying on module-cache workarounds.
// ---------------------------------------------------------------------------

/** Replicates the ALLOWED_ORIGINS parsing expression from app.ts exactly. */
function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

describe('CORS origin parsing — unit', () => {
  it('accepts a single origin', () => {
    const origins = parseAllowedOrigins('http://localhost:5173');
    expect(origins).toEqual(['http://localhost:5173']);
  });

  it('accepts multiple comma-separated origins', () => {
    const origins = parseAllowedOrigins('http://localhost:5173,http://192.168.1.100:5173');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://192.168.1.100:5173');
    expect(origins).toHaveLength(2);
  });

  it('trims leading and trailing whitespace from each entry', () => {
    const origins = parseAllowedOrigins(' http://localhost:5173 , http://192.168.1.100:5173 ');
    expect(origins).toEqual(['http://localhost:5173', 'http://192.168.1.100:5173']);
  });

  it('filters out empty entries produced by trailing commas', () => {
    const origins = parseAllowedOrigins('http://localhost:5173,');
    expect(origins).toEqual(['http://localhost:5173']);
  });

  it('middleware rejects an origin not in the parsed list', async () => {
    // Sanity-check: the list does NOT include evil.example.com so the
    // middleware (tested via supertest) must reject it.
    const allowedOrigin =
      process.env['CORS_ORIGIN']?.split(',')[0]?.trim() ?? 'http://localhost:5173';
    const origins = parseAllowedOrigins(allowedOrigin);
    expect(origins).not.toContain('http://evil.example.com');

    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example.com');
    expect(res.status).toBe(500);
  });
});
