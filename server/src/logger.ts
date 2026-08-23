/**
 * Application logger.
 * Uses pino with pretty-printing in development and JSON output in production.
 */

import pino from 'pino';
import { isNonProductionEnv } from './utils/nodeEnv.js';

// Allowlist rather than `!== 'production'`: an unset NODE_ENV would otherwise
// emit debug-level logs from a production deployment.
const isDevelopment = isNonProductionEnv();

/**
 * Application logger.
 * Outputs JSON to stdout in all environments — Docker reliably captures this.
 * For pretty output in local dev, pipe through pino-pretty:
 *   docker compose logs -f server | npx pino-pretty
 *
 * LOG_DESTINATION=stderr redirects to stderr instead — for standalone CLI
 * scripts (e.g. select-tests.ts) whose stdout is a machine-readable JSON
 * contract that log lines must never leak into. Unset in every other
 * context (the server process, tests), preserving today's stdout behavior
 * unchanged.
 */
const logger = pino(
  { level: process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info') },
  process.env.LOG_DESTINATION === 'stderr' ? pino.destination(2) : undefined,
);

export default logger;
