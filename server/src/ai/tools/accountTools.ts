/**
 * NLI tool definitions for the Account entity.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const accountTools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchAccounts',
    description:
      'Search and filter company accounts in the CRM. Returns a paginated list. Use this to find accounts by name, industry, type, or tags.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Full-text search across account name, website, and description.',
        },
        account_type: {
          type: 'string',
          enum: ['Prospect', 'Customer', 'Partner', 'Vendor', 'Competitor', 'Other'],
          description: 'Filter by account type.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to accounts owned by a specific user ID.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Filter accounts that have ALL of these tag UUIDs (use listTags to find IDs).',
        },
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
        sort_by: {
          type: 'string',
          enum: ['created_at', 'name'],
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
    name: 'getAccount',
    description:
      'Retrieve a single account record by UUID, including child accounts, contacts, and custom fields.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the account.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'createAccount',
    description: 'Create a new company account in the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Account / company name.' },
        account_type: {
          type: 'string',
          enum: ['Prospect', 'Customer', 'Partner', 'Vendor', 'Competitor', 'Other'],
          description: 'Account type (case-sensitive).',
        },
        website: { type: 'string', description: 'Company website URL.' },
        industry: { type: 'string', description: 'Industry vertical.' },
        parent_account_id: {
          type: 'string',
          description: 'UUID of a parent account for hierarchical accounts.',
        },
        owner_id: {
          type: 'string',
          description: 'UUID of the owning user. Defaults to the calling user.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'updateAccount',
    description: 'Update fields on an existing account. Only the provided fields are changed.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the account to update.' },
        name: { type: 'string' },
        account_type: {
          type: 'string',
          enum: ['Prospect', 'Customer', 'Partner', 'Vendor', 'Competitor', 'Other'],
        },
        website: { type: 'string' },
        industry: { type: 'string' },
        parent_account_id: { type: 'string' },
        owner_id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'deleteAccount',
    description: 'Permanently delete an account and its associated data. This cannot be undone.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the account to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'getAccountChurnExpansionSignal',
    description:
      'Returns the AI-inferred churn risk or expansion opportunity signal for a single closed-won account, from the nightly churn/expansion detection run. AI-inferred, not factual — present as a signal, not certainty. (MINCRM-469)',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the account.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'getAtRiskAndExpansionAccounts',
    description:
      'Returns the cached results of the nightly AI churn/expansion detection run — all closed-won accounts currently flagged as at-risk of churn or as expansion opportunities. Does not trigger a new analysis; always serves the latest cached run. (MINCRM-469)',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
