/**
 * Automation service — business logic for automation rules and rule execution.
 * All database access for automation_rules and automation_rule_logs goes through this module.
 */

import pool from '../db.js';
import logger from '../logger.js';
import type { PaginatedResponse } from '@minicrm/shared/schemas/paginationSchema.js';
import type {
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
  AutomationTriggerType,
} from '@minicrm/shared/schemas/automationSchema.js';
import { writeAuditEntryBestEffort, SYSTEM_ACTOR } from './auditService.js';
import type { AuditActor } from './auditService.js';
import {
  dealStageChangedConfigSchema,
  createTaskActionConfigSchema,
  sendNotificationActionConfigSchema,
  sendWebhookActionConfigSchema,
} from '@minicrm/shared/schemas/automationSchema.js';
import { sendWebhookForAutomation } from './webhookService.js';

/** Columns that may be updated via updateAutomationRule — guards against SQL injection */
const ALLOWED_UPDATE_FIELDS: ReadonlySet<keyof UpdateAutomationRuleInput> = new Set([
  'name',
  'enabled',
  'trigger_type',
  'trigger_config',
  'action_type',
  'action_config',
]);

/** Shape of an automation_rules row returned from the database */
export interface AutomationRuleRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

/** Shape of an automation_rule_logs row joined with rule name */
export interface AutomationRuleLogRow {
  id: string;
  rule_id: string;
  rule_name: string;
  triggered_at: Date;
  triggering_record_type: string;
  triggering_record_id: string;
  outcome: 'success' | 'error';
  error_message: string | null;
  action_config_snapshot: Record<string, unknown> | null;
}

/** Context passed to fireAutomationTrigger describing the record that caused the trigger */
export interface TriggerContext {
  /** UUID of the triggering record */
  recordId: string;
  /** 'deal' or 'contact' */
  recordType: 'deal' | 'contact';
  /** UUID of the record's current owner */
  ownerId: string;
  /** For deal_stage_changed: the new stage value */
  newStage?: string;
}

/**
 * Creates a new automation rule.
 *
 * @param params - Rule fields plus the creating admin's user ID
 * @param actor - User performing the action (for audit log)
 * @returns The inserted rule row
 */
export async function createAutomationRule(
  params: CreateAutomationRuleInput & { created_by: string },
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<AutomationRuleRow> {
  const { name, enabled, trigger_type, trigger_config, action_type, action_config, created_by } =
    params;

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO automation_rules
       (name, enabled, trigger_type, trigger_config, action_type, action_config, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      name,
      enabled,
      trigger_type,
      JSON.stringify(trigger_config),
      action_type,
      JSON.stringify(action_config),
      created_by,
    ],
  );

  const rule = (await findAutomationRuleById(insertResult.rows[0].id))!;

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordId: rule.id,
    recordName: rule.name,
    eventType: 'created',
    newValue: `trigger: ${rule.trigger_type}, action: ${rule.action_type}`,
    changedById: actor.id,
    changedByName: actor.name,
  });

  return rule;
}

/**
 * Finds an automation rule by its UUID.
 *
 * @param id - Rule UUID
 * @returns The rule row, or null if not found
 */
