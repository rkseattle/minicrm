/**
 * Duplicate explanation controller — request/response shaping only.
 * No business logic here; all AI orchestration goes through duplicateExplanationService.
 */

import type { Request, Response } from 'express';
import { handleAiServiceError } from '../utils/aiErrorHandling.js';
import { explainDuplicateSchema } from '@minicrm/shared/schemas/duplicateExplanationRequestSchema.js';
import { findContactById } from '../services/contactService.js';
import { findAccountById } from '../services/accountService.js';
import { explainDuplicateMatch } from '../services/duplicateExplanationService.js';
import type { DuplicateMatchCandidate } from '../services/duplicateMatchService.js';

/** Maps a contact row to the fields the duplicate-match engine compares. */
function contactToCandidate(contact: {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
}): DuplicateMatchCandidate {
  return {
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    phone: contact.phone,
    company_name: null,
  };
}

/** Maps an account row to the fields the duplicate-match engine compares. */
function accountToCandidate(account: { name: string }): DuplicateMatchCandidate {
  return {
    first_name: account.name,
    last_name: '',
    email: '',
    phone: null,
    company_name: account.name,
  };
}

/** Loads and maps record A by entity type; returns null if not found. */
async function loadCandidateA(
  entityType: 'contact' | 'account',
  id: string,
): Promise<DuplicateMatchCandidate | null> {
  if (entityType === 'contact') {
    const record = await findContactById(id);
    return record ? contactToCandidate(record) : null;
  }
  const record = await findAccountById(id);
  return record ? accountToCandidate(record) : null;
}

/**
 * POST /api/v1/duplicates/explain
 * Runs an on-demand AI explanation of why two contact or account records
 * look like duplicates. Not persisted — generated one pair at a time.
 */
export async function explainDuplicateHandler(req: Request, res: Response): Promise<void> {
  const parsed = explainDuplicateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid input',
      },
    });
    return;
  }

  const { entity_type, record_a_id, record_b_id, record_b_fields } = parsed.data;

  const candidateA = await loadCandidateA(entity_type, record_a_id);
  if (!candidateA) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record A not found' } });
    return;
  }

  let candidateB: DuplicateMatchCandidate | null = null;

  if (record_b_id) {
    candidateB = await loadCandidateA(entity_type, record_b_id);
    if (!candidateB) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record B not found' } });
      return;
    }
  } else if (record_b_fields) {
    candidateB = {
      first_name: record_b_fields.first_name ?? record_b_fields.name ?? '',
      last_name: record_b_fields.last_name ?? '',
      email: record_b_fields.email ?? '',
      phone: record_b_fields.phone ?? null,
      company_name: entity_type === 'account' ? (record_b_fields.name ?? null) : null,
    };
  }

  if (!candidateB) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'record_b_id or record_b_fields is required' },
    });
    return;
  }

  try {
    const result = await explainDuplicateMatch(candidateA, candidateB, req.user!.id);
    res.status(200).json(result);
  } catch (err: unknown) {
    if (handleAiServiceError(err, res)) return;
    throw err;
  }
}
