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
import dealRoutes from './routes/deals.js';
import activityRoutes from './routes/activities.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import automationRoutes from './routes/automation.js';
import webhookRoutes from './routes/webhooks.js';
import demoRoutes from './routes/demo.js';
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
import { setupSwagger } from './swagger.js';
import { captureException } from './sentry.js';

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

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json());
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
app.use(`${API_V1}/deals`, dealRoutes);
app.use(`${API_V1}/activities`, activityRoutes);
app.use(`${API_V1}/dashboard`, dashboardRoutes);
app.use(`${API_V1}/reports`, reportRoutes);
app.use(`${API_V1}/settings`, settingsRoutes);
app.use(`${API_V1}/automation/rules`, automationRoutes);
app.use(`${API_V1}/admin/webhooks`, webhookRoutes);
app.use(`${API_V1}/admin/demo`, demoRoutes);
app.use(`${API_V1}/admin/import`, importRoutes);
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
