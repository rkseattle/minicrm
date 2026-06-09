/**
 * Shared Zod schemas for automation rule validation.
 * Imported by both the server (request validation) and the client (form validation).
 */

import { z } from 'zod';
import { ACTIVITY_TYPES } from './activitySchema.js';
import { PIPELINE_STAGES } from './dealSchema.js';

// ── Trigger types ──────────────────────────────────────────────────────────────

/** All supported automation trigger types. */
export const AUTOMATION_TRIGGER_TYPES = [
  'deal_stage_changed',
  'deal_created',
  'contact_created',
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

// ── Action types ───────────────────────────────────────────────────────────────

/** All supported automation action types. */
export const AUTOMATION_ACTION_TYPES = [
  'create_task',
  'send_notification',
  'send_webhook',
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

// ── Assignee types for create_task action ──────────────────────────────────────

/** How the task assignee is resolved when the action fires. */
export const AUTOMATION_ASSIGNEE_TYPES = ['owner', 'specific'] as const;

export type AutomationAssigneeType = (typeof AUTOMATION_ASSIGNEE_TYPES)[number];

// ── Trigger config schemas ─────────────────────────────────────────────────────

/** Config for the deal_stage_changed trigger. */
export const dealStageChangedConfigSchema = z.object({
  stage: z.enum(PIPELINE_STAGES, { required_error: 'Stage is required' }),
});

/** Config for triggers with no extra parameters. */
export const emptyConfigSchema = z.object({});

// ── Action config schemas ──────────────────────────────────────────────────────

/** Config for the create_task action. */
export const createTaskActionConfigSchema = z
  .object({
    subject: z.string().min(1, 'Task subject is required').trim(),
    task_type: z.enum(ACTIVITY_TYPES, { required_error: 'Task type is required' }),
    assignee_type: z.enum(AUTOMATION_ASSIGNEE_TYPES, {
      required_error: 'Assignee type is required',
    }),
    /** Required when assignee_type is 'specific'. */
    assignee_id: z.string().uuid('assignee_id must be a valid UUID').optional(),
    /** Number of days after the trigger date to set the task due date. Must be >= 0. */
    due_date_offset_days: z
      .number()
      .int('Due date offset must be a whole number')
      .min(0, 'Due date offset must be 0 or greater'),
  })
  .refine((data) => data.assignee_type !== 'specific' || Boolean(data.assignee_id), {
    message: 'assignee_id is required when assignee_type is "specific"',
    path: ['assignee_id'],
  });

/** Config for the send_notification action. */
export const sendNotificationActionConfigSchema = z.object({
  message: z.string().min(1, 'Notification message is required').trim(),
});

/** Config for the send_webhook action. */
export const sendWebhookActionConfigSchema = z.object({
  url: z.string().url('URL must be a valid URL'),
  method: z.enum(['POST', 'GET']),
  headers: z.record(z.string()).optional(),
});

// ── Rule create schema ─────────────────────────────────────────────────────────

/**
 * Schema for creating a new automation rule.
 * trigger_config and action_config are validated as generic JSON objects here;
 * deep validation of their shape is done in the service after the trigger/action
 * types are known.
 */
export const createAutomationRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required').trim(),
  enabled: z.boolean().default(true),
  trigger_type: z.enum(AUTOMATION_TRIGGER_TYPES, {
    required_error: 'Trigger type is required',
  }),
  trigger_config: z.record(z.unknown()).default({}),
  action_type: z.enum(AUTOMATION_ACTION_TYPES, {
    required_error: 'Action type is required',
  }),
  action_config: z.record(z.unknown()),
});

// ── Rule update schema ─────────────────────────────────────────────────────────

/**
 * Schema for updating an existing automation rule.
 * At least one field must be present.
 */
export const updateAutomationRuleSchema = z
  .object({
    name: z.string().min(1, 'Rule name is required').trim().optional(),
    enabled: z.boolean().optional(),
    trigger_type: z.enum(AUTOMATION_TRIGGER_TYPES).optional(),
    trigger_config: z.record(z.unknown()).optional(),
    action_type: z.enum(AUTOMATION_ACTION_TYPES).optional(),
    action_config: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

// ── Response schemas ───────────────────────────────────────────────────────────

/** Safe rule response shape returned to API consumers. */
export const automationRuleResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  enabled: z.boolean(),
  trigger_type: z.enum(AUTOMATION_TRIGGER_TYPES),
  trigger_config: z.record(z.unknown()),
  action_type: z.enum(AUTOMATION_ACTION_TYPES),
  action_config: z.record(z.unknown()),
  created_by: z.string().uuid(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

/** Safe execution log response shape. */
export const automationRuleLogResponseSchema = z.object({
  id: z.string().uuid(),
  rule_id: z.string().uuid(),
  rule_name: z.string(),
  triggered_at: z.string().or(z.date()),
  triggering_record_type: z.enum(['deal', 'contact']),
  triggering_record_id: z.string().uuid(),
  outcome: z.enum(['success', 'error']),
  error_message: z.string().nullable(),
  action_config_snapshot: z.record(z.unknown()).nullable(),
});

// ── Inferred types ─────────────────────────────────────────────────────────────

export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;
export type AutomationRuleResponse = z.infer<typeof automationRuleResponseSchema>;
export type AutomationRuleLogResponse = z.infer<typeof automationRuleLogResponseSchema>;
export type CreateTaskActionConfig = z.infer<typeof createTaskActionConfigSchema>;
export type SendNotificationActionConfig = z.infer<typeof sendNotificationActionConfigSchema>;
export type SendWebhookActionConfig = z.infer<typeof sendWebhookActionConfigSchema>;
