/**
 * Proposal draft controller — request/response shaping only. (MINCRM-473)
 * No business logic or document generation here; all AI orchestration, DOCX
 * generation, and DB access goes through proposalDraftService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { findDealById } from '../services/dealService.js';
import {
  generateProposalDraft,
  exportProposalDraftDocx,
  buildProposalDraftFilenameBase,
} from '../services/proposalDraftService.js';
import {
  generateProposalDraftSchema,
  exportProposalDraftSchema,
} from '@minicrm/shared/schemas/proposalDraftSchema.js';

const FORBIDDEN_OWNERSHIP_ERROR = {
  error: {
    code: 'FORBIDDEN',
    message:
      'You can only generate proposal drafts for deals you own. Contact an admin to act on deals owned by others.',
  },
};

/**
 * POST /api/deals/:id/proposal-draft
 * Generates (or regenerates, with optional focus_notes) an AI proposal
 * draft for the deal. Not persisted — the client holds the draft in memory
 * until the rep exports or dismisses it.
 */
export async function generateProposalDraftHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  const parsed = generateProposalDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  try {
    const result = await generateProposalDraft(
      id,
      req.user!.id,
      req.user!.name,
      parsed.data.focus_notes,
    );
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}

/**
 * POST /api/deals/:id/proposal-draft/export-docx
 * Converts an already-generated draft (posted in the request body — never
 * regenerated server-side) into a downloadable DOCX file.
 */
export async function exportProposalDraftDocxHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deal = await findDealById(id);
  if (!deal) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Deal not found' } });
    return;
  }

  if (deal.owner_id !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json(FORBIDDEN_OWNERSHIP_ERROR);
    return;
  }

  const parsed = exportProposalDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const buffer = await exportProposalDraftDocx(parsed.data.draft, deal.name);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${buildProposalDraftFilenameBase(deal.name)}.docx"`,
  );
  res.status(200).send(buffer);
}
