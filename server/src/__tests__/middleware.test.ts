/**
 * Unit/integration tests for auth, requireRole, and asyncHandler middleware.
 * (MINCRM-295)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';
import jwt from 'jsonwebtoken';
import { vi } from 'vitest';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import { requireRole, requireCapability, requireCapabilities } from '../middleware/requireRole.js';
import { requireFeatureEnabledOrgWide } from '../middleware/requireFeatureEnabled.js';
import * as featureFlagService from '../services/featureFlagService.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import type { Request, Response, NextFunction } from 'express';

const FILE_PREFIX = 'mw';

let repCookie: string;
let repId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'MW Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── authenticate middleware ───────────────────────────────────────────────────

describe('authenticate middleware', () => {
  it('returns 401 AUTH_MISSING_TOKEN when no cookie is present', async () => {
    const res = await request(app).get('/api/v1/contacts');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_MISSING_TOKEN');
  });

  it('returns 401 AUTH_INVALID_TOKEN for a tampered token', async () => {
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', `${AUTH_COOKIE_NAME}=not.a.valid.jwt`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 401 AUTH_INVALID_TOKEN for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ id: repId, email: 'x', name: 'x', role: 'rep' }, 'wrong-secret');
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${badToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('returns 401 USER_INACTIVE when the user has been deactivated', async () => {
    const inactive = await createUser({
      email: `${FILE_PREFIX}-inactive@example.com`,
      name: 'Inactive',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'inactive',
    });
    const cookie = makeAuthCookie({
      id: inactive.id,
      email: inactive.email,
      name: inactive.name,
      role: inactive.role,
    });
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('returns 401 USER_INACTIVE for a token whose user id does not exist', async () => {
    const cookie = makeAuthCookie({
      id: '00000000-0000-0000-0000-000000000000',
      email: 'ghost@example.com',
      name: 'Ghost',
      role: 'rep',
    });
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_INACTIVE');
  });

  it('returns 403 PASSWORD_CHANGE_REQUIRED when must_change_password is set', async () => {
    const mustChange = await createUser({
      email: `${FILE_PREFIX}-mustchange@example.com`,
      name: 'Must Change',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await pool.query('UPDATE users SET must_change_password = true WHERE id = $1', [mustChange.id]);
    const cookie = makeAuthCookie({
      id: mustChange.id,
      email: mustChange.email,
      name: mustChange.name,
      role: mustChange.role,
    });
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('allows the change-password route through when must_change_password is set', async () => {
    const mustChange = await createUser({
      email: `${FILE_PREFIX}-mustchange2@example.com`,
      name: 'Must Change 2',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    await pool.query('UPDATE users SET must_change_password = true WHERE id = $1', [mustChange.id]);
    const cookie = makeAuthCookie({
      id: mustChange.id,
      email: mustChange.email,
      name: mustChange.name,
      role: mustChange.role,
    });
    // POST change-password with a bad body — we just need it to get past authenticate (not 403)
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).not.toBe(403);
  });

  it('returns 401 AUTH_INVALID_TOKEN for a token issued before a password reset', async () => {
    const user = await createUser({
      email: `${FILE_PREFIX}-pwreset@example.com`,
      name: 'PW Reset',
      role: 'rep',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    // Issue token with iat in the past (1 second before "now")
    const oldIat = Math.floor(Date.now() / 1000) - 10;
    const oldToken = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, iat: oldIat },
      process.env.JWT_SECRET ?? '',
    );
    // Simulate a password reset by setting password_changed_at to now
    await pool.query('UPDATE users SET password_changed_at = NOW() WHERE id = $1', [user.id]);
    const res = await request(app)
      .get('/api/v1/contacts')
      .set('Cookie', `${AUTH_COOKIE_NAME}=${oldToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('passes through and sets req.user for a valid active user', async () => {
    const res = await request(app).get('/api/v1/contacts').set('Cookie', repCookie);
    // Contacts list returns 200 — authenticate passed control to the handler
    expect(res.status).toBe(200);
  });
});

// ── requireRole middleware ────────────────────────────────────────────────────

describe('requireRole middleware', () => {
  it('returns 403 AUTH_FORBIDDEN when a rep hits an admin-only route', async () => {
    const res = await request(app).get('/api/v1/admin/webhooks').set('Cookie', repCookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('allows an admin through an admin-only route', async () => {
    const admin = await createUser({
      email: `${FILE_PREFIX}-admin@example.com`,
      name: 'MW Admin',
      role: 'admin',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const adminCookie = makeAuthCookie({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    });
    const res = await request(app).get('/api/v1/admin/webhooks').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
  });
});

// ── requireRole — unauthenticated path ────────────────────────────────────────
// These unit tests call the middleware directly to cover branches that cannot be
// reached through the normal request flow (authenticate always runs first).

describe('requireRole — called without req.user', () => {
  it('returns 401 AUTH_MISSING_TOKEN when req.user is not set (MINCRM-533)', () => {
    const middleware = requireRole('admin');
    const req = { user: undefined } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'AUTH_MISSING_TOKEN' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

// ── requireCapability — service account blocking ──────────────────────────────

describe('requireCapability — service account UI blocking (MINCRM-542)', () => {
  it('returns 403 SERVICE_ACCOUNT_UI_BLOCKED when a service_account requests a non-api:access capability', async () => {
    const middleware = requireCapability(Capability.ContactsView);
    const req = { user: { id: 'test-id', role: 'service_account' } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, locals: {} } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'SERVICE_ACCOUNT_UI_BLOCKED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is undefined', async () => {
    const middleware = requireCapability(Capability.ContactsView);
    const req = { user: undefined } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, locals: {} } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── requireCapabilities — multi-capability AND gate ───────────────────────────

describe('requireCapabilities (MINCRM-542)', () => {
  it('returns 401 when req.user is undefined', async () => {
    const middleware = requireCapabilities(Capability.ContactsView, Capability.DealsView);
    const req = { user: undefined } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, locals: {} } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 SERVICE_ACCOUNT_UI_BLOCKED for service_account without bearer auth', async () => {
    const middleware = requireCapabilities(Capability.ContactsView);
    const req = { user: { id: 'sa-id', role: 'service_account' } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, locals: {} } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'SERVICE_ACCOUNT_UI_BLOCKED' }),
      }),
    );
  });

  it('calls next() when user has all required capabilities', async () => {
    // repId is a real user with contacts:view and deals:view in the test DB
    const middleware = requireCapabilities(Capability.ContactsView, Capability.DealsView);
    const req = { user: { id: repId, role: 'rep' } } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    const res = { locals: {} } as unknown as Response;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('returns 403 AUTH_FORBIDDEN when user is missing one capability', async () => {
    // repId does not have settings:manage
    const middleware = requireCapabilities(Capability.ContactsView, Capability.SettingsManage);
    const req = { user: { id: repId, role: 'rep' } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, locals: {} } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'AUTH_FORBIDDEN' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the per-request cache when res.locals.capabilities is already set', async () => {
    const middleware = requireCapabilities(Capability.ContactsView);
    const req = { user: { id: repId, role: 'rep' } } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;
    // Pre-populate the cache
    const cachedCaps = new Set([Capability.ContactsView]);
    const res = { locals: { capabilities: cachedCaps } } as unknown as Response;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ── asyncHandler middleware ───────────────────────────────────────────────────

describe('asyncHandler middleware', () => {
  it('forwards an unhandled async error to the Express error handler (500)', async () => {
    // Trigger a route that throws — passing a non-UUID to a :id param causes the
    // service to throw a DB error that asyncHandler forwards to the error handler.
    const res = await request(app).get('/api/v1/contacts/not-a-uuid').set('Cookie', repCookie);
    expect(res.status).toBe(500);
  });
});

// ── requireFeatureEnabledOrgWide (MINCRM-694) ─────────────────────────────────

describe('requireFeatureEnabledOrgWide', () => {
  /**
   * Exercised directly rather than through a route: these assertions are about
   * the middleware's own three branches, and the two coverage routers that use
   * it already cover the integrated path in their own controller specs.
   *
   * The flag store is stubbed per case so the org-wide check can be driven to
   * each outcome — including the throw, which no route test can reach without
   * breaking the database out from under the whole suite.
   */
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function invoke(): {
    req: Request;
    res: Response;
    next: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  } {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      // No `user` at all — the whole point of this middleware is that it runs
      // on a path where authenticate never populated one.
      req: {} as unknown as Request,
      res: { status } as unknown as Response,
      next: vi.fn(),
      status,
      json,
    };
  }

  it('calls next() when the flag is enabled org-wide', async () => {
    vi.spyOn(featureFlagService, 'isFeatureEnabled').mockResolvedValue(true);
    const { req, res, next, status } = invoke();

    await requireFeatureEnabledOrgWide('coverage_mapping_query')(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 403 FEATURE_DISABLED when the flag is disabled org-wide', async () => {
    vi.spyOn(featureFlagService, 'isFeatureEnabled').mockResolvedValue(false);
    const { req, res, next, status, json } = invoke();

    await requireFeatureEnabledOrgWide('coverage_mapping_query')(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FEATURE_DISABLED' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a flag-store failure to the error handler rather than failing open', async () => {
    // Failing open here would silently re-create the defect this middleware
    // exists to fix: a route that answers 200 regardless of the flag.
    const boom = new Error('flag store unreachable');
    vi.spyOn(featureFlagService, 'isFeatureEnabled').mockRejectedValue(boom);
    const { req, res, next, status } = invoke();

    await requireFeatureEnabledOrgWide('coverage_mapping_query')(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(status).not.toHaveBeenCalled();
  });

  it('does not consult the user-scoped resolver, which needs a req.user this path lacks', async () => {
    const orgWide = vi.spyOn(featureFlagService, 'isFeatureEnabled').mockResolvedValue(true);
    const perUser = vi.spyOn(featureFlagService, 'isFlagEnabledForUser');
    const { req, res, next } = invoke();

    await requireFeatureEnabledOrgWide('coverage_mapping_query')(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(orgWide).toHaveBeenCalledWith('coverage_mapping_query');
    expect(perUser).not.toHaveBeenCalled();
  });
});
