/**
 * Rep coaching insights controller — request/response shaping only. (MINCRM-474)
 * No business logic here; all cached-read access goes through repCoachingService.
 *
 * Access rules (enforced here, not just at the route middleware level, since
 * "manager sees only their own team" needs a per-request rep-id check that a
 * static route guard can't express):
 *   - GET /me            — any authenticated rep/manager/admin, always their own.
 *   - GET /:repId         — admin (any rep) or manager (only reps in their own
 *                           team subtree, via getRepIdsVisibleToManager).
 *   - GET /team           — admin (org-wide) or manager (their own team subtree).
 */

import type { Request, Response } from 'express';
import {
  getRepCoachingInsights,
  getCoachingTeamOverview,
  getRepIdsVisibleToManager,
  getRepCoachingConfig,
  setRepCoachingConfig,
  generateRepCoachingInsights,
} from '../services/repCoachingService.js';
import { setRepCoachingConfigSchema } from '@minicrm/shared/schemas/settingsSchema.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';

const FORBIDDEN_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have access to this rep’s coaching insights.',
  },
};

/**
 * GET /api/v1/insights/coaching/me
 * Returns the authenticated user's own cached coaching insights.
 */
export async function getMyCoachingInsightsHandler(req: Request, res: Response): Promise<void> {
  const result = await getRepCoachingInsights(req.user!.id);
  res.status(200).json(result);
}

/**
 * GET /api/v1/insights/coaching/:repId
 * Returns a specific rep's cached coaching insights. Admins may view any rep;
 * managers may only view reps within their own team subtree (or themselves).
 */
export async function getRepCoachingInsightsHandler(req: Request, res: Response): Promise<void> {
  const repId = String(req.params['repId']);
  const requestingUser = req.user!;

  if (requestingUser.role !== 'admin') {
    const visibleRepIds = await getRepIdsVisibleToManager(requestingUser.id);
    if (!visibleRepIds.includes(repId)) {
      res.status(403).json(FORBIDDEN_ERROR);
      return;
    }
  }

  const result = await getRepCoachingInsights(repId);
  res.status(200).json(result);
}

/**
 * GET /api/v1/insights/coaching/team
 * Returns a summary row per visible rep for the rep selector. Admins see all
 * reps org-wide; managers see only their own team subtree.
 */
export async function getCoachingTeamOverviewHandler(req: Request, res: Response): Promise<void> {
  const requestingUser = req.user!;

  const repIds =
    requestingUser.role === 'admin' ? null : await getRepIdsVisibleToManager(requestingUser.id);

  const result = await getCoachingTeamOverview(repIds);
  res.status(200).json(result);
}

/**
 * GET /api/v1/admin/ai/coaching-config
 * Returns the current admin-configured coaching insight thresholds.
 */
export async function getRepCoachingConfigHandler(_req: Request, res: Response): Promise<void> {
  const result = await getRepCoachingConfig();
  res.status(200).json(result);
}

/**
 * PATCH /api/v1/admin/ai/coaching-config
 * Updates the admin-configured coaching insight thresholds.
 */
export async function setRepCoachingConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = setRepCoachingConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const updated = await setRepCoachingConfig(parsed.data, actor);
  res.status(200).json(updated);
}

/**
 * POST /api/v1/admin/ai/coaching/run
 * Triggers an immediate rep coaching insight recomputation outside the
 * nightly schedule. Reuses the exact same generateRepCoachingInsights logic
 * as the cron job. Returns 202 immediately — the job is deterministic and
 * SQL-only (no AI call), typically finishing well within a request timeout,
 * but is still run fire-and-forget to match the retention/GDPR-cascade manual
 * trigger convention and keep this endpoint's response time independent of
 * org size.
 */
export async function triggerManualRepCoachingRunHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name };

  void writeAuditEntryBestEffort({
    recordType: 'ai_settings',
    recordName: 'Rep Coaching Insights Configuration',
    eventType: 'updated',
    fieldName: 'manual_run_triggered',
    newValue: 'Manual rep coaching insight recomputation triggered',
    changedById: actor.id,
    changedByName: actor.name,
  });

  generateRepCoachingInsights().catch((err: unknown) => {
    logger.error({ err }, 'repCoachingController: manual coaching insight run failed');
  });

  res.status(202).json({ accepted: true, message: 'Rep coaching insight recomputation started' });
}
