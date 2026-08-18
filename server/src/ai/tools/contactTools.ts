/**
 * NLI tool definitions for the Contact entity.
 * Pure schema declarations — no business logic.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const contactTools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchContacts',
    description:
      'Search and filter contacts in the CRM. Returns a paginated list. Use this to find contacts by name, email, company, tags, or other attributes.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Full-text search across name, email, phone, and company fields.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to contacts owned by a specific user ID.',
        },
        account_id: {
          type: 'string',
          description: 'Filter to contacts belonging to a specific account.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter contacts that have ALL of these tag UUIDs (use listTags to find IDs).',
        },
        page: {
          type: 'number',
          description: 'Page number (1-based). Defaults to 1.',
        },
        limit: {
          type: 'number',
          description: 'Results per page (1–100). Defaults to 20.',
        },
        sort_by: {
          type: 'string',
          enum: ['created_at', 'first_name', 'last_name', 'email'],
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
    name: 'getContact',
    description:
      'Retrieve a single contact record by its UUID, including custom field values and tags.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'UUID of the contact.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'createContact',
    description: 'Create a new contact record in the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'Contact first name.' },
        last_name: { type: 'string', description: 'Contact last name.' },
        email: { type: 'string', description: 'Primary email address.' },
        phone: { type: 'string', description: 'Phone number.' },
        company: { type: 'string', description: 'Company or organisation name.' },
        title: { type: 'string', description: 'Job title.' },
        account_id: { type: 'string', description: 'UUID of the account to associate.' },
        owner_id: {
          type: 'string',
          description: 'UUID of the user who owns this contact. Defaults to the calling user.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tag names to attach on creation.',
        },
      },
      required: ['first_name'],
    },
  },
  {
    name: 'updateContact',
    description: 'Update fields on an existing contact. Only the provided fields are changed.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the contact to update.' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        title: { type: 'string' },
        account_id: { type: 'string' },
        owner_id: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replaces ALL current tags on the contact.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'deleteContact',
    description: 'Permanently delete a contact and its associated data. This cannot be undone.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the contact to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'getContactChampionBlockerStatus',
    description:
      'Returns the AI-inferred champion/blocker classification for a contact (champion, likely_champion, neutral, likely_blocker, blocker), based on language patterns detected in activity notes. Clearly AI-inferred, not factual — present it as a signal, not a certainty. (MINCRM-466)',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the contact.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'findWarmIntroPaths',
    description:
      "Finds ranked warm introduction paths to a target contact through the requesting rep's own contact network (Rep -> Known Contact -> Target Contact, max 2 hops), based on shared accounts, shared deals, and notes mentions. Each path includes a suggested introduction message. Read-only — no automated outreach is sent. Returns an empty paths array when no path exists. (MINCRM-468)",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the target contact.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'getFollowUpTiming',
    description:
      'Returns the AI-suggested best day-of-week and time-of-day window to follow up with a contact, derived from their historical interaction pattern (e.g. "When should I follow up with Sarah at Acme?"). Requires at least 5 logged interactions with the contact — returns null when there is insufficient data. (MINCRM-470)',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the contact.' },
      },
      required: ['id'],
    },
  },
];
