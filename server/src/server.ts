/**
 * HTTP server entry point.
 * Imports the Express app and starts listening on the configured port.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown (MINCRM-108).
 * Registers an unhandledRejection handler to surface fire-and-forget failures (MINCRM-122).
 */

import 'dotenv/config';
import http from 'http';
import cron from 'node-cron';
import app from './app.js';
import logger from './logger.js';
import { initSentry, captureException } from './sentry.js';
import { runMigrations } from './migrate.js';
import { seedDefaultAdmin } from './services/userService.js';
import { sendOverdueDigests } from './services/notificationService.js';
import { advanceDueEnrollments } from './services/sequenceService.js';
import { runRetentionPurge } from './services/retentionService.js';
import { ensureAuditLogPartitions } from './services/auditPartitionService.js';
import pool from './db.js';
import { auditEventBus } from './services/auditEventBus.js';

/** Default port for the API server */
const DEFAULT_PORT = 3001;

initSentry();

/** Known-weak JWT_SECRET values that must be rejected at startup */
const WEAK_JWT_SECRETS = new Set(['changeme', 'secret', 'password', '']);

/** Expected byte length of NODE_ENCRYPTION_KEY expressed as hex chars (32 bytes × 2) */
const ENCRYPTION_KEY_HEX_LENGTH = 64;

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

// MINCRM-301: Validate NODE_ENCRYPTION_KEY at startup so operators discover
// missing configuration immediately rather than at first use of storage or SMTP.
const encryptionKey = process.env.NODE_ENCRYPTION_KEY ?? '';
if (encryptionKey.length !== ENCRYPTION_KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(encryptionKey)) {
  throw new Error(
    'NODE_ENCRYPTION_KEY is not set or is not a valid 64-character hex string (32 bytes). ' +
      'This key is required for file storage and SMTP secret encryption. ' +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
      'and set it in your .env file. See docs/operations.md for details.',
  );
}

// MINCRM-396: Warn when SMTP_FROM is configured but DKIM signing is absent.
// Without DKIM, outbound mail from a custom domain is likely to land in spam.
// This is a non-fatal advisory — the server continues to start normally.
if (process.env.SMTP_FROM && !process.env.SMTP_DKIM_PRIVATE_KEY) {
  logger.warn(
    'SMTP_FROM is set but SMTP_DKIM_PRIVATE_KEY is not configured. ' +
      'Outbound emails may be rejected or delivered to spam. ' +
      'See docs/operations.md#email-deliverability for SPF/DKIM/DMARC setup instructions.',
  );
}

// Log and report unhandled promise rejections (e.g. from fire-and-forget automation triggers — MINCRM-122)
process.on('unhandledRejection', (reason) => {
  captureException(reason);
  logger.error({ reason }, 'Unhandled promise rejection');
});

const port = Number(process.env.PORT) || DEFAULT_PORT;

const server = http.createServer(app);

// Disable Nagle's algorithm for all connections so that small streaming frames
// (e.g. the ConnectRPC stream-ready sentinel) are delivered immediately rather
// than being buffered until the TCP send buffer fills (MINCRM-554).
server.on('connection', (socket) => {
  socket.setNoDelay(true);
});

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

    await auditEventBus.stop();
    logger.info('Audit event bus stopped');

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

void (async () => {
  try {
    await runMigrations();
    await seedDefaultAdmin();
    await auditEventBus.start(pool);
    // Ensure audit_log partitions exist for the current month + 3 months ahead.
    // Runs at startup so partitions are guaranteed before any writes occur,
    // regardless of when the monthly cron last fired. (MINCRM-521)
    await ensureAuditLogPartitions();
  } catch (err) {
    logger.error({ err }, 'Startup initialization failed');
    process.exit(1); // eslint-disable-line n/no-process-exit
  }

  server.listen(port, () => {
    logger.info(`MiniCRM API server listening on port ${port}`);
  });
})();

// Daily overdue task digest — runs at 08:00 server time every day (MINCRM-161).
// In test/CI environments the cron is skipped to avoid side effects.
if (process.env.NODE_ENV !== 'test') {
  const overdueDigestCron = cron.schedule('0 8 * * *', () => {
    logger.info('cron: running overdue task digest');
    void sendOverdueDigests();
  });
  logger.info('Overdue task digest cron scheduled (daily at 08:00)');

  // Stop the cron task when the process shuts down so it is garbage-collected.
  process.once('SIGTERM', () => overdueDigestCron.stop());
  process.once('SIGINT', () => overdueDigestCron.stop());

  // Sequence step advancement — runs every 15 minutes (MINCRM-403).
  // Re-entrancy guard: if the previous run is still in progress, skip the tick.
  let sequenceCronRunning = false;
  const sequenceCron = cron.schedule('*/15 * * * *', () => {
    if (sequenceCronRunning) {
      logger.warn('cron: sequence advancement still in progress — skipping tick');
      return;
    }
    sequenceCronRunning = true;
    logger.info('cron: advancing due sequence enrollments');
    void advanceDueEnrollments().finally(() => {
      sequenceCronRunning = false;
    });
  });
  logger.info('Sequence enrollment cron scheduled (every 15 minutes)');

  process.once('SIGTERM', () => sequenceCron.stop());
  process.once('SIGINT', () => sequenceCron.stop());

  // Log table retention purge — runs daily at 02:00 server time (MINCRM-522).
  // Purges automation_rule_logs (>90d), webhook_delivery_logs (>30d),
  // and completed/failed import_jobs (>180d).
  const retentionCron = cron.schedule('0 2 * * *', () => {
    logger.info('cron: running log table retention purge');
    void runRetentionPurge();
  });
  logger.info('Log table retention cron scheduled (daily at 02:00)');

  process.once('SIGTERM', () => retentionCron.stop());
  process.once('SIGINT', () => retentionCron.stop());

  // audit_log partition maintenance — runs at midnight UTC on the 1st of each month (MINCRM-521).
  // Pre-creates audit_log_y{YYYY}m{MM} partitions for the current month + 3 months ahead,
  // ensuring no writes ever land on audit_log_default due to a missing partition.
  // timezone: 'UTC' ensures the cron fires at 00:00 UTC regardless of server local time,
  // keeping the fire time aligned with UTC-based partition boundaries.
  const auditPartitionCron = cron.schedule(
    '0 0 1 * *',
    () => {
      logger.info('cron: running audit_log partition maintenance');
      ensureAuditLogPartitions().catch((err: unknown) => {
        logger.error(
          { err },
          'cron: audit_log partition maintenance failed — rows may route to audit_log_default',
        );
      });
    },
    { timezone: 'UTC' },
  );
  logger.info('Audit log partition cron scheduled (monthly on the 1st at 00:00 UTC)');

  process.once('SIGTERM', () => auditPartitionCron.stop());
  process.once('SIGINT', () => auditPartitionCron.stop());
}
