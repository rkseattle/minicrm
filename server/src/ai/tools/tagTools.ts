/**
 * NLI tool definitions for Tags. (MINCRM-422)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const tagTools: Anthropic.Messages.Tool[] = [
  {
    name: 'listTags',
    description:
      'List all available tags in the CRM. Use this to discover what tags exist before filtering records by tag.',
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
      'Attach a tag to a CRM record (contact, account, or deal) by tag name. The tag will be created if it does not already exist.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal'],
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
    description: 'Remove a tag from a CRM record by tag UUID. Use listTags to find the tag UUID.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal'],
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
];
