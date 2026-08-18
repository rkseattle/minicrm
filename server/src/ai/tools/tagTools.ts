/**
 * NLI tool definitions for Tags.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const tagTools: Anthropic.Messages.Tool[] = [
  {
    name: 'listTags',
    description:
      'List all available tags in the CRM. Use this to discover what tags exist before filtering records by tag or before renaming/removing a tag.',
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 50.' },
      },
      required: [],
    },
  },
  {
    name: 'attachTag',
    description:
      'Attach a tag to a CRM record (contact, account, deal, or lead) by tag name. The tag will be created if it does not already exist. Always call requestMutationConfirmation first.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'The type of entity to tag.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of the entity to tag.',
        },
        tag_name: {
          type: 'string',
          description:
            'Name of the tag to attach (case-insensitive). Created if it does not exist.',
        },
      },
      required: ['entity_type', 'entity_id', 'tag_name'],
    },
  },
  {
    name: 'detachTag',
    description:
      'Remove a tag from a CRM record (contact, account, deal, or lead) by tag UUID. Use listTags to find the tag UUID. Always call requestMutationConfirmation first.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'The type of entity to untag.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of the entity to untag.',
        },
        tag_id: {
          type: 'string',
          description: 'UUID of the tag to detach.',
        },
      },
      required: ['entity_type', 'entity_id', 'tag_id'],
    },
  },
  {
    name: 'renameTag',
    description:
      'Rename a tag across all CRM entities. The rename propagates everywhere the tag is used. Returns the affected count per entity type in the confirmation summary. Always call requestMutationConfirmation first, passing the per-entity counts in the summary field so the user knows the scope of the change.',
    input_schema: {
      type: 'object',
      properties: {
        current_name: {
          type: 'string',
          description: 'Current tag name (case-insensitive lookup).',
        },
        new_name: {
          type: 'string',
          description: 'New tag name to apply.',
        },
      },
      required: ['current_name', 'new_name'],
    },
  },
];
