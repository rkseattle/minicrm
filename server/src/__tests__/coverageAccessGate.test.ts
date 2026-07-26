/**
 * Unit tests for coverageAccessGate (MINCRM-637).
 *
 * Calls the middleware directly with mocked Request/Response/next, same
 * pattern as middleware.test.ts's own requireRole/requireCapability tests
 * — this lets each test control COVERAGE_CAPABILITY_GATING per-case without
 * a full app re-import (unlike coverageRouteGating.test.ts's module-load-time
 * env var, this one is read per-request, so no vi.resetModules() dance is
 * needed).
 */

import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { coverageAccessGate } from '../middleware/coverageAccessGate.js';
import { createUser } from '../services/userService.js';
import { assignRoleToUser, createCustomRole } from '../services/roleService.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';
import pool from '../db.js';

const FILE_PREFIX = 'coverage-access-gate';
const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let adminId: string;
let repId: string;
let adminWithCustomRoleId: string;
let serviceAccountWithCoverageAdminId: string;

function mockReqResNext(user: unknown): {
  req: Request;
  res: Response;
  next: NextFunction;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, locals: {} } as unknown as Response;
  const req = { user } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next, status, json };
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Coverage Access Gate Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Coverage Access Gate Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;

  // An admin-role user who ALSO holds an explicit custom-role assignment
  // with NO coverage:admin grant — the exact case coverageAccessGate's own
  // docblock names as the reason COVERAGE_CAPABILITY_GATING exists.
  // userCapabilities() resolves via an INNER JOIN of user_custom_roles to
  // role_capabilities, falling back to the built-in-role join only when
  // that join returns ZERO ROWS — a custom role with literally zero
  // capabilities would produce zero join rows and therefore ALSO fall back
  // to the built-in role, indistinguishable from having no custom role at
  // all. The role below is given one unrelated real capability
  // (ContactsView) specifically so the join returns a non-empty row set
  // and the fallback never fires — this user's coverage:admin resolution
  // genuinely comes from this custom role alone, not from their admin role.
  const adminWithCustomRole = await createUser({
    email: `${FILE_PREFIX}-admin-custom@example.com`,
    name: 'Coverage Access Gate Admin (Custom Role)',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminWithCustomRoleId = adminWithCustomRole.id;
  const customRole = await createCustomRole(
    {
      name: `${FILE_PREFIX}-limited-role-${adminWithCustomRole.id}`,
      capabilities: [Capability.ContactsView],
    },
    SYSTEM_ACTOR,
  );
  await assignRoleToUser(adminWithCustomRoleId, customRole.id, SYSTEM_ACTOR);

  // A service_account user whose custom role DOES carry coverage:admin —
  // for the accepted-intentional-widening test: a bearer-authenticated
  // service account with this grant gains access under capability mode
  // that requireRole('admin') would never have given it (service_account
  // never satisfies role === 'admin').
  const serviceAccountWithCoverageAdmin = await createUser({
    email: `${FILE_PREFIX}-sa-coverage-admin@example.com`,
    name: 'Coverage Access Gate Service Account',
    role: 'service_account',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  serviceAccountWithCoverageAdminId = serviceAccountWithCoverageAdmin.id;
  const coverageAdminRole = await createCustomRole(
    {
      name: `${FILE_PREFIX}-sa-coverage-admin-role-${serviceAccountWithCoverageAdmin.id}`,
      capabilities: [Capability.CoverageAdmin],
    },
    SYSTEM_ACTOR,
  );
  await assignRoleToUser(serviceAccountWithCoverageAdminId, coverageAdminRole.id, SYSTEM_ACTOR);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM custom_roles WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('coverageAccessGate — COVERAGE_CAPABILITY_GATING unset (default)', () => {
  const originalGating = process.env.COVERAGE_CAPABILITY_GATING;

  beforeEach(() => {
    delete process.env.COVERAGE_CAPABILITY_GATING;
  });

  afterAll(() => {
    if (originalGating !== undefined) process.env.COVERAGE_CAPABILITY_GATING = originalGating;
  });

  it('behaves exactly like requireRole(admin) — calls next() for an admin-role user', () => {
    const { req, res, next } = mockReqResNext({ id: adminId, role: 'admin' });
    coverageAccessGate(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('behaves exactly like requireRole(admin) — 403s a non-admin-role user', () => {
    const { req, res, next, status, json } = mockReqResNext({ id: repId, role: 'rep' });
    coverageAccessGate(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'AUTH_FORBIDDEN' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("grants access to an admin-role user even when their custom role lacks coverage:admin — today's exact behavior, unaffected by the capability gap", () => {
    const { req, res, next } = mockReqResNext({ id: adminWithCustomRoleId, role: 'admin' });
    coverageAccessGate(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('401s when req.user is undefined', () => {
    const { req, res, next, status } = mockReqResNext(undefined);
    coverageAccessGate(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('coverageAccessGate — COVERAGE_CAPABILITY_GATING=true', () => {
  const originalGating = process.env.COVERAGE_CAPABILITY_GATING;

  beforeEach(() => {
    process.env.COVERAGE_CAPABILITY_GATING = 'true';
  });

  afterAll(() => {
    if (originalGating !== undefined) {
      process.env.COVERAGE_CAPABILITY_GATING = originalGating;
    } else {
      delete process.env.COVERAGE_CAPABILITY_GATING;
    }
  });

  it('grants access to the built-in admin role via the coverage:admin capability (migration 162)', async () => {
    const { req, res, next } = mockReqResNext({ id: adminId, role: 'admin' });
    await coverageAccessGate(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('403s a non-admin-role user with no coverage:admin capability', async () => {
    const { req, res, next, status, json } = mockReqResNext({ id: repId, role: 'rep' });
    await coverageAccessGate(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'AUTH_FORBIDDEN' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('the known, accepted gap: 403s an admin-role user whose custom-role assignment lacks coverage:admin — exactly why this rollout stays flagged until production role data is checked', async () => {
    const { req, res, next, status, json } = mockReqResNext({
      id: adminWithCustomRoleId,
      role: 'admin',
    });
    await coverageAccessGate(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'AUTH_FORBIDDEN' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when req.user is undefined', async () => {
    const { req, res, next, status } = mockReqResNext(undefined);
    await coverageAccessGate(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepted intentional widening: a cookie-authenticated service_account gets SERVICE_ACCOUNT_UI_BLOCKED under capability mode, where requireRole(admin) would have returned a plain AUTH_FORBIDDEN', async () => {
    const { req, res, next, status, json } = mockReqResNext({
      id: 'sa-cookie-id',
      role: 'service_account',
    });
    await coverageAccessGate(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'SERVICE_ACCOUNT_UI_BLOCKED' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('accepted intentional widening: a bearer-authenticated service_account with coverage:admin via a custom role gains access — never possible under requireRole(admin), which service_account can never satisfy', async () => {
    const { req, res, next } = mockReqResNext({
      id: serviceAccountWithCoverageAdminId,
      role: 'service_account',
      authMethod: 'bearer',
    });
    await coverageAccessGate(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('migration 162 — coverage:admin capability grant scope', () => {
  it('grants coverage:admin to the built-in admin role only, not rep/manager/viewer/service_account', async () => {
    const result = await pool.query<{ name: string }>(
      `SELECT cr.name
       FROM public.role_capabilities rc
       JOIN public.custom_roles cr ON cr.id = rc.role_id
       WHERE rc.capability = 'coverage:admin' AND cr.is_builtin = true`,
    );
    const builtinRoleNames = result.rows.map((r) => r.name);
    expect(builtinRoleNames).toEqual(['admin']);
  });
});
