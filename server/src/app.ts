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
import demoRoutes from './routes/demo.js';
import searchRoutes from './routes/search.js';
import importRoutes from './routes/import.js';
import attachmentRoutes from './routes/attachments.js';
import auditLogRoutes from './routes/auditLog.js';
import leadRoutes from './routes/leads.js';
import tagRoutes from './routes/tags.js';
import { setupSwagger } from './swagger.js';

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

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/automation/rules', automationRoutes);
app.use('/api/admin/demo', demoRoutes);
app.use('/api/admin/import', importRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/tags', tagRoutes);

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

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
  });
});

export default app;
