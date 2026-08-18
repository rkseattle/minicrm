/**
 * NLI tool definitions for the AI data hygiene assistant.
 * Unlike rep coaching insights, hygiene findings ARE exposed to NLI per the
 * ticket's explicit requirement ("Show me my contacts with no activity in
 * the last year").
 */

import type Anthropic from '@anthropic-ai/sdk';

export const dataHygieneTools: Anthropic.Messages.Tool[] = [
  {
    name: 'getDataHygieneFindings',
    description:
      'Returns the cached results of the nightly data hygiene scan — flagged contacts, accounts, and opportunities with stale, incomplete, or invalid data. Reps see only their own records; admins see all records. Does not trigger a new scan; always serves the latest cached run. (MINCRM-476)',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'opportunity'],
          description: 'Optionally filter to a single entity type.',
        },
      },
      required: [],
    },
  },
];
