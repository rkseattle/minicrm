/**
 * Application logger.
 * Uses pino with pretty-printing in development and JSON output in production.
 */

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Application logger.
 * Outputs JSON to stdout in all environments — Docker reliably captures this.
 * For pretty output in local dev, pipe through pino-pretty:
 *   docker compose logs -f server | npx pino-pretty
 */
const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),
});

export default logger;
