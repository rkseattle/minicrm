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
      mustChangePassword: { type: 'boolean', example: false },
    },
  },
  ChangePasswordRequest: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', example: 'OldPass1' },
      newPassword: {
        type: 'string',
        minLength: 8,
        description: 'At least 8 characters, one letter, one number',
        example: 'NewPass2',
      },
    },
  },

  // ── User ───────────────────────────────────────────────────────────────────
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      role: { type: 'string', enum: ['admin', 'rep'] },
      status: { type: 'string', enum: ['active', 'invited', 'inactive'] },
      must_change_password: { type: 'boolean' },
      preferred_language: {
        type: 'string',
        enum: ['en', 'zh-Hans', 'es', 'fr', 'de'],
        nullable: true,
      },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
  InviteUserRequest: {
    type: 'object',
    required: ['email', 'name', 'role'],
    properties: {
      email: { type: 'string', format: 'email', example: 'newrep@example.com' },
      name: { type: 'string', example: 'Jane Smith' },
      role: { type: 'string', enum: ['admin', 'rep'] },
    },
  },
  SetPasswordRequest: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: { type: 'string', description: 'Invite JWT token from email' },
      password: {
        type: 'string',
        minLength: 8,
        description: 'At least 8 characters, one letter, one number',
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
      },
    },
  },
  UpdateRoleRequest: {
    type: 'object',
    required: ['role'],
    properties: {
      role: { type: 'string', enum: ['admin', 'rep'] },
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
      },
    },
  },

  // ── Contact ────────────────────────────────────────────────────────────────
  Contact: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string', nullable: true },
      title: { type: 'string', nullable: true },
      department: { type: 'string', nullable: true },
      account_id: { type: 'string', format: 'uuid', nullable: true },
      owner_id: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  CreateContactRequest: {
    type: 'object',
    required: ['first_name', 'last_name', 'email'],
    properties: {
      first_name: { type: 'string', minLength: 1 },
      last_name: { type: 'string', minLength: 1 },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string' },
      title: { type: 'string' },
      department: { type: 'string' },
      account_id: { type: 'string', format: 'uuid', nullable: true },
    },
  },
  UpdateContactRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      first_name: { type: 'string', minLength: 1 },
      last_name: { type: 'string', minLength: 1 },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string' },
      title: { type: 'string' },
      department: { type: 'string' },
      account_id: { type: 'string', format: 'uuid', nullable: true },
      owner_id: { type: 'string', format: 'uuid' },
    },
  },

  // ── Account ────────────────────────────────────────────────────────────────
  Account: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      industry: { type: 'string', nullable: true },
      website: { type: 'string', format: 'uri', nullable: true },
      employee_range: { type: 'string', nullable: true },
      revenue_range: { type: 'string', nullable: true },
      owner_id: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  CreateAccountRequest: {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      industry: { type: 'string' },
      website: { type: 'string', format: 'uri' },
      employee_range: { type: 'string' },
      revenue_range: { type: 'string' },
    },
  },
  UpdateAccountRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      name: { type: 'string', minLength: 1 },
      industry: { type: 'string' },
      website: { type: 'string', format: 'uri' },
      employee_range: { type: 'string' },
      revenue_range: { type: 'string' },
      owner_id: { type: 'string', format: 'uuid' },
    },
  },

  // ── Deal ───────────────────────────────────────────────────────────────────
  Deal: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
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
      },
      value: { type: 'string', nullable: true, description: 'Numeric string from PostgreSQL' },
      close_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'YYYY-MM-DD format',
      },
      loss_reason: { type: 'string', nullable: true },
      account_id: { type: 'string', format: 'uuid', nullable: true },
      owner_id: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  CreateDealRequest: {
    type: 'object',
    required: ['name', 'stage'],
    properties: {
      name: { type: 'string', minLength: 1 },
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
      },
      value: { type: 'number', minimum: 0 },
      close_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      account_id: { type: 'string', format: 'uuid' },
    },
  },
  UpdateDealRequest: {
    type: 'object',
    description: 'At least one field must be provided',
    properties: {
      name: { type: 'string', minLength: 1 },
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
      },
      value: { type: 'number', minimum: 0, nullable: true },
      close_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        nullable: true,
      },
      loss_reason: { type: 'string', nullable: true },
      account_id: { type: 'string', format: 'uuid', nullable: true },
      owner_id: { type: 'string', format: 'uuid' },
    },
  },

  // ── Activity ───────────────────────────────────────────────────────────────
  Activity: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: { type: 'string', enum: ['Note', 'Call', 'Email', 'Meeting', 'Task'] },
      subject: { type: 'string' },
      notes: { type: 'string', nullable: true },
      due_date: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'YYYY-MM-DD format',
      },
      status: { type: 'string', enum: ['open', 'complete'] },
      contact_id: { type: 'string', format: 'uuid', nullable: true },
      account_id: { type: 'string', format: 'uuid', nullable: true },
      deal_id: { type: 'string', format: 'uuid', nullable: true },
      owner_id: { type: 'string', format: 'uuid' },
      created_at: { type: 'string', format: 'date-time' },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  CreateActivityRequest: {
    type: 'object',
    required: ['type', 'subject'],
    description: 'At least one of contact_id, account_id, or deal_id must be provided',
    properties: {
      type: { type: 'string', enum: ['Note', 'Call', 'Email', 'Meeting', 'Task'] },
      subject: { type: 'string', minLength: 1 },
      notes: { type: 'string' },
      due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      contact_id: { type: 'string', format: 'uuid' },
      account_id: { type: 'string', format: 'uuid' },
      deal_id: { type: 'string', format: 'uuid' },
    },
  },
  UpdateActivityRequest: {
    type: 'object',
    description: 'At least one field must be provided. Parent IDs cannot be changed.',
    properties: {
      type: { type: 'string', enum: ['Note', 'Call', 'Email', 'Meeting', 'Task'] },
      subject: { type: 'string', minLength: 1 },
      notes: { type: 'string', nullable: true },
      due_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        nullable: true,
      },
      status: { type: 'string', enum: ['open', 'complete'] },
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
      language: { type: 'string', enum: ['en', 'zh-Hans', 'es', 'fr', 'de'] },
    },
  },
  SetDefaultLanguageRequest: {
    type: 'object',
    required: ['language'],
    properties: {
      language: { type: 'string', enum: ['en', 'zh-Hans', 'es', 'fr', 'de'] },
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
      description:
        'REST API for MiniCRM — a minimal viable CRM covering contacts, accounts, deals, and activities.',
    },
    servers: [{ url: 'http://localhost:3001', description: 'Local development server' }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'minicrm_token',
          description: 'JWT stored in an httpOnly cookie. Obtain by calling POST /api/auth/login.',
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
