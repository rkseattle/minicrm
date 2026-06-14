/**
 * SCIM token controller — request/response shaping for MINCRM-541.
 * All endpoints are gated via requireCapability(IntegrationsManage) on the router.
 * No business logic or direct DB access here.
 */

import type { Request, Response } from 'express';
import { getScimTokenMeta, generateScimToken } from '../services/scimTokenService.js';

// ── SCIM token management ─────────────────────────────────────────────────────

/** GET /api/v1/scim-token */
export async function getScimTokenMetaHandler(req: Request, res: Response): Promise<void> {
  const token = await getScimTokenMeta();
  res.json({ token });
}

/**
 * POST /api/v1/scim-token
 * Returns the raw token exactly once — it is not recoverable after this response.
 */
export async function postScimTokenHandler(req: Request, res: Response): Promise<void> {
  // Safe: req.user is guaranteed by the authenticate middleware on this router.
  const actor = { id: req.user!.id, name: req.user!.name };

  const { id, rawToken, createdAt } = await generateScimToken(actor);
  res.status(201).json({ token: { id, rawToken, createdAt } });
}
