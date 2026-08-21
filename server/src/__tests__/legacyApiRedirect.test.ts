/**
 * Tests for the /api/<resource> → /api/v1/<resource> backward-compat redirects.
 *
 * The status code carries the behaviour: a 301 lets a client rewrite the request to GET
 * and drop the body, so a legacy POST or PATCH would arrive empty. Nothing else in the
 * suite would notice that regression.
 *
 * None of this needs a session: the redirect handler answers from `app.use(prefix, ...)`
 * and never delegates to a router, so no route-level auth middleware runs.
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import app, { LEGACY_REDIRECT_STATUS } from '../app.js';

describe('legacy /api → /api/v1 redirects', () => {
  it('redirects a legacy GET with 308, not 301', async () => {
    const res = await request(app).get('/api/contacts');
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/v1/contacts');
  });

  it('preserves the path suffix and query string', async () => {
    const res = await request(app).get('/api/deals/abc-123?page=2&limit=10');
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/v1/deals/abc-123?page=2&limit=10');
  });

  it('redirects a POST with 308 so the client may replay method and body', async () => {
    const res = await request(app).post('/api/contacts').send({ first_name: 'Ada' });
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/v1/contacts');
  });

  it('redirects a PATCH with 308', async () => {
    const res = await request(app).patch('/api/deals/abc-123').send({ title: 'Renewal' });
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/v1/deals/abc-123');
  });

  // The router mounts at /api/v1/automation/rules, so the suffixed legacy path resolves
  // and the bare prefix does not — it redirects to /api/v1/automation, which is nothing.
  it('redirects a suffixed legacy automation path to a mounted route', async () => {
    const res = await request(app).get('/api/automation/rules');
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/v1/automation/rules');

    const followed = await request(app).get(res.headers['location'] as string);
    expect(followed.status).toBe(401);
  });

  // The bare prefix redirects to /api/v1/automation, which no router serves. It answers
  // 401 rather than 404 because a router mounted at the bare /api/v1 prefix runs its
  // auth check before the not-found handler — so 401 here is not evidence of a route.
  it('redirects the bare legacy automation prefix to an unrouted path', async () => {
    const res = await request(app).get('/api/automation');
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/v1/automation');

    const followed = await request(app).get(res.headers['location'] as string);
    expect(followed.status).toBe(401);
  });

  it('leaves an already-versioned path alone', async () => {
    const res = await request(app).get('/api/v1/contacts');
    expect(res.status).toBe(401);
  });

  it('does not redirect a path outside the legacy prefix list', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(404);
    expect(res.headers['location']).toBeUndefined();
  });

  it('leaves the unversioned health endpoint alone', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  // Editing a doc to name a different status matches only the `docs` paths filter, which
  // runs no server test, so the pin has to live beside the constant. Both files name the
  // status exactly once as `<code> Permanent Redirect`; each also mentions 301 while
  // explaining why it was rejected, so the check is that no OTHER code takes that form.
  it.each(['docs/api.md', 'docs/operations.md'])('%s states the same status', (relative) => {
    const doc = readFileSync(join(__dirname, '../../..', relative), 'utf8');
    const stated = [...doc.matchAll(/(\d{3}) Permanent Redirect/g)].map((m) => Number(m[1]));
    expect(stated).not.toHaveLength(0);
    expect([...new Set(stated)]).toEqual([LEGACY_REDIRECT_STATUS]);
  });
});
