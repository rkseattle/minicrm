/**
 * Tests for the Swagger UI endpoint and environment gating.
 *
 * Verifies that:
 * - setupSwagger mounts /api-docs and /api-docs.json on any Express app
 * - The generated spec has the correct OpenAPI shape
 * - When setupSwagger is NOT called (production mode), the routes return 404
 */

import request from 'supertest';
import express from 'express';
import { setupSwagger, swaggerSpec } from '../swagger.js';

describe('setupSwagger — mounts Swagger UI', () => {
  it('GET /api-docs/ returns 200 when setupSwagger has been called', async () => {
    const app = express();
    setupSwagger(app);
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('GET /api-docs.json returns the OpenAPI spec', async () => {
    const app = express();
    setupSwagger(app);
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('openapi', '3.0.3');
    expect(res.body).toHaveProperty('info.title', 'MiniCRM API');
  });

  it('GET /api-docs/ returns 404 when setupSwagger has NOT been called', async () => {
    const app = express();
    // No setupSwagger call — simulates production mode
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(404);
  });
});

describe('swaggerSpec — generated spec structure', () => {
  it('is a valid OpenAPI 3.0 document', () => {
    expect(swaggerSpec).toHaveProperty('openapi', '3.0.3');
    expect(swaggerSpec).toHaveProperty('info.title', 'MiniCRM API');
    expect(swaggerSpec).toHaveProperty('components.schemas');
    expect(swaggerSpec).toHaveProperty('components.securitySchemes.cookieAuth');
  });

  it('includes all expected component schemas', () => {
    const schemas = (
      swaggerSpec as Record<string, unknown> & { components: { schemas: Record<string, unknown> } }
    ).components.schemas;
    const expectedSchemas = [
      'ErrorResponse',
      'LoginRequest',
      'LoginResponse',
      'User',
      'Contact',
      'CreateContactRequest',
      'Account',
      'CreateAccountRequest',
      'Deal',
      'CreateDealRequest',
      'Activity',
      'CreateActivityRequest',
      'DashboardSummary',
      'DefaultLanguageResponse',
    ];
    for (const schemaName of expectedSchemas) {
      expect(schemas).toHaveProperty(schemaName);
    }
  });

  it('documents all expected API paths', () => {
    const paths = Object.keys((swaggerSpec as { paths: Record<string, unknown> }).paths);
    const expectedPaths = [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/contacts',
      '/api/contacts/{id}',
      '/api/accounts',
      '/api/accounts/{id}',
      '/api/deals',
      '/api/deals/{id}',
      '/api/activities',
      '/api/activities/my-tasks',
      '/api/dashboard/summary',
      '/api/settings/default-language',
    ];
    for (const path of expectedPaths) {
      expect(paths).toContain(path);
    }
  });
});
