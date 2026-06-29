/**
 * AI context controller — request/response shaping for /api/v1/ai/context/*.
 * No business logic or database access — delegates entirely to aiContextService.
 * (MINCRM-427, MINCRM-428)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createAiContextSchema,
  updateAiContextSchema,
} from '@minicrm/shared/schemas/aiContextSchema.js';
import {
  listContextEntries,
  createContextEntry,
  updateContextEntry,
  deleteContextEntry,
} from '../services/aiContextService.js';

const idSchema = z.string().uuid();

export async function listAiContextHandler(req: Request, res: Response): Promise<void> {
  const entries = await listContextEntries(req.user!.id); // authenticate guarantees req.user
  res.status(200).json({ entries });
}

export async function createAiContextHandler(req: Request, res: Response): Promise<void> {
  const parsed = createAiContextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const entry = await createContextEntry(req.user!.id, parsed.data.key, parsed.data.value, actor);
    res.status(201).json(entry);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    const code = (err as { code?: string }).code;
    if (statusCode === 409 && code === 'CONTEXT_ENTRY_LIMIT_REACHED') {
      res.status(409).json({
        error: {
          code: 'CONTEXT_ENTRY_LIMIT_REACHED',
          message: (err as Error).message,
        },
      });
      return;
    }
    throw err;
  }
}

export async function updateAiContextHandler(req: Request, res: Response): Promise<void> {
  const idParsed = idSchema.safeParse(req.params['id']);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid entry ID' } });
    return;
  }

  const parsed = updateAiContextSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    const entry = await updateContextEntry(idParsed.data, req.user!.id, parsed.data, actor);
    res.status(200).json(entry);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Context entry not found' } });
      return;
    }
    throw err;
  }
}

export async function deleteAiContextHandler(req: Request, res: Response): Promise<void> {
  const idParsed = idSchema.safeParse(req.params['id']);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid entry ID' } });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    await deleteContextEntry(idParsed.data, req.user!.id, actor);
    res.status(204).send();
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Context entry not found' } });
      return;
    }
    throw err;
  }
}
