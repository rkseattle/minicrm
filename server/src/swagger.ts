/**
 * Swagger / OpenAPI configuration.
 *
 * Builds the OpenAPI 3.0 spec from JSDoc annotations in the route files and
 * exposes a helper to mount Swagger UI on an Express application.
 *
 * Mounted only for a recognized non-production environment — development,
 * test, or staging. See server/src/utils/nodeEnv.ts.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';
import { PASSWORD_MIN_LENGTH } from '@minicrm/shared/schemas/userSchema.js';
import { WEBHOOK_EVENT_TYPES } from '@minicrm/shared/schemas/webhookSchema.js';
import { NAV_LAYOUTS } from '@minicrm/shared/schemas/settingsSchema.js';
import { LEAD_SOURCES, LEAD_STATUSES } from '@minicrm/shared/schemas/leadSchema.js';
import {
  LEAD_ROUTING_CONFIDENCE_LEVELS,
  LEAD_ROUTING_FACTOR_TYPES,
} from '@minicrm/shared/schemas/leadRoutingSchema.js';
import { FEATURE_FLAG_CATEGORIES } from '@minicrm/shared/schemas/featureFlagSchema.js';
import {
  AUTOMATION_TRIGGER_TYPES,
  AUTOMATION_ACTION_TYPES,
} from '@minicrm/shared/schemas/automationSchema.js';

/** Derived from the schema that enforces it, so the two cannot drift. */
const PASSWORD_POLICY_DESCRIPTION = `At least ${PASSWORD_MIN_LENGTH} characters, one letter, one number, and one special character`;

/** Examples must satisfy the policy — a rejected example is a broken doc. */
const EXAMPLE_PASSWORD = 'Str0ng!Passphrase';
const EXAMPLE_PRIOR_PASSWORD = 'Prev10us!Passphrase';

/** Base URL path where Swagger UI is served. */
export const SWAGGER_UI_PATH = '/api-docs';

/**
 * OpenAPI component schemas derived from the shared Zod schema definitions.
 * Keeping them here (rather than duplicating in each route annotation) means
 * a single change point when a schema evolves.
 */
