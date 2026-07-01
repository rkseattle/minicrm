/**
 * AI retention controller — request/response shaping for /api/v1/admin/ai/retention-*.
 * No business logic or database access here — delegates entirely to retentionService.
 * (MINCRM-462)
 */

import type { Request, Response } from 'express';
import { purgeAiSessions, getAiSessionRetentionStats } from '../services/retentionService.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';

export async function getAiSessionRetentionStatsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const stats = await getAiSessionRetentionStats();
  res.status(200).json({ session_count: stats.sessionCount, message_count: stats.messageCount });
}

/**
 * POST /api/v1/admin/ai/retention/purge — triggers an immediate AI session purge
 * outside the nightly schedule. Reuses the exact same purgeAiSessions logic (and
 * its own "purge result" audit entry) as the cron job.
 *
 * Writes a separate audit entry for the trigger itself, distinct from the one
 * purgeAiSessions writes for the result, so "who clicked purge now" is
 * traceable independently of "the purge completed and removed N sessions".
 *
 * Returns 202 immediately — the purge runs asynchronously, matching the
 * fire-and-forget pattern used by the GDPR AI cascade manual trigger.
 */
export async function triggerManualAiPurgeHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate guarantees req.user

  void writeAuditEntryBestEffort({
    recordType: 'ai_settings',
    recordName: 'AI Configuration',
    eventType: 'updated',
    fieldName: 'manual_purge_triggered',
    newValue: 'Manual AI session purge triggered',
    changedById: actor.id,
    changedByName: actor.name,
  });

  void purgeAiSessions();

  res.status(202).json({ accepted: true, message: 'AI session purge started' });
}
