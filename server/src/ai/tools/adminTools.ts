/**
 * NLI tool definitions for admin-managed configuration data.
 * These tools are read-only — mutations via NLI are out of scope.
 * Filtered out for rep-role users by buildToolSet(). (MINCRM-422)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const adminTools: Anthropic.Messages.Tool[] = [
  // ── Pipelines ──────────────────────────────────────────────────────────────
  {
    name: 'listPipelines',
    description: 'List all configured deal pipelines with their names and IDs.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getPipeline',
    description:
      'Get full detail of a single pipeline: ordered stages with win probabilities and exit criteria.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the pipeline.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'listStages',
    description: 'List the stages for a given pipeline, ordered by position.',
    input_schema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'string', description: 'UUID of the pipeline.' },
      },
      required: ['pipeline_id'],
    },
  },

  // ── Custom Fields ──────────────────────────────────────────────────────────
  {
    name: 'listCustomFields',
    description:
      'List all custom field definitions for a given entity type. Returns field key, label, type, and whether the field is PII-excluded from AI payloads.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'Entity type to list custom fields for.',
        },
      },
      required: ['entity_type'],
    },
  },

  // ── Automation Rules ────────────────────────────────────────────────────────
  {
    name: 'listAutomationRules',
    description:
      'List all automation rules with name, trigger, conditions, actions, and enabled state.',
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
      },
      required: [],
    },
  },
  {
    name: 'getAutomationRule',
    description:
      'Get full detail of a single automation rule including all trigger config and action config.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the automation rule.' },
      },
      required: ['id'],
    },
  },

  // ── Webhooks ────────────────────────────────────────────────────────────────
  {
    name: 'listWebhooks',
    description:
      'List all configured webhook subscriptions with name, URL, subscribed events, and enabled state.',
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
      },
      required: [],
    },
  },

  // ── Email Templates ────────────────────────────────────────────────────────
  {
    name: 'listEmailTemplates',
    description:
      'List all email templates with name, category, subject, and enabled state. Required by the email drafting workflow.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Filter to templates in a specific category (e.g. sales, support, onboarding).',
        },
        enabled_only: {
          type: 'boolean',
          description: 'When true, returns only enabled templates. Defaults to false.',
        },
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
      },
      required: [],
    },
  },
  {
    name: 'getEmailTemplate',
    description:
      'Get full detail of an email template including the body HTML and available merge tags.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the email template.' },
      },
      required: ['id'],
    },
  },
];
