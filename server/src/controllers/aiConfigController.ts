/**
 * AI configuration controller — request/response shaping for /api/v1/admin/ai/*.
 * No business logic or database access here — delegates entirely to aiConfigService.
 * (MINCRM-457)
 */

import type { Request, Response } from 'express';
import {
  setAiConfigSchema,
  setAiEnabledSchema,
  setAiDpaAcknowledgmentSchema,
  setAiSessionRetentionSchema,
  testAiConnectionSchema,
} from '@minicrm/shared/schemas/settingsSchema.js';
import {
  getAiConfig,
  setAiConfig,
  setAiEnabled,
  setAiDpaAcknowledgment,
  setAiSessionRetention,
  testAiConnection,
} from '../services/aiConfigService.js';

export async function getAiConfigHandler(req: Request, res: Response): Promise<void> {
  const config = await getAiConfig();
  res.status(200).json(config);
}

export async function setAiConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = setAiConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name }; // authenticate guarantees req.user
  const updated = await setAiConfig(parsed.data, actor);
  res.status(200).json(updated);
}

export async function setAiEnabledHandler(req: Request, res: Response): Promise<void> {
  const parsed = setAiEnabledSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const updated = await setAiEnabled(parsed.data, actor);
  res.status(200).json(updated);
}

export async function setAiDpaAcknowledgmentHandler(req: Request, res: Response): Promise<void> {
  const parsed = setAiDpaAcknowledgmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const updated = await setAiDpaAcknowledgment(parsed.data, actor);
  res.status(200).json(updated);
}

export async function setAiSessionRetentionHandler(req: Request, res: Response): Promise<void> {
  const parsed = setAiSessionRetentionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const updated = await setAiSessionRetention(parsed.data, actor);
  res.status(200).json(updated);
}

export async function testAiConnectionHandler(req: Request, res: Response): Promise<void> {
  const parsed = testAiConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const result = await testAiConnection(parsed.data);
  res.status(200).json(result);
}
