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
import { authenticate } from './auth.js';
import { requireFeatureEnabled, requireFeatureEnabledOrgWide } from './requireFeatureEnabled.js';
import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

/**
 * Shared by the three routers the coverage-dashboard app actually calls
 * (MINCRM-636/637): coverageReporting.ts, coverageSessions.ts, and
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
 * contradiction is what MINCRM-694's investigation ran into, since both
 * routers point readers here for the rationale.
 *
 * What the bypass replaces: authenticate and coverageAccessGate. It does NOT
 * drop the feature-flag check — that narrows to requireFeatureEnabledOrgWide
 * (MINCRM-694), which evaluates the flag's org-wide `enabled` column without
 * the user-scoped targeting rules that need a req.user this path lacks.
 * Dropping the check entirely, as these routers originally did, meant the flag
 * read as enabled no matter what was stored. See coverageReporting.ts for the
 * fuller rationale.
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

/**
 * Builds the full access chain a dashboard-facing coverage router needs, in one
 * place. (MINCRM-694)
 *
 * Extracted because coverageReporting.ts, coverageMapping.ts, and
 * coverageSessions.ts each held a hand-written copy of the same nested
 * callback chain, and MINCRM-694 had to edit two of the three identically —
 * which is exactly the duplication that let one copy drift from the other in
 * the first place. A third copy is one more place for the next fix to miss.
 *
 * Normal path: authenticate → coverageAccessGate → the flag check.
 * COVERAGE_DASHBOARD_NO_AUTH path: the org-wide flag check ONLY. Auth and the
 * role/capability gate are what the flag deliberately drops; the feature flag
 * is not, because its org-wide `enabled` column needs no identity to evaluate
 * and is the kill switch the flag exists to provide.
 *
 * @param flagKey - The feature flag gating this router, or null for a router
 *   with no feature_flags row (coverageSessions.ts, gated wholesale by
 *   COVERAGE_SESSION_MANAGEMENT at boot). Null means no flag step on either
 *   path — not "skip the flag on the bypass", which was the original defect.
 *
 *   Typed as a union rather than a bare string so a mistyped key is a compile
 *   error. Otherwise it would surface only at runtime, as isFeatureEnabled's
 *   "unknown flag key — treating as disabled" path silently 403ing an entire
 *   router.
 */
export type CoverageRouterFlagKey = 'coverage_mapping_query' | 'coverage_reporting_query';

export function buildCoverageAccessGate(flagKey: CoverageRouterFlagKey | null): RequestHandler {
  const requireFlagForUser = flagKey === null ? null : requireFeatureEnabled(flagKey);
  const requireFlagOrgWide = flagKey === null ? null : requireFeatureEnabledOrgWide(flagKey);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDashboardNoAuthEnabled()) {
      if (requireFlagOrgWide) {
        requireFlagOrgWide(req, res, next);
      } else {
        next();
      }
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
      Promise.resolve(
        coverageAccessGate(req, res, (gateErr?: unknown) => {
          if (gateErr) {
            next(gateErr);
            return;
          }
          if (requireFlagForUser) {
            requireFlagForUser(req, res, next);
          } else {
            next();
          }
        }),
      ).catch(next);
    });
  };
}
