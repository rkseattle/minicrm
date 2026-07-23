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
import { runMigrations, runCoverageMigrations } from './migrate.js';
import { seedDefaultAdmin } from './services/userService.js';
import { sendOverdueDigests } from './services/notificationService.js';
import { advanceDueEnrollments } from './services/sequenceService.js';
import { runRetentionPurge } from './services/retentionService.js';
import { analyzeWinLossPatterns } from './services/winLossAnalysisService.js';
import { detectChurnExpansionSignals } from './services/churnExpansionService.js';
import { computeAccountHealthScores } from './services/relationshipHealthService.js';
import { computeFollowUpTimingSuggestions } from './services/followUpTimingService.js';
import { generateRepCoachingInsights } from './services/repCoachingService.js';
import { runDataHygieneScan } from './services/dataHygieneService.js';
import { ensureAuditLogPartitions } from './services/auditPartitionService.js';
import { startRolloutScheduler, stopRolloutScheduler } from './services/featureFlagService.js';
import pool from './db.js';
import { auditEventBus } from './services/auditEventBus.js';
import { NodeV8CoverageAgent } from './coverageAgent/NodeV8CoverageAgent.js';
import { COVERAGE_DUMPS_ROOT, resolveCoverageConfig } from './coverageAgent/coverageConfig.js';
import { registerCoverageAgent } from './coverageAgent/coverageAgentRegistry.js';

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

// Root cause of an intermittent CI E2E failure: `apiRequestContext.post:
// read ECONNRESET` on a POST that had nothing wrong with it. Node's
// http.Server default keepAliveTimeout is 5000ms, and this server has no
// reverse proxy in front of it in any deployment (Docker Compose, E2E, or
// CI) — clients connect directly, so this server's own idle timeout is the
// only one governing when a pooled keep-alive socket gets torn down.
// Playwright's `request` fixture is worker-scoped (one APIRequestContext,
// and its underlying keep-alive socket pool, reused across every test in
// that worker — see qa/e2e/framework/fixtures/rest-client.fixture.ts), so a
// multi-second gap between requests on the same socket (test teardown +
// next test's beforeEach) is routine, not exceptional. Confirmed directly:
// with the default 5000ms, a server-side socket's 'timeout'/'close' events
// fire ~6s after the prior response — squarely inside the client's normal
// idle gap between tests — racing any client attempt to reuse that socket
// and producing an ECONNRESET with nothing logged server-side, since the
// server closed the connection cleanly on its own schedule. Raised well
// above any realistic client idle gap to eliminate the race; headersTimeout
// must stay greater than keepAliveTimeout per Node's own constraint
// (violating it throws at listen time).
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;

// Coverage/TIA instrumentation (MINCRM-604). Disabled unless
// COVERAGE_INSTRUMENTATION=true — an unset env var means start()/stop() are
// never called and this has zero effect on a normal boot.
const coverageConfig = resolveCoverageConfig();
const coverageAgent = coverageConfig.enabled
  ? new NodeV8CoverageAgent({
      dumpsRoot: COVERAGE_DUMPS_ROOT,
      commitSha: coverageConfig.commitSha,
      granularity: coverageConfig.granularity,
    })
  : undefined;
