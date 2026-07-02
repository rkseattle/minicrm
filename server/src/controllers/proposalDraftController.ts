/**
 * Proposal draft controller — request/response shaping only. (MINCRM-473)
 * No business logic here; all AI orchestration and DB access goes through proposalDraftService.
 */

import type { Request, Response } from 'express';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import { findDealById } from '../services/dealService.js';
import { generateProposalDraft } from '../services/proposalDraftService.js';
import {
  generateProposalDraftSchema,
  exportProposalDraftSchema,
} from '@minicrm/shared/schemas/proposalDraftSchema.js';
import type { ProposalDraft } from '@minicrm/shared/schemas/proposalDraftSchema.js';

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

  const parsed = generateProposalDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const result = await generateProposalDraft(
    id,
    req.user!.id,
    req.user!.name,
    parsed.data.focus_notes,
  );
  res.status(200).json(result);
}

function buildProposalDocxDocument(draft: ProposalDraft, dealName: string): Document {
  return new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: `Proposal: ${dealName}`, heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `Prepared for: ${draft.prepared_for}` }),
          new Paragraph({ text: `Prepared by: ${draft.prepared_by}` }),
          new Paragraph({ text: 'Executive Summary', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.executive_summary }),
          new Paragraph({ text: 'Problem Statement', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.problem_statement }),
          new Paragraph({ text: 'Proposed Solution', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.proposed_solution }),
          new Paragraph({ text: 'Proposed Investment', heading: HeadingLevel.HEADING_1 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: 'Description' })] }),
                  new TableCell({ children: [new Paragraph({ text: 'Amount' })] }),
                ],
              }),
              ...draft.pricing_line_items.map(
                (item) =>
                  new TableRow({
                    children: [
                      new TableCell({ children: [new Paragraph({ text: item.description })] }),
                      new TableCell({
                        children: [
                          new Paragraph({
                            text: `${draft.pricing_currency} ${item.amount.toFixed(2)}`,
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            ],
          }),
          new Paragraph({ text: 'Next Steps', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: draft.next_steps }),
        ],
      },
    ],
  });
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

  const parsed = exportProposalDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const document = buildProposalDocxDocument(parsed.data.draft, deal.name);
  const buffer = await Packer.toBuffer(document);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  res.setHeader('Content-Disposition', `attachment; filename="proposal-${deal.name}.docx"`);
  res.status(200).send(buffer);
}
