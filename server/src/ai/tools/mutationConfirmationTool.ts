/**
 * Tool definition for requestMutationConfirmation.
 *
 * This tool is the mandatory first step before any create, update, or delete
 * operation. It captures the pending action for user review and returns it for
 * storage on the assistant message. The actual write tool must only be called
 * after the user confirms the action in their next message. (MINCRM-425, MINCRM-426)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const mutationConfirmationTools: Anthropic.Messages.Tool[] = [
  {
    name: 'requestMutationConfirmation',
    description: `Call this tool BEFORE calling any create, update, or delete tool.

This tool does NOT execute the mutation. It captures the pending action and presents it to the user for review. After the user confirms, THEN call the actual write tool (createContact, updateDeal, deleteActivity, etc.). If the user cancels, acknowledge with "Got it, no changes were made." and do not call the write tool.

Guidelines:
- Always call this first for any create, update, or delete operation — no exceptions.
- Set entity_id and entity_name for update/delete operations so the user can identify the record.
- For create operations, include all fields to be set in the fields object.
- For update operations, include ONLY the fields being changed and their new values.
- For delete operations, include the key identifying fields (name, id, etc.) in the fields object.
- For operations affecting more than one record, set is_bulk=true, include the total count in bulk_count, and provide up to 5 representative record names in bulk_sample.
- For bulk delete operations, also set is_bulk_delete=true — these require explicit confirmation.
- Write a clear, plain-language summary of what will happen (e.g. "Create a new contact named Jane Doe at Acme Corp").`,
    input_schema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'delete'],
          description: 'The type of mutation operation to confirm.',
        },
        entity_type: {
          type: 'string',
          description:
            'The CRM entity type being mutated (e.g. "contact", "deal", "account", "lead", "activity", "note").',
        },
        entity_id: {
          type: 'string',
          description:
            'For update and delete operations: the ID of the record being modified. Omit for create operations.',
        },
        entity_name: {
          type: 'string',
          description:
            'For update and delete operations: the human-readable name or label of the record (e.g. "Acme Corp", "Jane Doe"). Omit for create operations.',
        },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            'For create: all fields to be set. For update: only the fields being changed and their new values. For delete: key fields identifying the record.',
        },
        is_bulk: {
          type: 'boolean',
          description: 'Set to true when the operation affects more than one record.',
        },
        bulk_count: {
          type: 'integer',
          description:
            'Required when is_bulk is true. The total number of records affected by this operation.',
        },
        bulk_sample: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional when is_bulk is true. Up to 5 representative record names for preview (e.g. ["Acme Corp", "Globex", "Initech"]).',
        },
        is_bulk_delete: {
          type: 'boolean',
          description:
            'Set to true when is_bulk is true AND operation is "delete". Triggers an additional confirmation gate on the client.',
        },
        summary: {
          type: 'string',
          description:
            'Plain-language description of what will happen, shown to the user for confirmation (e.g. "Create a new contact named Jane Doe at Acme Corp" or "Delete the deal Acme Renewal worth $50,000 USD").',
        },
      },
      required: ['operation', 'entity_type', 'fields', 'is_bulk', 'summary'],
    },
  },
];