if (coverageAgent) {
  // Makes the agent reachable from coverageDumpService without a
  // server.ts -> service -> server.ts import cycle.
  registerCoverageAgent(coverageAgent);
}

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

    if (coverageAgent) {
      // Isolated from the critical-path try/catch below: coverage dumping is
      // best-effort instrumentation, not part of graceful shutdown. A failure
      // here (disk full, unwritable dump dir, inspector session error) must
      // not be reported as a failed shutdown — the HTTP server, audit bus,
      // and DB pool have already closed successfully by this point.
      try {
        await coverageAgent.dump('shutdown');
        logger.info('Coverage: final shutdown dump written');
      } catch (err) {
        logger.warn({ err }, 'Coverage: final shutdown dump failed — shutdown continues normally');
      }
    }

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
    if (coverageAgent) {
      await coverageAgent.start();
    }
    await runMigrations();
    // Coverage/TIA tables live in their own database (see coverageDb.ts) —
    // migrated separately here so a server can never finish booting with
    // an unprovisioned coverage database. Runs unconditionally (not gated
    // on COVERAGE_INSTRUMENTATION) since coverage_session_management/
    // coverage_mapping_query can be exercised independently of the backend
    // V8 agent itself (see docs/dev/coverage.md's Coverage Database section).
    await runCoverageMigrations();
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

  // Win/loss pattern analysis — runs daily at 03:00 server time (MINCRM-464).
  // No-ops below the admin-configured minimum closed-deal threshold or when AI is
  // not enabled; replaces the full deal_win_loss_insights table contents on each run.
  const winLossAnalysisCron = cron.schedule('0 3 * * *', () => {
    logger.info('cron: running win/loss pattern analysis');
    void analyzeWinLossPatterns();
  });
  logger.info('Win/loss pattern analysis cron scheduled (daily at 03:00)');

  process.once('SIGTERM', () => winLossAnalysisCron.stop());
  process.once('SIGINT', () => winLossAnalysisCron.stop());

  // Churn/expansion signal detection — runs daily at 04:00 server time (MINCRM-469).
  // Scans closed-won accounts with activity history; no-ops when AI is not enabled.
  const churnExpansionCron = cron.schedule('0 4 * * *', () => {
    logger.info('cron: running churn/expansion signal detection');
    void detectChurnExpansionSignals();
  });
  logger.info('Churn/expansion signal detection cron scheduled (daily at 04:00)');

  process.once('SIGTERM', () => churnExpansionCron.stop());
  process.once('SIGINT', () => churnExpansionCron.stop());

  // Relationship health scoring — runs daily at 05:00 server time (MINCRM-467).
  // Deterministic/SQL-driven (no AI call) — scores every account with at least
  // one logged activity; the read path always serves the cached result.
  const relationshipHealthCron = cron.schedule('0 5 * * *', () => {
    logger.info('cron: running relationship health scoring');
    void computeAccountHealthScores();
  });
  logger.info('Relationship health scoring cron scheduled (daily at 05:00)');

  process.once('SIGTERM', () => relationshipHealthCron.stop());
  process.once('SIGINT', () => relationshipHealthCron.stop());

  // Follow-up timing suggestions — runs daily at 05:30 server time (MINCRM-470).
  // Recomputes the cached best-time-to-contact suggestion for every contact
  // whose interaction history changed since the last run.
  const followUpTimingCron = cron.schedule('30 5 * * *', () => {
    logger.info('cron: running follow-up timing suggestion refresh');
    void computeFollowUpTimingSuggestions();
  });
  logger.info('Follow-up timing suggestion cron scheduled (daily at 05:30)');

  process.once('SIGTERM', () => followUpTimingCron.stop());
  process.once('SIGINT', () => followUpTimingCron.stop());

  // Rep coaching insights — runs daily at 06:00 server time (MINCRM-474).
  // Deterministic/SQL-driven (no AI call) — recomputes coaching insights for
  // every rep with at least min_closed_deals closed deals; the read path
  // always serves the cached result.
  const repCoachingCron = cron.schedule('0 6 * * *', () => {
    logger.info('cron: running rep coaching insights generation');
    void generateRepCoachingInsights();
  });
  logger.info('Rep coaching insights cron scheduled (daily at 06:00)');

  process.once('SIGTERM', () => repCoachingCron.stop());
  process.once('SIGINT', () => repCoachingCron.stop());

  // Data hygiene assistant — runs daily at 06:30 server time (MINCRM-476).
  // Unlike the other nightly jobs above, this one does real per-record network
  // I/O (MX lookups, website reachability checks), so a re-entrancy guard
  // prevents overlapping runs if a scan takes longer than 24 hours on a large
  // dataset — mirrors the 15-minute sequence-enrollment cron's guard pattern.
  let dataHygieneScanRunning = false;
  const dataHygieneCron = cron.schedule('30 6 * * *', () => {
    if (dataHygieneScanRunning) {
      logger.warn('dataHygiene: previous scan still in progress — skipping this tick');
      return;
    }
    logger.info('cron: running data hygiene scan');
    dataHygieneScanRunning = true;
    void runDataHygieneScan().finally(() => {
      dataHygieneScanRunning = false;
    });
  });
  logger.info('Data hygiene scan cron scheduled (daily at 06:30)');

  process.once('SIGTERM', () => dataHygieneCron.stop());
  process.once('SIGINT', () => dataHygieneCron.stop());

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

  // Rollout stage advancement — checks every 60 seconds for flags with due stages (MINCRM-490).
  startRolloutScheduler();
  process.once('SIGTERM', () => stopRolloutScheduler());
  process.once('SIGINT', () => stopRolloutScheduler());
}
