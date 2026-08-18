/**
 * NLI tool definitions for the Lead entity.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const leadTools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchLeads',
    description:
      'Search and filter leads in the CRM. Returns a paginated list. Use this to find leads by status or source.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['New', 'Contacted', 'Qualified', 'Disqualified'],
          description: 'Filter by lead status (case-sensitive).',
        },
        source: {
          type: 'string',
          enum: ['Web', 'Referral', 'Trade Show', 'Cold Outreach', 'Other'],
          description: 'Filter by lead source.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to leads owned by a specific user ID.',
        },
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
        sort_by: {
          type: 'string',
          enum: ['created_at', 'first_name', 'last_name', 'email', 'company_name', 'status'],
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
    name: 'getLead',
    description:
      'Retrieve a single lead record by UUID, including status history and custom field values.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the lead.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'createLead',
    description: 'Create a new lead record in the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'Lead first name.' },
        last_name: { type: 'string', description: 'Lead last name (optional on leads).' },
        email: { type: 'string', description: 'Primary email address (required).' },
        phone: { type: 'string', description: 'Phone number.' },
        company: { type: 'string', description: 'Company name.' },
        source: {
          type: 'string',
          enum: ['Web', 'Referral', 'Trade Show', 'Cold Outreach', 'Other'],
          description: 'Lead source.',
        },
        notes: { type: 'string', description: 'Any notes about the lead.' },
        owner_id: {
          type: 'string',
          description: 'UUID of the owning user. Defaults to the calling user.',
        },
      },
      required: ['first_name', 'email'],
    },
  },
  {
    name: 'updateLead',
    description: 'Update fields on an existing lead. Only the provided fields are changed.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the lead to update.' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        source: {
          type: 'string',
          enum: ['Web', 'Referral', 'Trade Show', 'Cold Outreach', 'Other'],
        },
        status: {
          type: 'string',
          enum: ['New', 'Contacted', 'Qualified', 'Disqualified'],
          description: 'Lead status (case-sensitive).',
        },
        notes: { type: 'string' },
        owner_id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'deleteLead',
    description: 'Permanently delete a lead record. This cannot be undone.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the lead to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'convertLead',
    description:
      "Convert a qualified lead into a Contact, Account, and Deal. Always creates all three records. Returns IDs of the newly created records. The lead's first_name and email are carried over to the new contact automatically.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the lead to convert.' },
        contact_last_name: {
          type: 'string',
          description:
            'Last name for the new Contact (required — leads may have a nullable last_name).',
        },
        contact_email: {
          type: 'string',
          description: "Email for the new Contact. Defaults to the lead's email.",
        },
        deal_name: {
          type: 'string',
          description: 'Name for the new Deal (required). Example: "Acme Corp - New Business".',
        },
        deal_amount: { type: 'number', description: 'Deal value.' },
        close_date: { type: 'string', description: 'Expected close date (YYYY-MM-DD).' },
        create_account: {
          type: 'boolean',
          description:
            "Create a new Account from the lead's company name (true) or link to an existing one (false, requires account_id).",
        },
        account_name: {
          type: 'string',
          description: 'Name for the new Account (required when create_account is true).',
        },
        account_id: {
          type: 'string',
          description:
            'UUID of an existing Account to link (required when create_account is false).',
        },
      },
      required: ['id', 'contact_last_name', 'deal_name'],
    },
  },
];
