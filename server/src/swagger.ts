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
      role: { type: 'string', enum: ['admin', 'rep'], example: 'rep' },
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
      role: { type: 'string', enum: ['admin', 'rep'], example: 'rep' },
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
      role: { type: 'string', enum: ['admin', 'rep'], example: 'admin' },
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

**Exception:** The auth endpoints use \`camelCase\` for three fields:
- \`POST /api/auth/login\` response: \`mustChangePassword\`
- \`POST /api/auth/change-password\` request: \`currentPassword\`, \`newPassword\`

These are intentional exceptions and will not be changed to snake_case.

## Authentication

All endpoints except \`POST /api/auth/login\`, \`POST /api/auth/logout\`, \`POST /api/users/set-password\`, and \`GET /api/settings/default-language\` require a valid session cookie obtained by calling \`POST /api/auth/login\`.`,
    },
    servers: [{ url: 'http://localhost:3001', description: 'Local development server' }],
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
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'minicrm_token',
          description: `JWT stored in an httpOnly, SameSite=lax cookie named 'minicrm_token'.
Obtain by calling POST /api/auth/login. Token expires after 8 hours of inactivity.
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
