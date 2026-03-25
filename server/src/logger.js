/**
 * Application logger.
 * Uses pino with pretty-printing in development and JSON output in production.
 */

import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});

export default logger;