export async function findAutomationRuleById(id: string): Promise<AutomationRuleRow | null> {
  const result = await pool.query<AutomationRuleRow>(
    `SELECT id, name, enabled, trigger_type, trigger_config, action_type, action_config, created_by, created_at, updated_at
     FROM automation_rules
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Returns a paginated list of automation rules ordered by creation date descending.
 *
 * @param page - 1-based page number (default 1)
 * @param limit - Records per page (default 25)
 * @returns Paginated response with rule rows and total count
 */
export async function listAutomationRules(
  page = 1,
  limit = 25,
): Promise<PaginatedResponse<AutomationRuleRow>> {
  const offset = (page - 1) * limit;
  const [countResult, dataResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM automation_rules`),
    pool.query<AutomationRuleRow>(
      `SELECT id, name, enabled, trigger_type, trigger_config, action_type, action_config, created_by, created_at, updated_at
       FROM automation_rules
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
  ]);
  return {
    data: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/**
 * Updates one or more fields on an existing automation rule.
 *
 * @param id - Rule UUID
 * @param params - Fields to update (at least one required)
 * @param actor - User performing the action (for audit log)
 * @returns The updated rule row, or null if not found
 */
export async function updateAutomationRule(
  id: string,
  params: UpdateAutomationRuleInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<AutomationRuleRow | null> {
  const before = await findAutomationRuleById(id);

  const fields = (Object.keys(params) as (keyof UpdateAutomationRuleInput)[]).filter((field) =>
    ALLOWED_UPDATE_FIELDS.has(field),
  );

  if (fields.length === 0) {
    return before;
  }

  const setClauses = fields
    .map((field, index) => {
      if (field === 'trigger_config' || field === 'action_config') {
        return `${field} = $${index + 2}::jsonb`;
      }
      return `${field} = $${index + 2}`;
    })
    .join(', ');

  const updateResult = await pool.query<{ id: string }>(
    `UPDATE automation_rules
     SET ${setClauses}, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      id,
      ...fields.map((f) => {
        const value = params[f];
        if (f === 'trigger_config' || f === 'action_config') {
          return JSON.stringify(value);
        }
        return value;
      }),
    ],
  );

  if (!updateResult.rows[0]) return null;
  const updated = await findAutomationRuleById(updateResult.rows[0].id);

  if (updated && before) {
    const changedSummary = fields
      .filter((f) => f !== 'trigger_config' && f !== 'action_config')
      .map((f) => `${f}: ${String(before[f as keyof AutomationRuleRow])} → ${String(params[f])}`)
      .join(', ');

    void writeAuditEntryBestEffort({
      recordType: 'system_settings',
      recordId: updated.id,
      recordName: updated.name,
      eventType: 'updated',
      newValue: changedSummary || `trigger_config or action_config updated`,
      changedById: actor.id,
      changedByName: actor.name,
    });
  }

  return updated;
}

/**
 * Deletes an automation rule and its associated logs (via CASCADE).
 *
 * @param id - Rule UUID
 * @param actor - User performing the action (for audit log)
 * @returns The deleted rule row, or null if not found
 */
export async function deleteAutomationRule(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<AutomationRuleRow | null> {
  const existing = await findAutomationRuleById(id);
  if (!existing) return null;

  const deleteResult = await pool.query<{ id: string }>(
    `DELETE FROM automation_rules WHERE id = $1 RETURNING id`,
    [id],
  );
  if (!deleteResult.rows[0]) return null;

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordId: existing.id,
    recordName: existing.name,
    eventType: 'deleted',
    oldValue: `trigger: ${existing.trigger_type}, action: ${existing.action_type}`,
    changedById: actor.id,
    changedByName: actor.name,
  });

  return existing;
}

/**
 * Returns the 20 most recent execution logs for a given rule.
 *
 * @param ruleId - Rule UUID
 * @returns Array of log rows ordered by triggered_at descending
 */
export async function listRuleLogs(ruleId: string): Promise<AutomationRuleLogRow[]> {
  const result = await pool.query<AutomationRuleLogRow>(
    `SELECT l.id, l.rule_id, r.name AS rule_name, l.triggered_at,
            l.triggering_record_type, l.triggering_record_id, l.outcome, l.error_message,
            l.action_config_snapshot
     FROM automation_rule_logs l
     JOIN automation_rules r ON r.id = l.rule_id
     WHERE l.rule_id = $1
     ORDER BY l.triggered_at DESC
     LIMIT 20`,
    [ruleId],
  );
  return result.rows;
}

/**
 * Writes a single execution log entry.
 *
 * @param params - Log fields
 * @returns The inserted log row ID
 */
async function writeRuleLog(params: {
  ruleId: string;
  triggeringRecordType: string;
  triggeringRecordId: string;
  outcome: 'success' | 'error';
  errorMessage?: string;
  actionConfigSnapshot: Record<string, unknown>;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO automation_rule_logs
         (rule_id, triggering_record_type, triggering_record_id, outcome, error_message, action_config_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.ruleId,
        params.triggeringRecordType,
        params.triggeringRecordId,
        params.outcome,
        params.errorMessage ?? null,
        JSON.stringify(params.actionConfigSnapshot),
      ],
    );
  } catch (err) {
    // 23503 = FK violation: the rule was deleted between query and log write — no log needed
    if ((err as { code?: string }).code === '23503') return;
    throw err;
  }
}

/** The maximum number of days a due_date_offset can advance a task */
const MAX_DUE_DATE_OFFSET_DAYS = 3650;

/**
 * Executes a single automation rule against the given trigger context.
 * Writes a log entry for every execution attempt (success or error).
 *
 * @param rule - The rule to execute
 * @param context - Contextual data about the triggering event
 */
