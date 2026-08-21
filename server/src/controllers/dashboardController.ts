/**
 * Dashboard controller — request/response shaping for dashboard endpoints.
 * No business logic here; all DB access goes through dashboardService.
 */

import type { Request, Response } from 'express';
import { getDashboardSummary } from '../services/dashboardService.js';

/**
 * GET /api/v1/dashboard/summary
 * Returns the dashboard summary metrics for the current user.
 * Admins receive team-wide data; reps receive their own data only.
 */
export async function getDashboardSummaryHandler(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'admin';
  // Pass null for admins (team-wide), or the user's own id for reps
  const ownerId = isAdmin ? null : req.user!.id;
  const summary = await getDashboardSummary(ownerId);
  res.status(200).json(summary);
}
