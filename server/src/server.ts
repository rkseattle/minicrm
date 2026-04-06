/**
 * HTTP server entry point.
 * Imports the Express app and starts listening on the configured port.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown (MINCRM-108).
 * Registers an unhandledRejection handler to surface fire-and-forget failures (MINCRM-122).
 */

import 'dotenv/config';
import http from 'http';
import app from './app.js';
import logger from './logger.js';
import { runMigrations } from './migrate.js';
import { seedDefaultAdmin } from './services/userService.js';
import pool from './db.js';

/** Default port for the API server */
const DEFAULT_PORT = 3001;

/** Known-weak JWT_SECRET values that must be rejected at startup */
const WEAK_JWT_SECRETS = new Set(['changeme', 'secret', 'password', '']);

/** Drain timeout in milliseconds before forcing process exit */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const jwtSecret = process.env.JWT_SECRET ?? '';
if (
  WEAK_JWT_SECRETS.has(jwtSecret) ||
  jwtSecret.startsWith('REPLACE_WITH_') ||
  jwtSecret.length < 32
) {
  throw new Error(
    'JWT_SECRET is not set or is using a known-weak value. ' +
      'Set a cryptographically random secret of at least 32 characters before starting. ' +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

// Log unhandled promise rejections (e.g. from fire-and-forget automation triggers — MINCRM-122)
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

const port = Number(process.env.PORT) || DEFAULT_PORT;

const server = http.createServer(app);

/**
 * Gracefully shuts down the HTTP server.
 * Stops accepting new connections, waits up to SHUTDOWN_TIMEOUT_MS for in-flight
 * requests to finish, then closes the pg pool and exits.
 *
 * @param signal - The OS signal that triggered shutdown
 */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — starting graceful shutdown`);

  const forceExitTimer = setTimeout(() => {
    logger.error('Drain timeout exceeded — forcing process exit with code 1');
    process.exit(1); // eslint-disable-line n/no-process-exit
  }, SHUTDOWN_TIMEOUT_MS);

  // Prevent the timer from keeping the process alive if shutdown completes early
  forceExitTimer.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info('HTTP server closed');

    await pool.end();
    logger.info('Database pool closed');

    clearTimeout(forceExitTimer);
    logger.info('Graceful shutdown complete');
    process.exit(0); // eslint-disable-line n/no-process-exit
  } catch (err) {
    logger.error({ err }, 'Error during graceful shutdown');
    process.exit(1); // eslint-disable-line n/no-process-exit
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

server.listen(port, () => {
  logger.info(`MiniCRM API server listening on port ${port}`);
  runMigrations()
    .then(() => seedDefaultAdmin())
    .catch((err) => {
      logger.error({ err }, 'Startup initialization failed');
      process.exit(1); // eslint-disable-line n/no-process-exit
    });
});
