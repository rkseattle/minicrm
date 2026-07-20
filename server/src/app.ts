/**
 * Express application setup.
 * Configures middleware, mounts routes, and adds the global error handler.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import 'dotenv/config';
import logger from './logger.js';
import pool from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import contactRoutes from './routes/contacts.js';
import accountRoutes from './routes/accounts.js';
import duplicateRoutes from './routes/duplicates.js';
import dealRoutes from './routes/deals.js';
import activityRoutes from './routes/activities.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import insightsRoutes from './routes/insights.js';
import dataHygieneRoutes from './routes/dataHygiene.js';
import notificationsRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';
import automationRoutes from './routes/automation.js';
import webhookRoutes from './routes/webhooks.js';
import demoRoutes from './routes/demo.js';
import coverageRoutes from './routes/coverage.js';
import searchRoutes from './routes/search.js';
import importRoutes from './routes/import.js';
import attachmentRoutes from './routes/attachments.js';
import auditLogRoutes from './routes/auditLog.js';
import leadRoutes from './routes/leads.js';
import tagRoutes from './routes/tags.js';
import customFieldDefinitionRoutes from './routes/customFieldDefinitions.js';
import customFieldValueRoutes from './routes/customFieldValues.js';
import noteRoutes from './routes/notes.js';
import gdprRoutes from './routes/gdpr.js';
import mfaRoutes from './routes/mfa.js';
import ssoRoutes from './routes/sso.js';
import pipelineRoutes from './routes/pipelines.js';
import customReportRoutes from './routes/customReports.js';
import sequenceRoutes from './routes/sequences.js';
import sequenceEnrollmentRoutes from './routes/sequenceEnrollments.js';
import featureFlagRoutes from './routes/featureFlags.js';
import aiRoutes, { aiUserRouter } from './routes/ai.js';
import teamRoutes from './routes/teams.js';
import customRoleRoutes from './routes/customRoles.js';
import scimTokenRoutes from './routes/scimToken.js';
import scimRoutes from './routes/scim.js';
import scimGroupMappingRoutes from './routes/scimGroupMappings.js';
import { expressConnectMiddleware } from '@connectrpc/connect-express';
import { registerAuditService } from './grpc/auditConnectService.js';
import { setupSwagger } from './swagger.js';
import { captureException } from './sentry.js';
import { asyncHandler } from './middleware/asyncHandler.js';

const app = express();

// Trust the first proxy hop (nginx/ALB) so req.ip reflects the real client IP.
// Required for rate limiting to key on individual clients rather than the proxy.
app.set('trust proxy', 1);

// ── Security headers ───────────────────────────────────────────────────────────
// In non-production, disable CSP so Swagger UI (inline scripts) renders correctly.
// Production keeps the full helmet defaults including a strict CSP.
app.use(
  process.env.NODE_ENV === 'production' ? helmet() : helmet({ contentSecurityPolicy: false }),
);

// ── CORS ───────────────────────────────────────────────────────────────────────
// CORS_ORIGIN is a comma-separated list of allowed origins.
// Default: http://localhost:5173 (Vite dev server on the same machine).
//
// LAN access (MINCRM-148): when a mobile device connects via the server's LAN IP
// (e.g. http://192.168.1.100:5173) the browser sends that address as the CORS
// origin, which will be rejected unless it is included in CORS_ORIGIN.
// Add the LAN address alongside localhost:
//   CORS_ORIGIN=http://localhost:5173,http://192.168.1.100:5173
//
// Wildcards ('*') are intentionally not supported — credentialed requests
// (cookies) require an explicit origin, not a wildcard.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., server-to-server, curl)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
  }),
);

// ── HTTP request logging ────────────────────────────────────────────────────────
app.use(
  morgan('dev', {
    stream: { write: (message) => logger.info(message.trimEnd()) },
  }),
);

// ── ConnectRPC middleware (MINCRM-377) ─────────────────────────────────────────
// Must be mounted BEFORE express.json() and cookieParser() so that Connect/gRPC-Web
// requests are intercepted before any body-buffering middleware can consume the
// raw request stream. The Connect protocol reads the body itself.
app.use(expressConnectMiddleware({ routes: registerAuditService, requestPathPrefix: '/api' }));

// ── Body parsing ───────────────────────────────────────────────────────────────
// MINCRM-606: raised from the express.json() default of 100kb — real frontend
// Istanbul coverage payloads (POST /api/v1/admin/coverage/dump, source:'browser')
// commonly exceed that (a manual test produced a ~370KB backend V8 payload;
// browser Istanbul maps run comparably large or larger for a full SPA).
const JSON_BODY_SIZE_LIMIT = '10mb';
app.use(express.json({ limit: JSON_BODY_SIZE_LIMIT }));
// SAML POST binding sends assertions as application/x-www-form-urlencoded (MINCRM-399)
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Routes (v1) ────────────────────────────────────────────────────────────────
// All resource routes are mounted under /api/v1/. The /api/health endpoint is
// intentionally unversioned — it is a platform/infra endpoint, not an API resource.
// MINCRM-283
const API_V1 = '/api/v1';

app.use(`${API_V1}/auth`, authRoutes);
app.use(`${API_V1}/users`, userRoutes);
app.use(`${API_V1}/contacts`, contactRoutes);
app.use(`${API_V1}/accounts`, accountRoutes);
app.use(`${API_V1}/duplicates`, duplicateRoutes);
app.use(`${API_V1}/deals`, dealRoutes);
app.use(`${API_V1}/activities`, activityRoutes);
app.use(`${API_V1}/dashboard`, dashboardRoutes);
// Custom reports must be mounted before the general reports router so that
// /api/v1/reports/custom/* is matched before Express hands control to reportRoutes.
app.use(`${API_V1}/reports/custom`, customReportRoutes);
app.use(`${API_V1}/reports`, reportRoutes);
app.use(`${API_V1}/insights`, insightsRoutes);
app.use(`${API_V1}/data-hygiene`, dataHygieneRoutes);
app.use(`${API_V1}/notifications`, notificationsRoutes);
app.use(`${API_V1}/settings`, settingsRoutes);
app.use(`${API_V1}/automation/rules`, automationRoutes);
app.use(`${API_V1}/admin/webhooks`, webhookRoutes);
app.use(`${API_V1}/admin/demo`, demoRoutes);
app.use(`${API_V1}/admin/import`, importRoutes);
// Coverage/TIA control API (MINCRM-604, MINCRM-606)
app.use(`${API_V1}/admin/coverage`, coverageRoutes);
app.use(`${API_V1}/search`, searchRoutes);
app.use(`${API_V1}/attachments`, attachmentRoutes);
app.use(`${API_V1}/audit-log`, auditLogRoutes);
app.use(`${API_V1}/leads`, leadRoutes);
app.use(`${API_V1}/tags`, tagRoutes);
app.use(`${API_V1}/custom-fields/definitions`, customFieldDefinitionRoutes);
app.use(`${API_V1}/custom-fields`, customFieldValueRoutes);
// Notes are mounted under each entity path (MINCRM-352)
app.use(`${API_V1}/:entityType/:entityId/notes`, noteRoutes);
// GDPR erasure and export endpoints (MINCRM-364)
app.use(`${API_V1}/gdpr`, gdprRoutes);
// MFA (TOTP two-factor authentication) endpoints (MINCRM-392)
app.use(`${API_V1}/auth/mfa`, mfaRoutes);
// SSO (SAML 2.0 / OIDC single sign-on) endpoints (MINCRM-399)
app.use(`${API_V1}/auth/sso`, ssoRoutes);
// Pipeline management (MINCRM-397)
app.use(`${API_V1}/pipelines`, pipelineRoutes);
// Sales sequences (MINCRM-403)
app.use(`${API_V1}/sequences`, sequenceRoutes);
app.use(`${API_V1}/sequence-enrollments`, sequenceEnrollmentRoutes);
// Feature flag registry (MINCRM-463)
// Public path exposes /me for all authenticated users; admin-only routes on this
// router (/ and /:key) are still protected by requireRole('admin') middleware.
app.use(`${API_V1}/feature-flags`, featureFlagRoutes);
app.use(`${API_V1}/admin/feature-flags`, featureFlagRoutes);
// Teams — read endpoints open to all authenticated users; mutations admin-only (MINCRM-537)
app.use(`${API_V1}/teams`, teamRoutes);
app.use(`${API_V1}/custom-roles`, customRoleRoutes);
// SCIM token management — issue/revoke the long-lived SCIM bearer token. (MINCRM-541)
app.use(API_V1, scimTokenRoutes);
// SCIM group → role mapping admin endpoints (MINCRM-541)
app.use(API_V1, scimGroupMappingRoutes);
app.use('/scim/v2', scimRoutes);
// User-facing AI routes — only /token-budget/me; no admin handlers. (MINCRM-458)
app.use(`${API_V1}/ai`, aiUserRouter);
// Admin AI config/token-budget routes — full router at the admin prefix. (MINCRM-457, MINCRM-458)
app.use(`${API_V1}/admin/ai`, aiRoutes);

// ── Backward-compat redirects (/api/<resource> → /api/v1/<resource>) ───────────
// 301 redirects let external consumers that haven't migrated yet reach the
// versioned routes. The redirect preserves the path suffix so nested routes work.
// Remove this block once all known consumers are on /api/v1/.
const LEGACY_PREFIXES = [
  '/api/auth',
  '/api/users',
  '/api/contacts',
  '/api/accounts',
  '/api/deals',
  '/api/activities',
  '/api/dashboard',
  '/api/reports',
  '/api/settings',
  '/api/automation',
  '/api/admin',
  '/api/search',
  '/api/attachments',
  '/api/audit-log',
  '/api/leads',
  '/api/tags',
  '/api/custom-fields',
  '/api/gdpr',
];

for (const prefix of LEGACY_PREFIXES) {
  app.use(prefix, (req, res) => {
    const newUrl = req.originalUrl.replace(/^\/api\//, '/api/v1/');
    res.redirect(301, newUrl);
  });
}

// ── Health check ───────────────────────────────────────────────────────────────
// No authentication — must remain public for load balancers and orchestrators.
app.get('/api/health', async (_req: Request, res: Response) => {
  const client = await pool.connect().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      status: 'degraded',
      db: 'error',
      db_error: message,
      uptime_seconds: Math.floor(process.uptime()),
    });
    return null;
  });

  if (!client) return;

  try {
    // SET LOCAL limits this timeout to the current transaction only (MINCRM-258)
    await client.query("SET LOCAL statement_timeout = '2s'");
    await client.query('SELECT 1');
    res.status(200).json({
      status: 'ok',
      db: 'ok',
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      status: 'degraded',
      db: 'error',
      db_error: message,
      uptime_seconds: Math.floor(process.uptime()),
    });
  } finally {
    client.release();
  }
});

// ── API docs (development + staging only) ─────────────────────────────────────
// Mounted before the 404 handler so /api-docs routes are reachable.
// swagger-jsdoc is a production dependency so this import is always safe.
if (process.env.NODE_ENV !== 'production') {
  setupSwagger(app);
}

// ── Test-only endpoints (non-production) ──────────────────────────────────────
// These endpoints are used exclusively by the E2E test suite to trigger
// background jobs synchronously without waiting for the cron schedule.
if (process.env.NODE_ENV !== 'production') {
  /**
   * POST /api/v1/test/advance-sequences — dev/test only.
   * Calls advanceDueEnrollments() immediately so E2E tests can verify
   * that sequence cron logic fires correctly without waiting 15 minutes.
   * Never available in production. (MINCRM-403)
   */
  app.post(
    `${API_V1}/test/advance-sequences`,
    asyncHandler(async (_req, res) => {
      const { advanceDueEnrollments } = await import('./services/sequenceService.js');
      await advanceDueEnrollments();
      res.status(200).json({ ok: true });
    }),
  );
}

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'The requested resource was not found' },
  });
});

// ── Global error handler ───────────────────────────────────────────────────────
// Must have four parameters so Express recognizes it as an error handler.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Pool exhaustion: all connections were held for > connectionTimeoutMillis. (MINCRM-248)
  if (err.message?.includes('timeout exceeded when trying to connect')) {
    res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The server is temporarily unable to handle the request. Please try again.',
      },
    });
    return;
  }

  // body-parser/raw-body sets .type = 'entity.too.large' on oversized request
  // bodies (MINCRM-606: relevant to POST /api/v1/admin/coverage/dump, which
  // can carry a multi-MB frontend coverage payload) — map explicitly so it
  // returns the app's error shape instead of falling through to a raw 500.
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the maximum allowed size.',
      },
    });
    return;
  }

  captureException(err);
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
  });
});

export default app;