const componentSchemas = {
  // ── Error ──────────────────────────────────────────────────────────────────
  ErrorResponse: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string', example: 'First name is required' },
        },
      },
    },
  },

  // ── Tags ───────────────────────────────────────────────────────────────────
  // Mirrors tagResponseSchema in shared/schemas/tagSchema.ts.
  Tag: {
    type: 'object',
    required: ['id', 'name', 'created_at', 'updated_at'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'enterprise' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'admin@example.com' },
      password: { type: 'string', minLength: 1, example: 'Secret123' },
    },
  },
  LoginResponse: {
    type: 'object',
    properties: {
      user: { $ref: '#/components/schemas/User' },
      mustChangePassword: {
        type: 'boolean',
        example: false,
        description:
          'Intentional camelCase exception — all other response fields use snake_case. True when the user must change their password before using the app.',
      },
    },
  },
  ChangePasswordRequest: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: {
        type: 'string',
        example: EXAMPLE_PRIOR_PASSWORD,
        description: 'Intentional camelCase exception — all other request fields use snake_case.',
      },
      newPassword: {
        type: 'string',
        minLength: PASSWORD_MIN_LENGTH,
        description: `${PASSWORD_POLICY_DESCRIPTION}. Intentional camelCase exception — all other request fields use snake_case.`,
        example: EXAMPLE_PASSWORD,
      },
    },
  },

  // ── User ───────────────────────────────────────────────────────────────────
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'u1b2c3d4-0000-0000-0000-000000000001' },
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      name: { type: 'string', example: 'Jane Smith' },
      role: {
        type: 'string',
        enum: ['admin', 'rep', 'manager', 'viewer', 'service_account'],
        example: 'rep',
      },
      status: { type: 'string', enum: ['active', 'invited', 'inactive'], example: 'active' },
      must_change_password: { type: 'boolean', example: false },
      preferred_language: {
        type: 'string',
        enum: ['en', 'zh-Hans', 'es', 'fr', 'de'],
        nullable: true,
        example: 'en',
      },
      created_at: {
        type: 'string',
        format: 'date-time',
        example: '2025-03-15T09:00:00.000Z',
      },
    },
  },
  InviteUserRequest: {
    type: 'object',
    required: ['email', 'name', 'role'],
    properties: {
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      name: { type: 'string', example: 'Jane Smith' },
      role: {
        type: 'string',
        enum: ['admin', 'rep', 'manager', 'viewer', 'service_account'],
        example: 'rep',
      },
    },
  },
  SetPasswordRequest: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: {
        type: 'string',
        description: 'Invite JWT token from email',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
      password: {
        type: 'string',
        minLength: PASSWORD_MIN_LENGTH,
        description: PASSWORD_POLICY_DESCRIPTION,
        example: EXAMPLE_PASSWORD,
      },
    },
  },
  AdminSetPasswordRequest: {
    type: 'object',
    required: ['password'],
    properties: {
      password: {
        type: 'string',
        minLength: PASSWORD_MIN_LENGTH,
        description: PASSWORD_POLICY_DESCRIPTION,
        example: EXAMPLE_PASSWORD,
      },
    },
  },
  UpdateRoleRequest: {
    type: 'object',
    required: ['role'],
    properties: {
      role: {
        type: 'string',
        enum: ['admin', 'rep', 'manager', 'viewer', 'service_account'],
        example: 'admin',
      },
    },
  },
  UpdateLanguageRequest: {
    type: 'object',
    required: ['language'],
    properties: {
      language: {
        type: 'string',
        enum: ['en', 'zh-Hans', 'es', 'fr', 'de'],
        nullable: true,
        description: 'null clears the preference and falls back to the system default',
        example: 'fr',
      },
    },
  },

  // ── Contact ────────────────────────────────────────────────────────────────
  Contact: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'c1d2e3f4-0000-0000-0000-000000000001' },
      first_name: { type: 'string', example: 'Jane' },
      last_name: { type: 'string', example: 'Smith' },
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      phone: { type: 'string', nullable: true, example: '+1-415-555-0192' },
      title: { type: 'string', nullable: true, example: 'VP of Engineering' },
      department: { type: 'string', nullable: true, example: 'Engineering' },
      account_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  CreateContactRequest: {
    type: 'object',
    required: ['first_name', 'last_name', 'email'],
    properties: {
      first_name: { type: 'string', minLength: 1, example: 'Jane' },
      last_name: { type: 'string', minLength: 1, example: 'Smith' },
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      phone: { type: 'string', example: '+1-415-555-0192' },
      title: { type: 'string', example: 'VP of Engineering' },
      department: { type: 'string', example: 'Engineering' },
      account_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
    },
  },
  UpdateContactRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      first_name: { type: 'string', minLength: 1, example: 'Jane' },
      last_name: { type: 'string', minLength: 1, example: 'Smith' },
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      phone: { type: 'string', example: '+1-415-555-0192' },
      title: { type: 'string', example: 'VP of Engineering' },
      department: { type: 'string', example: 'Engineering' },
      account_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
    },
  },

  // ── Account ────────────────────────────────────────────────────────────────
  Account: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
      name: { type: 'string', example: 'Acme Corp' },
      industry: { type: 'string', nullable: true, example: 'Technology' },
      website: {
        type: 'string',
        format: 'uri',
        nullable: true,
        example: 'https://www.acme.com',
      },
      employee_range: { type: 'string', nullable: true, example: '51-200' },
      revenue_range: { type: 'string', nullable: true, example: '$10M-$50M' },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  CreateAccountRequest: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, example: 'Acme Corp' },
      industry: { type: 'string', example: 'Technology' },
      website: { type: 'string', format: 'uri', example: 'https://www.acme.com' },
      employee_range: { type: 'string', example: '51-200' },
      revenue_range: { type: 'string', example: '$10M-$50M' },
    },
  },
  UpdateAccountRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      name: { type: 'string', minLength: 1, example: 'Acme Corp' },
      industry: { type: 'string', example: 'Technology' },
      website: { type: 'string', format: 'uri', example: 'https://www.acme.com' },
      employee_range: { type: 'string', example: '51-200' },
      revenue_range: { type: 'string', example: '$10M-$50M' },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
    },
  },

  // ── Deal ───────────────────────────────────────────────────────────────────
  Deal: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'd1e2f3a4-0000-0000-0000-000000000001' },
      name: { type: 'string', example: 'Acme Renewal' },
      stage: {
        type: 'string',
        enum: [
          'Prospecting',
          'Qualification',
          'Proposal',
          'Negotiation',
          'Closed Won',
          'Closed Lost',
        ],
        example: 'Proposal',
      },
      value: {
        type: 'string',
        nullable: true,
        example: '12500.00',
        description:
          'PostgreSQL returns numeric columns as strings. Coerce to a number before arithmetic operations.',
      },
      close_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'YYYY-MM-DD format',
        example: '2025-12-31',
      },
      loss_reason: { type: 'string', nullable: true, example: null },
      account_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  CreateDealRequest: {
    type: 'object',
    required: ['name', 'stage'],
    properties: {
      name: { type: 'string', minLength: 1, example: 'Acme Renewal' },
      stage: {
        type: 'string',
        enum: [
          'Prospecting',
          'Qualification',
          'Proposal',
          'Negotiation',
          'Closed Won',
          'Closed Lost',
        ],
        example: 'Proposal',
      },
      value: {
        type: 'number',
        minimum: 0,
        example: 12500,
        description:
          'Send as a number; the stored representation is returned as a string by PostgreSQL.',
      },
      close_date: {
        type: 'string',
        format: 'date',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        example: '2025-12-31',
      },
      account_id: {
        type: 'string',
        format: 'uuid',
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
    },
  },
  UpdateDealRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      name: { type: 'string', minLength: 1, example: 'Acme Renewal' },
      stage: {
        type: 'string',
        enum: [
          'Prospecting',
          'Qualification',
          'Proposal',
          'Negotiation',
          'Closed Won',
          'Closed Lost',
        ],
        example: 'Negotiation',
      },
      value: {
        type: 'number',
        minimum: 0,
        nullable: true,
        example: 12500,
        description:
          'Send as a number; the stored representation is returned as a string by PostgreSQL.',
      },
      close_date: {
        type: 'string',
        format: 'date',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        nullable: true,
        example: '2025-12-31',
      },
      loss_reason: { type: 'string', nullable: true, example: 'Budget constraints' },
      account_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
    },
  },

  // ── Activity ───────────────────────────────────────────────────────────────
  Activity: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'ac1b2c3d-0000-0000-0000-000000000001' },
      type: {
        type: 'string',
        enum: ['Note', 'Call', 'Email', 'Meeting', 'Task'],
        example: 'Call',
      },
      subject: { type: 'string', example: 'Discovery Call' },
      notes: { type: 'string', nullable: true, example: 'Discussed renewal pricing options.' },
      due_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'YYYY-MM-DD format',
        example: '2025-04-01',
      },
      status: { type: 'string', enum: ['open', 'complete'], example: 'open' },
      contact_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'c1d2e3f4-0000-0000-0000-000000000001',
      },
      account_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
      deal_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'd1e2f3a4-0000-0000-0000-000000000001',
      },
      owner_id: {
        type: 'string',
        format: 'uuid',
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  CreateActivityRequest: {
    type: 'object',
    required: ['type', 'subject'],
    description: 'At least one of contact_id, account_id, or deal_id must be provided',
    properties: {
      type: {
        type: 'string',
        enum: ['Note', 'Call', 'Email', 'Meeting', 'Task'],
        example: 'Call',
      },
      subject: { type: 'string', minLength: 1, example: 'Discovery Call' },
      notes: { type: 'string', example: 'Discussed renewal pricing options.' },
      due_date: {
        type: 'string',
        format: 'date',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        example: '2025-04-01',
      },
      contact_id: {
        type: 'string',
        format: 'uuid',
        example: 'c1d2e3f4-0000-0000-0000-000000000001',
      },
      account_id: {
        type: 'string',
        format: 'uuid',
        example: 'a1b2c3d4-0000-0000-0000-000000000001',
      },
      deal_id: {
        type: 'string',
        format: 'uuid',
        example: 'd1e2f3a4-0000-0000-0000-000000000001',
      },
    },
  },
  UpdateActivityRequest: {
    type: 'object',
    description: 'At least one field must be provided. Parent IDs cannot be changed.',
    properties: {
      type: {
        type: 'string',
        enum: ['Note', 'Call', 'Email', 'Meeting', 'Task'],
        example: 'Call',
      },
      subject: { type: 'string', minLength: 1, example: 'Discovery Call — Follow Up' },
      notes: {
        type: 'string',
        nullable: true,
        example: 'Sent revised pricing proposal after the call.',
      },
      due_date: {
        type: 'string',
        format: 'date',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        nullable: true,
        example: '2025-04-15',
      },
      status: { type: 'string', enum: ['open', 'complete'], example: 'complete' },
    },
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────
  DashboardSummary: {
    type: 'object',
    properties: {
      pipeline: {
        type: 'object',
        description: 'Deal counts and total values grouped by stage',
        additionalProperties: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            total_value: { type: 'number' },
          },
        },
      },
      tasks: {
        type: 'object',
        properties: {
          open_count: { type: 'integer' },
          overdue_count: { type: 'integer' },
        },
      },
    },
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  DefaultLanguageResponse: {
    type: 'object',
    required: ['language'],
    properties: {
      language: {
        type: 'string',
        enum: ['en', 'zh-Hans', 'es', 'fr', 'de'],
        example: 'en',
      },
    },
  },
  SetDefaultLanguageRequest: {
    type: 'object',
    required: ['language'],
    properties: {
      language: {
        type: 'string',
        enum: ['en', 'zh-Hans', 'es', 'fr', 'de'],
        example: 'en',
      },
    },
  },

  // ── Team ─────────────────────────────────────────────────────
  Team: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 't1b2c3d4-0000-0000-0000-000000000001' },
      name: { type: 'string', example: 'West Coast Sales' },
      manager_id: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: 'u1b2c3d4-0000-0000-0000-000000000001',
      },
      manager_name: { type: 'string', nullable: true, example: 'Jane Smith' },
      parent_team_id: { type: 'string', format: 'uuid', nullable: true, example: null },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  TeamMember: {
    type: 'object',
    properties: {
      team_id: { type: 'string', format: 'uuid', example: 't1b2c3d4-0000-0000-0000-000000000001' },
      user_id: { type: 'string', format: 'uuid', example: 'u1b2c3d4-0000-0000-0000-000000000001' },
      user_name: { type: 'string', example: 'Jane Smith' },
      user_email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      role: { type: 'string', enum: ['lead', 'member'], example: 'member' },
    },
  },
  CreateTeamRequest: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, example: 'West Coast Sales' },
      manager_id: { type: 'string', format: 'uuid', nullable: true, example: null },
      parent_team_id: { type: 'string', format: 'uuid', nullable: true, example: null },
    },
  },
  UpdateTeamRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      name: { type: 'string', minLength: 1, example: 'West Coast Sales' },
      manager_id: { type: 'string', format: 'uuid', nullable: true, example: null },
      parent_team_id: { type: 'string', format: 'uuid', nullable: true, example: null },
    },
  },
  AddTeamMemberRequest: {
    type: 'object',
    required: ['user_id', 'role'],
    properties: {
      user_id: { type: 'string', format: 'uuid', example: 'u1b2c3d4-0000-0000-0000-000000000001' },
      role: { type: 'string', enum: ['lead', 'member'], example: 'member' },
    },
  },

  // ── Bulk operations ──────────────────────────────────────────
  // Mirrors BulkV2Result in server/src/services/bulkV2Service.ts.
  BulkV2Result: {
    type: 'object',
    required: ['succeeded', 'failed'],
    description: 'Per-record outcome — a failed record does not roll back the others',
    properties: {
      succeeded: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
      },
      failed: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'reason'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            reason: { type: 'string', example: 'Not found' },
          },
        },
      },
    },
  },

  // ── Webhooks ─────────────────────────────────────────────────
  // Mirrors webhookSubscriptionResponseSchema in shared/schemas/webhookSchema.ts.
  WebhookSubscription: {
    type: 'object',
    required: ['id', 'url', 'events', 'status', 'created_by', 'created_at'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      url: { type: 'string', format: 'uri', example: 'https://hooks.example.com/minicrm' },
      events: {
        type: 'array',
        items: { type: 'string', example: 'deal.won' },
      },
      status: { type: 'string', enum: ['active', 'failed', 'disabled'], example: 'active' },
      created_by: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  // Mirrors createWebhookSubscriptionSchema in shared/schemas/webhookSchema.ts.
  CreateWebhookSubscriptionRequest: {
    type: 'object',
    required: ['url', 'events'],
    properties: {
      url: { type: 'string', format: 'uri', example: 'https://hooks.example.com/minicrm' },
      events: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'string',
          enum: [...WEBHOOK_EVENT_TYPES],
        },
        example: ['deal.won', 'deal.lost'],
      },
    },
  },

  // ── Navigation ───────────────────────────────────────────────
  // Mirrors navLayoutResponseSchema in shared/schemas/settingsSchema.ts.
  NavLayoutResponse: {
    type: 'object',
    required: ['layout'],
    properties: {
      layout: { type: 'string', enum: [...NAV_LAYOUTS], example: 'top' },
    },
  },
  // Mirrors setNavLayoutSchema in shared/schemas/settingsSchema.ts.
  SetNavLayoutRequest: {
    type: 'object',
    required: ['layout'],
    properties: {
      layout: { type: 'string', enum: [...NAV_LAYOUTS], example: 'left' },
    },
  },

  // ── Pipelines ────────────────────────────────────────────────
  // Mirrors pipelineResponseSchema in shared/schemas/pipelineSchema.ts.
  PipelineResponse: {
    type: 'object',
    required: ['id', 'name', 'is_default', 'created_at', 'updated_at'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Enterprise Sales' },
      is_default: { type: 'boolean', example: true },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  // Mirrors pipelineStageResponseSchema in shared/schemas/pipelineStageSchema.ts.
  PipelineStageResponse: {
    type: 'object',
    required: [
      'id',
      'pipeline_id',
      'name',
      'sort_order',
      'probability',
      'is_terminal',
      'is_fixed',
      'stage_exit_requirements',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      pipeline_id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Negotiation' },
      sort_order: { type: 'integer', example: 30 },
      probability: { type: 'integer', minimum: 0, maximum: 100, example: 60 },
      is_terminal: { type: 'boolean', example: false },
      is_fixed: { type: 'boolean', example: false },
      stage_exit_requirements: {
        type: 'object',
        required: ['required_fields', 'warning_fields'],
        description:
          'Data quality gates — required_fields block the transition, warning_fields do not',
        properties: {
          required_fields: { type: 'array', items: { type: 'string' }, example: ['value'] },
          warning_fields: { type: 'array', items: { type: 'string' }, example: ['close_date'] },
        },
      },
    },
  },

  // ── Reports ──────────────────────────────────────────────────
  // Mirrors WinLossReport in server/src/services/reportService.ts.
  WinLossReport: {
    type: 'object',
    required: [
      'wonCount',
      'wonValue',
      'lostCount',
      'lostValue',
      'winRate',
      'lossReasonBreakdown',
      'mixedCurrencies',
      'currency',
      'convertedWonValue',
      'convertedLostValue',
      'homeCurrency',
      'homeSymbol',
      'unratedCount',
      'ratesLastUpdated',
      'hasRates',
      'repRows',
    ],
    properties: {
      wonCount: { type: 'integer', example: 5 },
      wonValue: { type: 'string', example: '87000.00' },
      lostCount: { type: 'integer', example: 2 },
      lostValue: { type: 'string', example: '30000.00' },
      winRate: {
        type: 'number',
        nullable: true,
        example: 0.714,
        description: 'Won / total closed, 0–1. Null when no deals closed in the range.',
      },
      lossReasonBreakdown: {
        type: 'array',
        items: {
          type: 'object',
          required: ['reason', 'count'],
          properties: {
            reason: { type: 'string', example: 'Price too high' },
            count: { type: 'integer', example: 1 },
          },
        },
      },
      mixedCurrencies: { type: 'boolean', example: false },
      currency: { type: 'string', nullable: true, example: 'USD' },
      convertedWonValue: { type: 'string', nullable: true, example: '87000.00' },
      convertedLostValue: { type: 'string', nullable: true, example: '30000.00' },
      homeCurrency: { type: 'string', nullable: true, example: 'USD' },
      homeSymbol: { type: 'string', nullable: true, example: '$' },
      unratedCount: { type: 'integer', example: 0 },
      ratesLastUpdated: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        example: '2025-03-15T09:00:00.000Z',
      },
      hasRates: { type: 'boolean', example: true },
      repRows: {
        type: 'array',
        description: 'Populated only on the team-wide view; empty when filtered to one owner',
        items: {
          type: 'object',
          required: [
            'ownerId',
            'ownerName',
            'wonCount',
            'wonValue',
            'lostCount',
            'lostValue',
            'winRate',
          ],
          properties: {
            ownerId: { type: 'string', format: 'uuid' },
            ownerName: { type: 'string', example: 'Jane Smith' },
            wonCount: { type: 'integer', example: 3 },
            wonValue: { type: 'string', example: '52000.00' },
            lostCount: { type: 'integer', example: 1 },
            lostValue: { type: 'string', example: '12000.00' },
            winRate: { type: 'number', nullable: true, example: 0.75 },
          },
        },
      },
    },
  },
  // Mirrors ActivityVolumeReport in server/src/services/reportService.ts.
  ActivityVolumeReport: {
    type: 'object',
    required: ['rows', 'totals'],
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['ownerId', 'ownerName', 'counts', 'total'],
          properties: {
            ownerId: { type: 'string', format: 'uuid' },
            ownerName: { type: 'string', example: 'Jane Smith' },
            counts: { $ref: '#/components/schemas/ActivityTypeCounts' },
            total: { type: 'integer', example: 42 },
          },
        },
      },
      totals: {
        allOf: [
          { $ref: '#/components/schemas/ActivityTypeCounts' },
          {
            type: 'object',
            required: ['total'],
            properties: { total: { type: 'integer', example: 120 } },
          },
        ],
      },
    },
  },
  // Mirrors ActivityTypeCounts in server/src/services/reportService.ts.
  ActivityTypeCounts: {
    type: 'object',
    required: ['Note', 'Call', 'Email', 'Meeting', 'Task'],
    properties: {
      Note: { type: 'integer', example: 12 },
      Call: { type: 'integer', example: 8 },
      Email: { type: 'integer', example: 15 },
      Meeting: { type: 'integer', example: 4 },
      Task: { type: 'integer', example: 3 },
    },
  },
  // Mirrors StageTrendReport in server/src/services/reportService.ts.
  StageTrendReport: {
    type: 'object',
    required: ['stages', 'dataPoints', 'windowStart', 'windowEnd'],
    properties: {
      stages: {
        type: 'array',
        description: 'Stage names in pipeline sort_order',
        items: { type: 'string', example: 'Negotiation' },
      },
      dataPoints: {
        type: 'array',
        items: {
          type: 'object',
          required: ['stage', 'period', 'entered', 'converted'],
          properties: {
            stage: { type: 'string', example: 'Negotiation' },
            period: {
              type: 'string',
              format: 'date',
              description: 'Start of the week or month bucket',
              example: '2025-03-03',
            },
            entered: { type: 'integer', example: 9 },
            converted: {
              type: 'integer',
              example: 5,
              description: 'Entered deals that later advanced to any other stage',
            },
          },
        },
      },
      windowStart: { type: 'string', format: 'date', example: '2025-02-15' },
      windowEnd: { type: 'string', format: 'date', example: '2025-03-15' },
    },
  },

  // ── Lead ─────────────────────────────────────────────────────
  // Mirrors createLeadSchema in shared/schemas/leadSchema.ts.
  CreateLeadRequest: {
    type: 'object',
    required: ['first_name', 'email'],
    properties: {
      first_name: { type: 'string', minLength: 1, example: 'Jane' },
      last_name: { type: 'string', example: 'Smith' },
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      phone: { type: 'string', example: '+1-206-555-0100' },
      company_name: { type: 'string', example: 'Acme Corp' },
      lead_source: {
        type: 'string',
        enum: [...LEAD_SOURCES],
        example: 'Referral',
      },
      notes: { type: 'string', example: 'Met at the Seattle trade show' },
      owner_id: { type: 'string', format: 'uuid' },
      territory: { type: 'string', example: 'US-West' },
      industry: { type: 'string', example: 'Manufacturing' },
      employee_range: { type: 'string', example: '51-200' },
      routing_suggestion: {
        type: 'object',
        description: 'Echoes the suggestion the manager saw, to log accept vs override',
        required: ['suggested_rep_id', 'confidence', 'contributing_factors'],
        properties: {
          suggested_rep_id: { type: 'string', format: 'uuid' },
          confidence: {
            type: 'string',
            enum: [...LEAD_ROUTING_CONFIDENCE_LEVELS],
            example: 'high',
          },
          contributing_factors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'description'],
              properties: {
                type: {
                  type: 'string',
                  enum: [...LEAD_ROUTING_FACTOR_TYPES],
                  example: 'territory_match',
                },
                description: { type: 'string', example: 'Rep owns the US-West territory' },
              },
            },
          },
        },
      },
    },
  },
  // Mirrors updateLeadSchema in shared/schemas/leadSchema.ts.
  UpdateLeadRequest: {
    type: 'object',
    description: 'At least one field beyond version must be provided',
    required: ['version'],
    properties: {
      first_name: { type: 'string', minLength: 1, example: 'Jane' },
      last_name: { type: 'string', example: 'Smith' },
      email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
      phone: { type: 'string', example: '+1-206-555-0100' },
      company_name: { type: 'string', example: 'Acme Corp' },
      lead_source: {
        type: 'string',
        enum: [...LEAD_SOURCES],
        example: 'Referral',
      },
      notes: { type: 'string', example: 'Met at the Seattle trade show' },
      owner_id: { type: 'string', format: 'uuid' },
      territory: { type: 'string', example: 'US-West' },
      industry: { type: 'string', example: 'Manufacturing' },
      employee_range: { type: 'string', example: '51-200' },
      status: {
        type: 'string',
        enum: [...LEAD_STATUSES],
        example: 'Qualified',
      },
      disqualification_reason: { type: 'string', nullable: true, example: null },
      version: {
        type: 'integer',
        minimum: 1,
        example: 1,
        description: 'Optimistic lock version — must match the current stored value',
      },
    },
  },
  // Mirrors convertLeadSchema in shared/schemas/leadSchema.ts.
  ConvertLeadRequest: {
    type: 'object',
    required: ['contact', 'account', 'deal'],
    properties: {
      contact: {
        type: 'object',
        required: ['first_name', 'last_name', 'email'],
        properties: {
          first_name: { type: 'string', minLength: 1, example: 'Jane' },
          last_name: {
            type: 'string',
            minLength: 1,
            example: 'Smith',
            description: 'Required here even though it is optional on the lead',
          },
          email: { type: 'string', format: 'email', example: 'jane.smith@acme.com' },
          phone: { type: 'string', example: '+1-206-555-0100' },
        },
      },
      account: {
        oneOf: [
          {
            type: 'object',
            required: ['mode', 'name'],
            properties: {
              mode: { type: 'string', enum: ['create'] },
              name: { type: 'string', minLength: 1, example: 'Acme Corp' },
            },
          },
          {
            type: 'object',
            required: ['mode', 'account_id'],
            properties: {
              mode: { type: 'string', enum: ['link'] },
              account_id: { type: 'string', format: 'uuid' },
            },
          },
        ],
        discriminator: { propertyName: 'mode' },
      },
      deal: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, example: 'Acme Corp — Platform' },
          stage: { type: 'string', example: 'Qualification' },
          value: { type: 'string', example: '25000.00' },
          close_date: { type: 'string', format: 'date', example: '2025-06-30' },
        },
      },
    },
  },

  // ── Feature flags ────────────────────────────────────────────
  // Mirrors FeatureFlagRow in shared/schemas/featureFlagSchema.ts.
  FeatureFlag: {
    type: 'object',
    required: [
      'flag_key',
      'label',
      'description',
      'category',
      'enabled',
      'role_overrides',
      'enable_at',
      'rollout_percentage',
      'rollout_stages',
      'updated_by',
      'updated_by_name',
      'updated_at',
      'system_flag',
      'active_user_count',
      'beta_user_count',
      'override_count',
      'group_key',
    ],
    properties: {
      flag_key: {
        type: 'string',
        description: 'One of FEATURE_FLAG_KEYS in shared/schemas/featureFlagSchema.ts',
        example: 'automation_rules',
      },
      label: { type: 'string', example: 'Automation rules' },
      description: { type: 'string', example: 'Trigger-based rules that create tasks' },
      category: {
        type: 'string',
        enum: [...FEATURE_FLAG_CATEGORIES],
        example: 'Productivity',
      },
      enabled: { type: 'boolean', example: true },
      role_overrides: {
        type: 'object',
        nullable: true,
        description: 'Per-role enable/disable map keyed by role name',
        additionalProperties: { type: 'boolean' },
        example: { rep: false },
      },
      enable_at: {
        type: 'string',
        format: 'date-time',
        nullable: true,
        description: 'When set and in the past, the flag is treated as enabled',
        example: null,
      },
      rollout_percentage: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        nullable: true,
        example: 25,
      },
      rollout_stages: {
        type: 'array',
        nullable: true,
        description: 'Scheduled advancement steps, ascending by scheduled_at',
        items: {
          type: 'object',
          required: ['percentage', 'scheduled_at'],
          properties: {
            percentage: { type: 'integer', minimum: 0, maximum: 100, example: 50 },
            scheduled_at: {
              type: 'string',
              format: 'date-time',
              example: '2025-04-01T09:00:00.000Z',
            },
          },
        },
      },
      updated_by: { type: 'string', format: 'uuid', nullable: true },
      updated_by_name: { type: 'string', nullable: true, example: 'Jane Smith' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      system_flag: { type: 'boolean', example: false },
      active_user_count: {
        type: 'integer',
        example: 17,
        description: 'Distinct users who used the feature in the last 30 days',
      },
      beta_user_count: { type: 'integer', example: 4 },
      override_count: {
        type: 'object',
        required: ['force_enabled', 'force_disabled'],
        properties: {
          force_enabled: { type: 'integer', example: 2 },
          force_disabled: { type: 'integer', example: 1 },
        },
      },
      group_key: { type: 'string', nullable: true, example: 'ai-features' },
    },
  },

  // ── Automation ───────────────────────────────────────────────
  // Mirrors automationRuleResponseSchema in shared/schemas/automationSchema.ts.
  AutomationRule: {
    type: 'object',
    required: [
      'id',
      'name',
      'enabled',
      'trigger_type',
      'trigger_config',
      'action_type',
      'action_config',
      'created_by',
      'created_at',
      'updated_at',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Task on move to Negotiation' },
      enabled: { type: 'boolean', example: true },
      trigger_type: {
        type: 'string',
        enum: [...AUTOMATION_TRIGGER_TYPES],
        example: 'deal_stage_changed',
      },
      trigger_config: {
        type: 'object',
        description: 'Shape depends on trigger_type; validated in the service',
        additionalProperties: true,
        example: { stage: 'Negotiation' },
      },
      action_type: {
        type: 'string',
        enum: [...AUTOMATION_ACTION_TYPES],
        example: 'create_task',
      },
      action_config: {
        type: 'object',
        description: 'Shape depends on action_type; validated in the service',
        additionalProperties: true,
        example: {
          subject: 'Prepare contract',
          task_type: 'Task',
          assignee_type: 'owner',
          due_date_offset_days: 2,
        },
      },
      created_by: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
      updated_at: { type: 'string', format: 'date-time', example: '2025-03-15T09:00:00.000Z' },
    },
  },
  // Mirrors createAutomationRuleSchema in shared/schemas/automationSchema.ts.
  CreateAutomationRuleRequest: {
    type: 'object',
    required: ['name', 'trigger_type', 'action_type', 'action_config'],
    properties: {
      name: { type: 'string', minLength: 1, example: 'Task on move to Negotiation' },
      enabled: { type: 'boolean', default: true, example: true },
      trigger_type: {
        type: 'string',
        enum: [...AUTOMATION_TRIGGER_TYPES],
        example: 'deal_stage_changed',
      },
      trigger_config: {
        type: 'object',
        description: 'Shape depends on trigger_type; validated in the service',
        additionalProperties: true,
        example: { stage: 'Negotiation' },
      },
      action_type: {
        type: 'string',
        enum: [...AUTOMATION_ACTION_TYPES],
        example: 'create_task',
      },
      action_config: {
        type: 'object',
        description: 'Shape depends on action_type; validated in the service',
        additionalProperties: true,
        example: {
          subject: 'Prepare contract',
          task_type: 'Task',
          assignee_type: 'owner',
          due_date_offset_days: 2,
        },
      },
    },
  },

  // ── Coverage ─────────────────────────────────────────────────
  CoverageDump: {
    type: 'object',
    required: ['dumpId', 'agent', 'label', 'commitSha', 'capturedAt', 'format', 'path'],
    properties: {
      dumpId: { type: 'string', format: 'uuid' },
      agent: { type: 'string', enum: ['node-v8', 'browser-istanbul'] },
      label: { type: 'string', example: 'coverage-instrumentation-spec' },
      commitSha: { type: 'string', example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
      capturedAt: { type: 'string', format: 'date-time' },
      format: { type: 'string', enum: ['v8-script-coverage', 'istanbul'] },
      path: {
        type: 'string',
        description: 'Path to the raw payload file, relative to the dumps root',
      },
    },
  },

  // ── Coverage sessions ─────────────────────────────────
  CoverageSession: {
    type: 'object',
    required: [
      'id',
      'label',
      'source',
      'status',
      'correlationId',
      'buildSha',
      'environment',
      'issueKey',
      'startedById',
      'startedAt',
      'endedAt',
      'version',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      label: { type: 'string', example: 'deals functional suite' },
      source: { type: 'string', enum: ['automated-e2e', 'manual'] },
      status: { type: 'string', enum: ['active', 'ended'] },
      correlationId: { type: 'string', format: 'uuid' },
      buildSha: { type: 'string', example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
      environment: { type: 'string', example: 'ci' },
      issueKey: { type: 'string', nullable: true, example: 'MINCRM-609' },
      startedById: { type: 'string', format: 'uuid', nullable: true },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: 'string', format: 'date-time', nullable: true },
      version: { type: 'integer', example: 1 },
    },
  },
  CoverageSessionDump: {
    type: 'object',
    required: [
      'id',
      'sessionId',
      'dumpId',
      'correlationId',
      'testId',
      'testName',
      'testFile',
      'attempt',
      'recordedAt',
    ],
    properties: {
      id: { type: 'string', format: 'uuid' },
      sessionId: { type: 'string', format: 'uuid' },
      dumpId: { type: 'string', format: 'uuid' },
      correlationId: { type: 'string', format: 'uuid' },
      testId: { type: 'string', nullable: true },
      testName: { type: 'string', nullable: true },
      testFile: {
        type: 'string',
        nullable: true,
        example: 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
      },
      attempt: { type: 'integer', example: 1 },
      recordedAt: { type: 'string', format: 'date-time' },
    },
  },

  // ── Coverage pipeline ──────────────
  IngestCoverageDumpResult: {
    type: 'object',
    required: ['dumpId', 'commitSha', 'alreadyIngested', 'unitCount', 'unresolvedCount'],
    properties: {
      dumpId: { type: 'string', format: 'uuid' },
      commitSha: { type: 'string', example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
      alreadyIngested: { type: 'boolean' },
      unitCount: { type: 'integer', example: 42 },
      unresolvedCount: { type: 'integer', example: 0 },
    },
  },

  // ── Coverage mapping query API ──────────────────
  CoverageMappingResult: {
    type: 'object',
    required: [
      'commitSha',
      'unitKey',
      'branchId',
      'filePath',
      'testId',
      'testName',
      'testFile',
      'hitCount',
      'firstSeenAt',
      'lastSeenAt',
      'confidenceScore',
      'lastReconciledAt',
    ],
    properties: {
      commitSha: { type: 'string', example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' },
      unitKey: { type: 'string', example: 'render#a1b2c3d4e5f6a7b8' },
      branchId: { type: 'string', nullable: true, example: '0:0' },
      filePath: { type: 'string', example: 'src/components/Widget.tsx' },
      testId: { type: 'string', description: "Playwright's own opaque TestInfo.testId." },
      testName: { type: 'string', nullable: true, example: 'creates a deal' },
      testFile: {
        type: 'string',
        nullable: true,
        example: 'tests/apps/minicrm/functional/deals/deal-creation.spec.ts',
      },
      hitCount: { type: 'integer', example: 12 },
      firstSeenAt: { type: 'string', format: 'date-time' },
      lastSeenAt: { type: 'string', format: 'date-time' },
      confidenceScore: { type: 'number', nullable: true, minimum: 0, maximum: 1, example: 0.95 },
      lastReconciledAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },

  // ── Coverage health ──────────────────────────────────────────
  CoverageHealthReport: {
    type: 'object',
    required: ['status', 'agentRunning', 'db', 'routers'],
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded'] },
      agentRunning: {
        type: 'boolean',
        description: 'Whether the backend V8 coverage agent is registered/running.',
      },
      db: { type: 'string', enum: ['ok', 'error'] },
      dbError: { type: 'string', description: 'Present only when db is "error".' },
      routers: {
        type: 'object',
        description:
          'Which coverage routers registered their routes at boot, from their COVERAGE_* env vars. False means every path under that router returns 404 — the routes do not exist, rather than existing and refusing. Replaced a featureFlags block reporting three feature_flags rows that migration 163 deleted.',
        required: ['pipeline', 'mapping', 'reporting'],
        properties: {
          pipeline: { type: 'boolean' },
          mapping: { type: 'boolean' },
          reporting: { type: 'boolean' },
        },
      },
      lastRetentionPrune: {
        type: 'object',
        description:
          "Outcome of the most recent scheduled retention prune. Absent if the daily cron has not fired yet this process's lifetime (not itself a degraded condition).",
        required: ['ranAt', 'status'],
        properties: {
          ranAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['ok', 'error'] },
          prunedUnitCount: { type: 'integer', description: 'Present only when status is "ok".' },
          prunedLinkCount: { type: 'integer', description: 'Present only when status is "ok".' },
          prunedIngestedDumpCount: {
            type: 'integer',
            description: 'Present only when status is "ok".',
          },
          prunedSessionCount: { type: 'integer', description: 'Present only when status is "ok".' },
          error: { type: 'string', description: 'Present only when status is "error".' },
        },
      },
    },
  },
};

/** swagger-jsdoc options */
const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'MiniCRM API',
      version: '0.1.0',
      description: `REST API for MiniCRM — a minimal viable CRM covering contacts, accounts, deals, and activities.

## Field Naming Convention

Request and response bodies use \`snake_case\` field names throughout the API (e.g., \`first_name\`, \`owner_id\`, \`close_date\`).

**Exception:** The following fields use \`camelCase\` rather than \`snake_case\`:
- \`POST /api/v1/auth/login\` response: \`mustChangePassword\`
- \`POST /api/v1/auth/change-password\` request: \`currentPassword\`, \`newPassword\`
- \`POST /api/v1/users/invite\` response: \`inviteToken\`, \`setPasswordPath\`

These are intentional exceptions and will not be changed to snake_case.

## Authentication

Endpoints require a valid session cookie obtained by calling \`POST /api/v1/auth/login\`, except the ones whose operation declares \`security: []\` — currently 19, including the health probe, the SSO and MFA login flows, password reset, and the settings a sign-in page reads before a session exists. The spec is the list; enumerating them here would be a second copy to drift.`,
    },
    servers: [
      // Host only: every path already carries its own /api/v1 (or /scim/v2), so a
      // versioned base would make a generated client request /api/v1/api/v1/...
      { url: 'http://localhost:3001', description: 'Local development server' },
    ],
    // Declared here rather than annotated: the endpoint lives in app.ts, which is
    // outside swagger-jsdoc's `apis` glob and the require-openapi-tag rule's reach.
    paths: {
      '/api/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Liveness and database connectivity probe',
          description:
            'Deliberately unversioned — an infrastructure endpoint for load balancers and orchestrators, not part of the resource API. No authentication.',
          tags: ['Health'],
          security: [],
          responses: {
            200: { description: 'Service healthy and the database is reachable' },
            503: { description: 'Service degraded — the database could not be reached' },
          },
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Infrastructure probes. Unversioned by design.',
      },
      {
        name: 'Auth',
        description:
          'Authentication and session management. The login endpoint sets an httpOnly cookie used by all subsequent requests.',
      },
      {
        name: 'Contacts',
        description:
          'People associated with accounts. A contact belongs to at most one account but can be linked to many deals.',
      },
      {
        name: 'Accounts',
        description:
          'Companies or organizations. The top-level CRM entity; contacts and activities are often scoped to an account.',
      },
      {
        name: 'Deals',
        description:
          'Sales opportunities moving through the pipeline. A deal can have many contacts (many-to-many) and one account.',
      },
      {
        name: 'Activities',
        description:
          'Interactions and tasks. An activity must be attached to at least one parent record (contact, account, or deal).',
      },
      {
        name: 'Dashboard',
        description:
          'Aggregated summary data for the home page. Admin users see team-wide metrics; reps see only their own.',
      },
      {
        name: 'Settings',
        description: 'System-wide configuration. GET is public; PATCH requires admin role.',
      },
      {
        name: 'Users',
        description:
          'User management. Most endpoints require admin role. The set-password and language endpoints are available to all authenticated users.',
      },
      {
        name: 'Teams',
        description:
          'Team management with nested hierarchy and membership. Read endpoints are open to all authenticated users; mutations require admin role.',
      },
      {
        name: 'Coverage',
        description:
          'Coverage/TIA control API — drives the backend V8 coverage agent and ingests frontend coverage dumps. Admin only, feature-flag gated, off by default in production.',
      },
    ],
    components: {
      // Reusable error bodies. Every one is the standard { error: { code, message } }
      // envelope, so they differ only in description and the status they document.
      responses: Object.fromEntries(
        [
          ['ValidationError', 'Request failed Zod validation'],
          ['BadRequest', 'Malformed or invalid request'],
          ['Unauthorized', 'Not authenticated'],
          ['Forbidden', 'Authenticated but not permitted, or feature disabled'],
          ['NotFound', 'Resource does not exist'],
          ['Conflict', 'Conflicts with the current state of the resource'],
        ].map(([name, description]) => [
          name,
          {
            description,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        ]),
      ),
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'minicrm_token',
          description: `JWT stored in an httpOnly, SameSite=lax cookie named 'minicrm_token'.
Obtain by calling POST /api/v1/auth/login. The token is valid for 30 minutes; call
POST /api/v1/auth/refresh before it lapses to slide the window. Refreshing cannot extend
a session past the 8-hour absolute cap measured from the original login.
Expired tokens return 401 on the next request — re-authenticate to obtain a new token.
The cookie is not accessible to JavaScript (httpOnly) and is scoped to same-site requests.`,
        },
      },
      schemas: componentSchemas,
    },
    security: [{ cookieAuth: [] }],
  },
  // Scan all route files for @openapi JSDoc annotations
  apis: ['./src/routes/*.ts'],
};

/** The fully generated OpenAPI spec object. */
export const swaggerSpec = swaggerJsdoc(swaggerOptions);

/**
 * Mounts Swagger UI at {@link SWAGGER_UI_PATH} on the provided Express app.
 * Call only when isNonProductionEnv() is true; the allowlist is what keeps an
 * unset or misspelled NODE_ENV from serving the docs.
 *
 * @param app - Express application instance to mount the docs on.
 */
export function setupSwagger(app: Express): void {
  app.use(SWAGGER_UI_PATH, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Also expose the raw JSON spec for tooling consumption
  app.get(`${SWAGGER_UI_PATH}.json`, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}
