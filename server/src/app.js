/**
 * Express application setup.
 * Configures middleware, mounts routes, and adds the global error handler.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import 'dotenv/config';
import logger from './logger.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';

const app = express();

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

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'The requested resource was not found' },
  });
});

// ── Global error handler ───────────────────────────────────────────────────────
// Must have four parameters so Express recognizes it as an error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err.message,
    },
  });
});

export default app;
