/**
 * AI field exclusion controller — request/response shaping for
 * /api/v1/admin/ai/field-exclusions. No business logic here — delegates
 * entirely to aiFieldExclusionService.
 */

import type { Request, Response } from 'express';
import {
  getEffectiveExclusionList,
  setFieldExclusion,
} from '../services/aiFieldExclusionService.js';
import { setFieldExclusionSchema } from '@minicrm/shared/schemas/aiFieldExclusionSchema.js';

export async function listFieldExclusionsHandler(req: Request, res: Response): Promise<void> {
  const list = await getEffectiveExclusionList();
  res.status(200).json(list);
}

export async function setFieldExclusionHandler(req: Request, res: Response): Promise<void> {
  const parsed = setFieldExclusionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate guarantees req.user

  try {
    await setFieldExclusion(
      parsed.data.entity_type,
      parsed.data.field_name,
      parsed.data.excluded,
      actor,
    );
    res.status(200).json({
      entity_type: parsed.data.entity_type,
      field_name: parsed.data.field_name,
      excluded: parsed.data.excluded,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'UNKNOWN_FIELD') {
      res.status(400).json({ error: { code: 'UNKNOWN_FIELD', message: (err as Error).message } });
      return;
    }
    throw err;
  }
}
