/**
 * NLI tool definitions for the Deal / Opportunity entity. (MINCRM-422)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const dealTools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchDeals',
    description:
      'Search and filter deals (opportunities) in the CRM. Supports filtering by pipeline, stage, amount, currency, close date, tags, and owner. Returns a paginated list.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Full-text search across deal name and notes.',
        },
        pipeline_id: {
          type: 'string',
          description: 'Filter to deals in a specific pipeline.',
        },
        stage_id: {
          type: 'string',
          description: 'Filter to deals in a specific pipeline stage.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to deals owned by a specific user ID.',
        },
        account_id: {
          type: 'string',
          description: 'Filter to deals associated with a specific account.',
        },
        contact_id: {
          type: 'string',
          description: 'Filter to deals associated with a specific contact.',
        },
        currency: {
          type: 'string',
          description: 'Filter to deals in this 3-letter ISO currency code (e.g. USD, EUR, GBP).',
        },
        amount_min: {
          type: 'number',
          description: "Minimum deal value (in the deal's own currency).",
        },
        amount_max: {
          type: 'number',
          description: "Maximum deal value (in the deal's own currency).",
        },
        close_date_from: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). Filter to deals with close date on or after this date.',
        },
        close_date_to: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). Filter to deals with close date on or before this date.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter deals that have ALL of these tag UUIDs (use listTags to find IDs).',
        },
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
        sort_by: {
          type: 'string',
          enum: ['created_at', 'name', 'close_date', 'value'],
          description: 'Field to sort by. Defaults to created_at.',
        },
        sort_dir: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction. Defaults to desc.',
        },
      },
      required: [],
    },
  },
  {
    name: 'getDeal',
    description:
      'Retrieve a single deal record by UUID, including pipeline stage, currency, tags, and custom field values.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the deal.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'createDeal',
    description: 'Create a new deal (opportunity) in the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Deal name.' },
        pipeline_id: {
          type: 'string',
          description: 'UUID of the pipeline. Uses the default pipeline if omitted.',
        },
        stage_id: {
          type: 'string',
          description: 'UUID of the initial pipeline stage. Uses the first stage if omitted.',
        },
        amount: { type: 'number', description: 'Deal value.' },
        currency: {
          type: 'string',
          description: '3-letter ISO currency code (e.g. USD). Defaults to org currency.',
        },
        close_date: {
          type: 'string',
          description: 'Expected close date in ISO format (YYYY-MM-DD).',
        },
        probability: {
          type: 'number',
          description: 'Win probability 0–100. Defaults to stage default.',
        },
        contact_id: { type: 'string', description: 'UUID of a primary contact to associate.' },
        account_id: { type: 'string', description: 'UUID of the account to associate.' },
        owner_id: {
          type: 'string',
          description: 'UUID of the owning user. Defaults to the calling user.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names to attach on creation.',
        },
        notes: { type: 'string', description: 'Initial notes for the deal.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'updateDeal',
    description:
      'Update fields on an existing deal. Only the provided fields are changed. Use this to move a deal to a new stage.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the deal to update.' },
        name: { type: 'string' },
        stage_id: {
          type: 'string',
          description: 'UUID of the pipeline stage to move the deal to.',
        },
        amount: { type: 'number' },
        currency: { type: 'string', description: '3-letter ISO currency code.' },
        close_date: { type: 'string' },
        probability: { type: 'number', description: 'Win probability 0–100.' },
        contact_id: { type: 'string' },
        account_id: { type: 'string' },
        owner_id: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replaces ALL current tags on the deal.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'deleteDeal',
    description: 'Permanently delete a deal record. This cannot be undone.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the deal to delete.' },
      },
      required: ['id'],
    },
  },
];
