/**
 * Automation controller — request/response shaping for automation rule endpoints.
 * No business logic here; all DB access goes through automationService.
 * All endpoints are admin-only (enforced by the route layer via requireRole).
 */

import type { Request, Response } from 'express';
import { paginationParamsSchema } from '@minicrm/shared/schemas/paginationSchema.js';
import {
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
  dealStageChangedConfigSchema,
  createTaskActionConfigSchema,
  sendNotificationActionConfigSchema,
  sendWebhookActionConfigSchema,
} from '@minicrm/shared/schemas/automationSchema.js';
import {
  createAutomationRule,
  findAutomationRuleById,
  listAutomationRules,
  updateAutomationRule,
  deleteAutomationRule,
  listRuleLogs,
} from '../services/automationService.js';

/**
 * Validates trigger_config and action_config shapes based on the rule's
 * trigger_type and action_type. Returns an error message string on failure,
 * or null when valid.
 *
 * @param triggerType - The rule's trigger type
 * @param triggerConfig - The trigger config object to validate
 * @param actionType - The rule's action type
 * @param actionConfig - The action config object to validate
 * @returns Error message string, or null if valid
 */
function validateConfigShapes(
  triggerType: string,
  triggerConfig: Record<string, unknown>,
  actionType: string,
  actionConfig: Record<string, unknown>,
): string | null {
  if (triggerType === 'deal_stage_changed') {
    const parsed = dealStageChangedConfigSchema.safeParse(triggerConfig);
    if (!parsed.success) {
      return `trigger_config: ${parsed.error.errors[0].message}`;
    }
  }

  if (actionType === 'create_task') {
    const parsed = createTaskActionConfigSchema.safeParse(actionConfig);
    if (!parsed.success) {
      return `action_config: ${parsed.error.errors[0].message}`;
    }
  } else if (actionType === 'send_notification') {
    const parsed = sendNotificationActionConfigSchema.safeParse(actionConfig);
    if (!parsed.success) {
      return `action_config: ${parsed.error.errors[0].message}`;
    }
  } else if (actionType === 'send_webhook') {
    const parsed = sendWebhookActionConfigSchema.safeParse(actionConfig);
    if (!parsed.success) {
      return `action_config: ${parsed.error.errors[0].message}`;
    }
  }

  return null;
}

/**
 * POST /api/automation/rules
 * Creates a new automation rule. Admin only.
 */
export async function createAutomationRuleHandler(req: Request, res: Response): Promise<void> {
  const parsed = createAutomationRuleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const configError = validateConfigShapes(
    parsed.data.trigger_type,
    parsed.data.trigger_config,
    parsed.data.action_type,
    parsed.data.action_config,
  );

  if (configError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: configError } });
    return;
  }

  const rule = await createAutomationRule({ ...parsed.data, created_by: req.user!.id });
  res.status(201).json({ rule });
}

/**
 * GET /api/automation/rules
 * Lists automation rules with pagination. Admin only.
 */
export async function listAutomationRulesHandler(req: Request, res: Response): Promise<void> {
  const parsed = paginationParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }
  const result = await listAutomationRules(parsed.data.page, parsed.data.limit);
  res.status(200).json(result);
}

/**
 * GET /api/automation/rules/:id
 * Returns a single automation rule by ID. Admin only.
 */
export async function getAutomationRuleHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const rule = await findAutomationRuleById(id);

  if (!rule) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation rule not found' } });
    return;
  }

  res.status(200).json({ rule });
}

/**
 * PATCH /api/automation/rules/:id
 * Updates one or more fields of an existing automation rule. Admin only.
 */
export async function updateAutomationRuleHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateAutomationRuleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const id = String(req.params['id']);
  const existing = await findAutomationRuleById(id);

  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation rule not found' } });
    return;
  }

  // When updating config shapes, validate the merged result
  const mergedTriggerType = parsed.data.trigger_type ?? existing.trigger_type;
  const mergedTriggerConfig = parsed.data.trigger_config ?? existing.trigger_config;
  const mergedActionType = parsed.data.action_type ?? existing.action_type;
  const mergedActionConfig = parsed.data.action_config ?? existing.action_config;

  const configError = validateConfigShapes(
    mergedTriggerType,
    mergedTriggerConfig,
    mergedActionType,
    mergedActionConfig,
  );

  if (configError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: configError } });
    return;
  }

  const rule = await updateAutomationRule(id, parsed.data);
  if (!rule) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation rule not found' } });
    return;
  }

  res.status(200).json({ rule });
}

/**
 * DELETE /api/automation/rules/:id
 * Deletes an automation rule and its logs. Admin only.
 */
export async function deleteAutomationRuleHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const deleted = await deleteAutomationRule(id);

  if (!deleted) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation rule not found' } });
    return;
  }

  res.status(204).send();
}

/**
 * GET /api/automation/rules/:id/logs
 * Returns the 20 most recent execution logs for a rule. Admin only.
 */
export async function listRuleLogsHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params['id']);
  const rule = await findAutomationRuleById(id);

  if (!rule) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation rule not found' } });
    return;
  }

  const logs = await listRuleLogs(id);
  res.status(200).json({ logs });
}
