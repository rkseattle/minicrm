/**
 * Lead routing admin controller — request/response shaping only.
 * No business logic here; all DB access goes through leadRoutingService.
 * Covers admin-configured scoring weights/thresholds and the per-team disable toggle.
 */

import type { Request, Response } from 'express';
import {
  getLeadRoutingConfig,
  setLeadRoutingConfig,
  listTeamRoutingOverrides,
  setTeamRoutingOverride,
} from '../services/leadRoutingService.js';
import {
  setLeadRoutingConfigSchema,
  setTeamRoutingOverrideSchema,
} from '@minicrm/shared/schemas/leadRoutingSchema.js';
import { respondValidationError } from '../utils/validationError.js';
import { thrownCode } from '../utils/errorCode.js';

/** GET /api/v1/admin/ai/lead-routing-config */
export async function getLeadRoutingConfigHandler(_req: Request, res: Response): Promise<void> {
  const result = await getLeadRoutingConfig();
  res.status(200).json(result);
}

/** PATCH /api/v1/admin/ai/lead-routing-config */
export async function setLeadRoutingConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = setLeadRoutingConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const updated = await setLeadRoutingConfig(parsed.data, actor);
  res.status(200).json(updated);
}

/** GET /api/v1/admin/ai/lead-routing/team-overrides */
export async function listTeamRoutingOverridesHandler(_req: Request, res: Response): Promise<void> {
  const result = await listTeamRoutingOverrides();
  res.status(200).json({ overrides: result });
}

/** PUT /api/v1/admin/ai/lead-routing/team-overrides/:teamId */
export async function setTeamRoutingOverrideHandler(req: Request, res: Response): Promise<void> {
  const teamId = String(req.params['teamId']);
  const parsed = setTeamRoutingOverrideSchema.safeParse(req.body);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    await setTeamRoutingOverride(teamId, parsed.data.enabled, actor);
    res.status(200).json({ team_id: teamId, enabled: parsed.data.enabled });
  } catch (err) {
    if (thrownCode(err) === 'TEAM_NOT_FOUND') {
      res.status(404).json({ error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } });
      return;
    }
    throw err;
  }
}
