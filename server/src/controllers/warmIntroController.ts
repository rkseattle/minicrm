/**
 * Warm introduction path controller — request/response shaping only.
 * No business logic here; all graph traversal and AI orchestration goes through warmIntroService.
 */

import type { Request, Response } from 'express';
import { findWarmIntroPaths } from '../services/warmIntroService.js';

/**
 * GET /api/v1/contacts/:id/warm-paths
 * Returns ranked warm introduction paths to the contact through the
 * requesting rep's own contact network. No ownership check on the target
 * contact itself — the whole point is discovering paths to contacts the
 * rep does NOT yet own a relationship with. Visibility is enforced on the
 * candidate "known contact" set instead (see warmIntroService).
 */
export async function getWarmIntroPathsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const result = await findWarmIntroPaths(id, req.user!.id, req.user!.role);
  if (!result) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    return;
  }
  res.status(200).json(result);
}
