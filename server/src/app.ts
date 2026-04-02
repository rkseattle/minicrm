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
import { setupSwagger } from './swagger.js';

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
// In non-production, disable CSP so Swagger UI (inline scripts) renders correctly.
// Production keeps the full helmet defaults including a strict CSP.
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  }),
);

// ── CORS ───────────────────────────────────────────────────────────────────────
// Allow the Vite dev server to make credentialed requests
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',');

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

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
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
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
  });
});

export default app;
