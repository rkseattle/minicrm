/**
 * Coverage/TIA route access gate — flagged capability rollout. (MINCRM-637)
 *
 * Every coverage route used a bare `requireRole('admin')` check. This
 * introduces `Capability.CoverageAdmin` as the repo's documented preferred
 * primitive (requireRole.ts's own docblock: "Prefer requireCapability() for
 * new routes"), but does NOT remove `requireRole('admin')` yet:
 * `requireCapability` resolves via `role_capabilities`/`user_custom_roles`
 * (roleService.ts's `userCapabilities`), which only falls back to a user's
 * built-in `users.role` when they hold zero explicit custom-role
 * assignments. An admin user WITH an explicit custom-role assignment that
 * lacks `coverage:admin` would be silently 403'd by a straight swap, where
 * `requireRole('admin')` (a pure JWT-claims check) currently passes them.
 *
 * `COVERAGE_CAPABILITY_GATING=true` switches every coverage route to the
 * capability check so this can be verified against real production
 * role-assignment data before a follow-up ticket removes the `requireRole`
 * fallback entirely. Unset (the default), every route behaves exactly as
 * it does today.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { requireRole, requireCapability } from './requireRole.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

const requireRoleAdmin = requireRole('admin');
const requireCoverageAdminCapability = requireCapability(Capability.CoverageAdmin);

/**
 * Gates a coverage route on either `coverage:admin` (capability mode) or
 * `role === 'admin'` (today's default), selected by
 * `COVERAGE_CAPABILITY_GATING` at request time — not resolved once at
 * import time, so a test or an operator toggling the env var takes effect
 * without a process restart in test environments that mutate
 * `process.env` between requests.
 *
 * `requireCapability`'s own handler is async (it resolves the user's
 * capability set from the DB); this wrapper must itself return that
 * promise, not fire-and-forget it, or Express (and any caller awaiting
 * this middleware directly) would treat the request as already handled
 * before the underlying check actually completes.
 */
export const coverageAccessGate: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (process.env.COVERAGE_CAPABILITY_GATING === 'true') {
    await requireCoverageAdminCapability(req, res, next);
    return;
  }
  requireRoleAdmin(req, res, next);
};