async function executeRule(rule: AutomationRuleRow, context: TriggerContext): Promise<void> {
  // Capture the action_config at the moment of execution so the log entry remains
  // accurate even if the rule is subsequently edited. (MINCRM-509)
  const actionConfigSnapshot = rule.action_config;

  const logBase = {
    ruleId: rule.id,
    triggeringRecordType: context.recordType,
    triggeringRecordId: context.recordId,
    actionConfigSnapshot,
  };

  try {
    if (rule.action_type === 'create_task') {
      const configParsed = createTaskActionConfigSchema.safeParse(rule.action_config);
      if (!configParsed.success) {
        throw new Error(`Invalid action_config: ${configParsed.error.errors[0].message}`);
      }

      const { subject, task_type, assignee_type, assignee_id, due_date_offset_days } =
        configParsed.data;

      const assigneeId = assignee_type === 'specific' ? assignee_id! : context.ownerId;

      const dueDate = new Date();
      const offsetDays = Math.min(due_date_offset_days, MAX_DUE_DATE_OFFSET_DAYS);
      dueDate.setDate(dueDate.getDate() + offsetDays);
      const dueDateStr = dueDate.toISOString().slice(0, 10);

      // Determine the parent column for the task based on the triggering record type
      const parentColumn = context.recordType === 'deal' ? 'deal_id' : 'contact_id';

      await pool.query(
        `INSERT INTO activities
           (type, subject, due_date, status, ${parentColumn}, owner_id)
         VALUES ($1, $2, $3, 'open', $4, $5)`,
        [task_type, subject, dueDateStr, context.recordId, assigneeId],
      );
    } else if (rule.action_type === 'send_notification') {
      const configParsed = sendNotificationActionConfigSchema.safeParse(rule.action_config);
      if (!configParsed.success) {
        throw new Error(`Invalid action_config: ${configParsed.error.errors[0].message}`);
      }
      // Notification is logged to the application logger.
      // Full email/in-app notification delivery is post-alpha (MINCRM-5).
      logger.info(
        {
          ruleId: rule.id,
          ruleName: rule.name,
          triggeringRecordId: context.recordId,
          message: configParsed.data.message,
        },
        'Automation notification triggered',
      );
    } else if (rule.action_type === 'send_webhook') {
      const configParsed = sendWebhookActionConfigSchema.safeParse(rule.action_config);
      if (!configParsed.success) {
        throw new Error(`Invalid action_config: ${configParsed.error.errors[0].message}`);
      }
      await sendWebhookForAutomation({
        url: configParsed.data.url,
        method: configParsed.data.method,
        headers: configParsed.data.headers,
        eventType: 'automation.send_webhook',
        data: { recordId: context.recordId, recordType: context.recordType },
      });
    } else {
      throw new Error(`Unsupported action_type: ${rule.action_type}`);
    }

    await writeRuleLog({ ...logBase, outcome: 'success' });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ ruleId: rule.id, err }, 'Automation rule execution failed');
    await writeRuleLog({ ...logBase, outcome: 'error', errorMessage });
  }
}

/**
 * Looks up all enabled rules for the given trigger type and executes any that match.
 * Errors in individual rule execution are caught and logged — they never propagate
 * back to the caller so a bad rule cannot break the triggering operation.
 *
 * @param triggerType - The automation trigger type that just fired
 * @param context - Contextual data about the triggering event
 */
export async function fireAutomationTrigger(
  triggerType: AutomationTriggerType,
  context: TriggerContext,
): Promise<void> {
  let rules: AutomationRuleRow[];

  try {
    const result = await pool.query<AutomationRuleRow>(
      `SELECT id, name, enabled, trigger_type, trigger_config, action_type, action_config, created_by, created_at, updated_at
       FROM automation_rules
       WHERE trigger_type = $1 AND enabled = true`,
      [triggerType],
    );
    rules = result.rows;
  } catch (err) {
    // Failing to fetch rules must not break the primary operation
    logger.error({ triggerType, err }, 'Failed to fetch automation rules for trigger');
    return;
  }

  for (const rule of rules) {
    // For deal_stage_changed, only fire when the stage matches the rule's configured stage
    if (triggerType === 'deal_stage_changed') {
      const configParsed = dealStageChangedConfigSchema.safeParse(rule.trigger_config);
      if (!configParsed.success || configParsed.data.stage !== context.newStage) {
        continue;
      }
    }

    // Execute each matching rule. Errors are caught inside executeRule.
    await executeRule(rule, context);
  }
}
