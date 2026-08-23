/**
 * Coverage/TIA route access gate — flagged capability rollout.
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
import { isAuthBypassEnv } from '../utils/nodeEnv.js';
import { requireRole, requireCapability } from './requireRole.js';
import { authenticate } from './auth.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

/**
 * Shared by the three routers the coverage-dashboard app actually calls
 * coverageReporting.ts, coverageSessions.ts, and
 * coverageMapping.ts — the last backing the Traceability tab's drill-down and
 * typeahead. Deliberately NOT wired into coverageAccessGate itself: that would
 * silently apply the bypass to every consumer of this gate, including
 * coveragePipeline.ts and coverage.ts, which this dashboard never calls and
 * which this flag was never meant to open up. Each opting-in router checks
 * this explicitly and builds its own bypass chain.
 *
 * An earlier version of this docblock named only two routers and claimed
 * coverageMapping.ts was among those the flag "was never meant to open up".
 * That was already untrue when written — that router opted in — and the
 * contradiction is what the investigation ran into, since both
 * routers point readers here for the rationale.
 *
 * What the bypass replaces: authenticate and coverageAccessGate — which since
 * is the whole chain, because there is no feature-flag step left to
 * keep. An earlier change had narrowed that step to requireFeatureEnabledOrgWide
 * rather than dropping it, since the flag's org-wide `enabled` column was the
 * last gate on an unauthenticated request here. Each of these routers is now
 * gated wholesale by its own boot-time env var instead: unset means the routes
 * were never registered, so no request reaches this gate at all. Harder by
 * default than the flag it replaces, at the cost of no longer being flippable
 * without a restart. See coverageReporting.ts for the fuller rationale.
 *
 * A development or test NODE_ENV is the hard safety rail, same as E2E=true's own
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
  return isAuthBypassEnv() && process.env.COVERAGE_DASHBOARD_NO_AUTH === 'true';
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

/**
 * Builds the full access chain a dashboard-facing coverage router needs, in one
 * place.
 *
 * Extracted because coverageReporting.ts, coverageMapping.ts, and
 * coverageSessions.ts each held a hand-written copy of the same nested
 * callback chain, and that change had to edit two of the three identically —
 * which is exactly the duplication that let one copy drift from the other in
 * the first place. A third copy is one more place for the next fix to miss.
 *
 * Normal path: authenticate → coverageAccessGate.
 * COVERAGE_DASHBOARD_NO_AUTH path: neither. Dropping the CRM login is the whole
 * point of that flag, and after a later change there is no feature-flag step left
 * behind it, so on that path these routers run entirely ungated per request.
 *
 * Be precise about what that exposes, because "internal read-only reporting" is
 * only true of two of the three opted-in routers. coverageReporting.ts and
 * coverageMapping.ts are read-only. coverageSessions.ts is NOT — it exposes
 * POST /sessions, POST /:sessionId/end, and POST /:sessionId/dumps, so under
 * the bypass those writes are unauthenticated.
 *
 * That is PRE-EXISTING, not introduced here. That change passed `null`
 * as this router's flag key precisely because it had no feature_flags row, and
 * a null key already meant no check on either path — verified against main
 * before this branch: buildCoverageAccessGate(null) called next() with no
 * arguments for an unauthenticated request. What that change changed is that the
 * OTHER two routers now behave the same way, having lost the org-wide flag
 * check that was their last per-request gate.
 *
 * Accepted for the same reasons the rest of the bypass is: isDashboardNoAuthEnabled
 * requires a non-production NODE_ENV, each router only registers at all when its
 * own boot-time env var is set, and the data behind them is CI/dev coverage
 * output rather than product data. Called out explicitly so the next reader does
 * not infer a read-only guarantee this gate does not provide — and so that
 * anyone tightening it knows the sessions router is where the write surface is.
 *
 * removed this builder's feature-flag step, along with the
 * `flagKey` parameter and the `CoverageRouterFlagKey` union that typed it.
 * Every coverage router is now gated wholesale by its own boot-time env var
 * (COVERAGE_MAPPING_QUERY / COVERAGE_REPORTING_QUERY / COVERAGE_SESSION_MANAGEMENT),
 * so there is no feature_flags row left for any of them to enforce — the three
 * that had one were deleted as internal CI/dev tooling that had no business
 * being toggleable from the product's own admin Settings page.
 *
 * That retires the org-wide narrowing, which existed because the flag
 * was the last gate on an unauthenticated no-auth-mode request. The env var
 * replaces it: unset means the routes were never registered, so nothing
 * reaches this middleware at all, where the flag was a mutable row an admin
 * could flip from the product UI. Harder by default, at the cost of needing a
 * restart to change. requireFeatureEnabled/requireFeatureEnabledOrgWide are both
 * untouched and still used by (respectively) the product's own flagged routes
 * and their own unit tests.
 */
export function buildCoverageAccessGate(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDashboardNoAuthEnabled()) {
      next();
      return;
    }

    authenticate(req, res, (authErr?: unknown) => {
      if (authErr) {
        next(authErr);
        return;
      }
      // .catch(next), not a bare void: coverageAccessGate is async (it awaits
      // requireCapability's DB lookup — see its own docblock), and the
      // per-router copies this replaced called it from a context that could
      // not propagate the promise either. Discarding it would turn a rejected
      // capability lookup into an unhandled rejection instead of a 500 through
      // Express's error handler.
      Promise.resolve(coverageAccessGate(req, res, next)).catch(next);
    });
  };
}
