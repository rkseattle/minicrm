/**
 * NLI tool definitions for Activities and Tasks. (MINCRM-422)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const activityTools: Anthropic.Messages.Tool[] = [
  {
    name: 'searchActivities',
    description:
      'Search and filter activities (calls, meetings, tasks, emails) in the CRM. Returns a paginated list.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Full-text search across activity subject and notes.',
        },
        activity_type: {
          type: 'string',
          enum: ['call', 'meeting', 'email', 'task', 'note'],
          description: 'Filter by activity type.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'completed', 'cancelled'],
          description: 'Filter by activity status.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to activities owned by a specific user ID.',
        },
        contact_id: {
          type: 'string',
          description: 'Filter to activities linked to a specific contact.',
        },
        account_id: {
          type: 'string',
          description: 'Filter to activities linked to a specific account.',
        },
        deal_id: {
          type: 'string',
          description: 'Filter to activities linked to a specific deal.',
        },
        due_date_from: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). Filter to activities due on or after this date.',
        },
        due_date_to: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). Filter to activities due on or before this date.',
        },
        page: { type: 'number', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'number', description: 'Results per page (1–100). Defaults to 20.' },
        sort_by: {
          type: 'string',
          enum: ['created_at', 'updated_at', 'due_date', 'subject'],
          description: 'Field to sort by. Defaults to due_date.',
        },
        sort_dir: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction. Defaults to asc.',
        },
      },
      required: [],
    },
  },
  {
    name: 'getActivity',
    description: 'Retrieve a single activity or task by UUID.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the activity.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'createActivity',
    description: 'Log a new activity (call, meeting, email, task) in the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Activity subject or title.' },
        activity_type: {
          type: 'string',
          enum: ['call', 'meeting', 'email', 'task', 'note'],
          description: 'Type of activity.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'completed'],
          description: 'Activity status. Defaults to pending.',
        },
        due_date: { type: 'string', description: 'Due date/time in ISO 8601 format.' },
        duration_minutes: {
          type: 'number',
          description: 'Duration in minutes (for calls and meetings).',
        },
        notes: { type: 'string', description: 'Activity notes or description.' },
        contact_id: { type: 'string', description: 'UUID of a contact to link.' },
        account_id: { type: 'string', description: 'UUID of an account to link.' },
        deal_id: { type: 'string', description: 'UUID of a deal to link.' },
        owner_id: {
          type: 'string',
          description: 'UUID of the owning user. Defaults to the calling user.',
        },
      },
      required: ['subject', 'activity_type'],
    },
  },
  {
    name: 'updateActivity',
    description:
      'Update fields on an existing activity. Use this to mark a task as completed or reschedule it.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the activity to update.' },
        subject: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'completed', 'cancelled'],
        },
        due_date: { type: 'string' },
        duration_minutes: { type: 'number' },
        notes: { type: 'string' },
        contact_id: { type: 'string' },
        account_id: { type: 'string' },
        deal_id: { type: 'string' },
        owner_id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'deleteActivity',
    description: 'Permanently delete an activity record. This cannot be undone.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the activity to delete.' },
      },
      required: ['id'],
    },
  },
];
