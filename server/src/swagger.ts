/**
 * Swagger / OpenAPI configuration.
 *
 * Builds the OpenAPI 3.0 spec from JSDoc annotations in the route files and
 * exposes a helper to mount Swagger UI on an Express application.
 *
 * Only enabled in development and staging — never in production.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';

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
        example: 'OldPass1',
        description: 'Intentional camelCase exception — all other request fields use snake_case.',
      },
      newPassword: {
        type: 'string',
        minLength: 8,
        description:
          'At least 8 characters, one letter, one number. Intentional camelCase exception — all other request fields use snake_case.',
        example: 'NewPass2',
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
        minLength: 8,
        description: 'At least 8 characters, one letter, one number',
        example: 'MySecurePass1',
      },
    },
  },
  AdminSetPasswordRequest: {
    type: 'object',
    required: ['password'],
    properties: {
      password: {
        type: 'string',
        minLength: 8,
        description: 'At least 8 characters, one letter, one number',
        example: 'TempPass123',
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

  // ── Team (MINCRM-537) ─────────────────────────────────────────────────────
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

  // ── Coverage (MINCRM-606) ─────────────────────────────────────────────────
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

  // ── Coverage sessions (MINCRM-609..612) ─────────────────────────────────
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

  // ── Coverage pipeline (MINCRM-614, MINCRM-615, MINCRM-616) ──────────────
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

  // ── Coverage mapping query API (MINCRM-618, MINCRM-621) ──────────────────
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

  // ── Coverage health (MINCRM-637) ──────────────────────────────────────────
  CoverageHealthReport: {
    type: 'object',
    required: ['status', 'agentRunning', 'db', 'featureFlags'],
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded'] },
      agentRunning: {
        type: 'boolean',
        description: 'Whether the backend V8 coverage agent is registered/running.',
      },
      db: { type: 'string', enum: ['ok', 'error'] },
      dbError: { type: 'string', description: 'Present only when db is "error".' },
      featureFlags: {
        type: 'object',
        required: [
          'coverage_pipeline_ingestion',
          'coverage_mapping_query',
          'coverage_reporting_query',
        ],
        properties: {
          coverage_pipeline_ingestion: { type: 'boolean' },
          coverage_mapping_query: { type: 'boolean' },
          coverage_reporting_query: { type: 'boolean' },
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

All endpoints except \`POST /api/v1/auth/login\`, \`POST /api/v1/auth/logout\`, \`POST /api/v1/users/set-password\`, and \`GET /api/v1/settings/default-language\` require a valid session cookie obtained by calling \`POST /api/v1/auth/login\`.`,
    },
    servers: [
      { url: 'http://localhost:3001/api/v1', description: 'Local development server (v1)' },
    ],
    tags: [
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
          'Team management with nested hierarchy and membership. Read endpoints are open to all authenticated users; mutations require admin role. (MINCRM-537)',
      },
      {
        name: 'Coverage',
        description:
          'Coverage/TIA control API — drives the backend V8 coverage agent and ingests frontend coverage dumps. Admin only, feature-flag gated, off by default in production. (MINCRM-604, MINCRM-606)',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'minicrm_token',
          description: `JWT stored in an httpOnly, SameSite=lax cookie named 'minicrm_token'.
Obtain by calling POST /api/v1/auth/login. Token expires after 8 hours of inactivity.
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
 * Should only be called when NODE_ENV is not 'production'.
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
