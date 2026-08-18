/**
 * NLI tool definitions for entity export.
 *
 * The export is synchronous (CSV text returned directly) — no job ID.
 * RBAC is enforced by the executor: a rep can only export records in their
 * visibility scope.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const exportTools: Anthropic.Messages.Tool[] = [
  {
    name: 'exportEntities',
    description:
      'Export CRM records as CSV text. Supported entity types: contacts, accounts, deals. ' +
      'Filters are applied before export. The result is the raw CSV content — share it with the user or summarise the row count. ' +
      'RBAC applies: reps can only export records in their own visibility scope.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal'],
          description: 'The type of entity to export.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to records owned by a specific user. Admins only.',
        },
        query: {
          type: 'string',
          description: 'Full-text search filter applied before export.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to records that have ALL of these tag names.',
        },
        pipeline_id: {
          type: 'string',
          description: 'Filter deals to a specific pipeline (deal exports only).',
        },
        stage_id: {
          type: 'string',
          description: 'Filter deals to a specific stage (deal exports only).',
        },
        date_from: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). Filter to records created on or after this date.',
        },
        date_to: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). Filter to records created on or before this date.',
        },
      },
      required: ['entity_type'],
    },
  },
];
