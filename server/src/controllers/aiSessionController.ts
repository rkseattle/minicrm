/**
 * AI session controller — request/response shaping for /api/v1/ai/sessions/*.
 * No business logic or database access here — delegates entirely to aiSessionService.
 * (MINCRM-420, MINCRM-421)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  createAiSessionSchema,
  sendAiMessageSchema,
} from '@minicrm/shared/schemas/aiSessionSchema.js';

const sessionIdSchema = z.string().uuid();
import {
  listSessions,
  createSession,
  getSessionWithMessages,
  deleteSession,
  sendMessage,
} from '../services/aiSessionService.js';

export async function listAiSessionsHandler(req: Request, res: Response): Promise<void> {
  const sessions = await listSessions(req.user!.id); // authenticate guarantees req.user
  res.status(200).json({ sessions });
}

export async function createAiSessionHandler(req: Request, res: Response): Promise<void> {
  const parsed = createAiSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const session = await createSession(req.user!.id, actor);
  res.status(201).json(session);
}

export async function getAiSessionHandler(req: Request, res: Response): Promise<void> {
  const idParsed = sessionIdSchema.safeParse(req.params['sessionId']);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
    return;
  }
  const sessionId = idParsed.data;
  try {
    const session = await getSessionWithMessages(sessionId, req.user!.id);
    res.status(200).json(session);
  } catch (err: unknown) {
    const tagged = err as { statusCode?: number; message?: string };
    if (tagged.statusCode === 404) {
      res.status(404).json({
        error: { code: 'SESSION_NOT_FOUND', message: tagged.message ?? 'Session not found' },
      });
      return;
    }
    throw err;
  }
}

export async function deleteAiSessionHandler(req: Request, res: Response): Promise<void> {
  const idParsed = sessionIdSchema.safeParse(req.params['sessionId']);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
    return;
  }
  const sessionId = idParsed.data;
  const actor = { id: req.user!.id, name: req.user!.name };
  try {
    await deleteSession(sessionId, req.user!.id, actor);
    res.status(204).send();
  } catch (err: unknown) {
    const tagged = err as { statusCode?: number; message?: string };
    if (tagged.statusCode === 404) {
      res.status(404).json({
        error: { code: 'SESSION_NOT_FOUND', message: tagged.message ?? 'Session not found' },
      });
      return;
    }
    throw err;
  }
}

export async function sendAiMessageHandler(req: Request, res: Response): Promise<void> {
  const parsed = sendAiMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const idParsed = sessionIdSchema.safeParse(req.params['sessionId']);
  if (!idParsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid session ID' } });
    return;
  }
  const sessionId = idParsed.data;
  const actor = { id: req.user!.id, name: req.user!.name };

  try {
    const assistantMessage = await sendMessage(sessionId, req.user!.id, parsed.data.content, actor);
    res.status(200).json(assistantMessage);
  } catch (err: unknown) {
    const tagged = err as { statusCode?: number; message?: string };
    if (tagged.statusCode === 404) {
      res.status(404).json({
        error: { code: 'SESSION_NOT_FOUND', message: tagged.message ?? 'Session not found' },
      });
      return;
    }
    if (tagged.statusCode === 502) {
      res.status(502).json({
        error: { code: 'AI_PROVIDER_ERROR', message: tagged.message ?? 'AI provider error' },
      });
      return;
    }
    if (tagged.statusCode === 503) {
      res.status(503).json({
        error: { code: 'AI_NOT_CONFIGURED', message: tagged.message ?? 'AI is not configured' },
      });
      return;
    }
    throw err;
  }
}
