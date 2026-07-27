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

/**
 * Shared by coverageReporting.ts and coverageSessions.ts — the two routers
 * the coverage-dashboard app actually calls (MINCRM-636/637). Deliberately
 * NOT wired into coverageAccessGate itself: that would silently apply the
 * bypass to every consumer of this gate, including coveragePipeline.ts/
 * coverageMapping.ts/coverage.ts, which this dashboard never calls and
 * which this flag was never meant to open up. Each opting-in router checks
 * this explicitly and builds its own bypass chain — see coverageReporting.ts
 * for the fuller rationale on why the whole access chain (not just auth)
 * needs replacing together, not just this one predicate.
 *
 * NODE_ENV !== 'production' is the hard safety rail, same as E2E=true's own
 * precedent in auth.ts — a copied .env file can never leave this open in a
 * real deployment regardless of how COVERAGE_DASHBOARD_NO_AUTH is set.
 *
 * Read per request, not resolved once at module-load time — a boot-time-
 * only read would mean toggling this flag requires a full server restart,
 * and existing tests flip COVERAGE_CAPABILITY_GATING per-test via plain
 * process.env assignment (no app re-import); a module-scoped constant
 * would not support the same pattern for this flag.
 */
export function isDashboardNoAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.COVERAGE_DASHBOARD_NO_AUTH === 'true';
}

const requireRoleAdmin = requireRole('admin');
const requireCoverageAdminCapability = requireCapability(Capability.CoverageAdmin);

/**
 * Gates a coverage route on either `coverage:admin` (capability mode) or
 * `role === 'admin'` (today's default), selected by
 * `COVERAGE_CAPABILITY_GATING` at request time — deliberately NOT resolved
 * once at import time like every other coverage/TIA env var on this branch
 * (coveragePolicyConfig.ts, COVERAGE_INSTRUMENTATION/COVERAGE_SESSION_MANAGEMENT
 * in routes/coverage.ts and routes/coverageSessions.ts). Those all gate
 * static, deploy-time facts (route registration, retention policy) that
 * only change on a restart anyway. This flag exists specifically to let
 * this rollout be flipped and observed against real production
 * role-assignment data before the `requireRole('admin')` fallback is
 * removed in a follow-up ticket (see this file's own top docblock) — a
 * process-restart requirement to try `true` and, if the admin-with-custom-
 * role gap below bites, flip back to `false` would defeat that purpose
 * during the exact verification window this flag exists for. Once that
 * follow-up ticket removes the `requireRole` fallback, this per-request
 * read stops mattering (there will be nothing left to toggle back to).
 * Secondarily, this also lets a test control the flag per-case without a
 * full app re-import — see coverageAccessGate.test.ts's own docblock.
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
