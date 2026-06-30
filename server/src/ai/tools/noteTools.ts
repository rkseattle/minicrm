/**
 * NLI tool definitions for Notes. (MINCRM-422, MINCRM-432)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const noteTools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchNotes',
    description:
      'Search notes across all CRM records or scoped to a specific entity. Supports keyword search, filtering by author, date range, and entity association. Returns a paginated list — plain-text body is returned for AI consumption. All parameters are optional; omit entity_type/entity_id to search across all entities.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'Narrow to notes on this entity type. Omit to search across all types.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of a specific entity to fetch notes for. Requires entity_type.',
        },
        keyword: {
          type: 'string',
          description: 'Full-text search across note body content.',
        },
        author_id: {
          type: 'string',
          description:
            'UUID of the user who created the notes. Use this to find notes by a specific rep.',
        },
        date_from: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Return notes created on or after this date.',
        },
        date_to: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Return notes created on or before this date.',
        },
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
      },
      required: [],
    },
  },
  {
    name: 'getNote',
    description:
      'Retrieve a single note by UUID. You must supply the entity_type and entity_id of the record the note belongs to.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the note.' },
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'The type of entity the note belongs to.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of the entity the note belongs to.',
        },
      },
      required: ['id', 'entity_type', 'entity_id'],
    },
  },
  {
    name: 'createNote',
    description: 'Create a new note on a CRM record (contact, account, deal, or lead).',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'The type of entity to attach this note to.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of the entity to attach this note to.',
        },
        body: {
          type: 'string',
          description: 'Plain-text note content.',
        },
        visibility: {
          type: 'string',
          enum: ['private', 'team'],
          description: 'Who can see the note. Defaults to team.',
        },
      },
      required: ['entity_type', 'entity_id', 'body'],
    },
  },
  {
    name: 'updateNote',
    description:
      'Update the body or visibility of an existing note. You must supply the entity_type and entity_id of the record the note belongs to.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the note to update.' },
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'The type of entity the note belongs to.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of the entity the note belongs to.',
        },
        body: { type: 'string', description: 'New plain-text note content.' },
        visibility: {
          type: 'string',
          enum: ['private', 'team'],
        },
      },
      required: ['id', 'entity_type', 'entity_id'],
    },
  },
  {
    name: 'deleteNote',
    description:
      'Soft-delete a note (marks it as deleted; not permanently removed). You must supply the entity_type and entity_id of the record the note belongs to.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the note to delete.' },
        entity_type: {
          type: 'string',
          enum: ['contact', 'account', 'deal', 'lead'],
          description: 'The type of entity the note belongs to.',
        },
        entity_id: {
          type: 'string',
          description: 'UUID of the entity the note belongs to.',
        },
      },
      required: ['id', 'entity_type', 'entity_id'],
    },
  },
];
