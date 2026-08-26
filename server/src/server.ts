/**
 * HTTP server entry point.
 * Imports the Express app and starts listening on the configured port.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown.
 * Registers an unhandledRejection handler to surface fire-and-forget failures.
 */

import 'dotenv/config';
import http from 'http';
import app from './app.js';
import logger from './logger.js';
import { initSentry, captureException } from './sentry.js';
import { runMigrations, runCoverageMigrations } from './migrate.js';
import { seedDefaultAdmin } from './services/userService.js';
import { ensureAuditLogPartitions } from './services/auditPartitionService.js';
import { startScheduledJobs } from './services/scheduledJobs.js';
import pool from './db.js';
import { auditEventBus } from './services/auditEventBus.js';
import { NodeV8CoverageAgent } from './coverageAgent/NodeV8CoverageAgent.js';
import { COVERAGE_DUMPS_ROOT, resolveCoverageConfig } from './coverageAgent/coverageConfig.js';
import { resolveCoveragePolicy } from './coverageAgent/coveragePolicyConfig.js';
import { SDK_VERSION } from './coverageAgent/sdk/CoverageAgentPlugin.js';
import { registerCoverageAgent } from './coverageAgent/coverageAgentRegistry.js';
import { unrecognizedEnvMessage } from './utils/nodeEnv.js';

/** Default port for the API server */
const DEFAULT_PORT = 3001;

initSentry();

/** Known-weak JWT_SECRET values that must be rejected at startup */
const WEAK_JWT_SECRETS = new Set(['changeme', 'secret', 'password', '']);

/** Expected byte length of NODE_ENCRYPTION_KEY expressed as hex chars (32 bytes × 2) */
const ENCRYPTION_KEY_HEX_LENGTH = 64;

/** Drain timeout in milliseconds before forcing process exit */
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Boot on a recognized environment or not at all. The allowlists in nodeEnv.ts
// fail closed, so a typo is safe but silent — this is what makes it audible.
const envProblem = unrecognizedEnvMessage();
if (envProblem) {
  throw new Error(envProblem);
}

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

// Validate NODE_ENCRYPTION_KEY at startup so operators discover
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

// Warn when SMTP_FROM is configured but DKIM signing is absent.
// Without DKIM, outbound mail from a custom domain is likely to land in spam.
// This is a non-fatal advisory — the server continues to start normally.
if (process.env.SMTP_FROM && !process.env.SMTP_DKIM_PRIVATE_KEY) {
  logger.warn(
    'SMTP_FROM is set but SMTP_DKIM_PRIVATE_KEY is not configured. ' +
      'Outbound emails may be rejected or delivered to spam. ' +
      'See docs/operations.md#email-deliverability for SPF/DKIM/DMARC setup instructions.',
  );
}

// Log and report unhandled promise rejections (e.g. from fire-and-forget automation triggers —)
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

// Coverage/TIA instrumentation. Disabled unless
// COVERAGE_INSTRUMENTATION=true — an unset env var means start()/stop() are
// never called and this has zero effect on a normal boot.
const coverageConfig = resolveCoverageConfig();

// Coverage/TIA policy — resolved once here at boot, not inside
// the retention cron's closure; re-resolving it on every daily tick forever
// would violate coveragePolicyConfig.ts's own "resolve once, pass the
// result down" contract — see coverageRetentionScheduler.ts's own docblock
// for the full rationale. Passed the coverageConfig already resolved above
// rather than letting resolveCoveragePolicy() resolve its own — that
// resolution shells out to `git rev-parse HEAD` (coverageConfig.ts), and
// doing so a second time on every boot for a commitSha this call doesn't
// even use was a redundant subprocess (found via Greptile branch review).
const { retentionDays: coverageRetentionDays } = resolveCoveragePolicy(coverageConfig);
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
  logger.info({ ...coverageAgent.metadata, sdkVersion: SDK_VERSION }, 'Coverage agent registered');
}

// Disable Nagle's algorithm for all connections so that small streaming frames
// (e.g. the ConnectRPC stream-ready sentinel) are delivered immediately rather
// than being buffered until the TCP send buffer fills.
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
    // on COVERAGE_INSTRUMENTATION) since the session-management, mapping,
    // and reporting routers each have their own boot-time env var and can
    // be enabled independently of the backend V8 agent itself (
    // see docs/dev/coverage.md's Coverage Database section).
    await runCoverageMigrations();
    await seedDefaultAdmin();
    await auditEventBus.start(pool);
    // Ensure audit_log partitions exist for the current month + 3 months ahead.
    // Runs at startup so partitions are guaranteed before any writes occur,
    // regardless of when the monthly cron last fired.
    await ensureAuditLogPartitions();
  } catch (err) {
    logger.error({ err }, 'Startup initialization failed');
    process.exit(1); // eslint-disable-line n/no-process-exit
  }

  server.listen(port, () => {
    logger.info(`MiniCRM API server listening on port ${port}`);
  });
})();

// Background jobs. The inventory lives in services/scheduledJobs.ts so the
// schedule is one enumerable list rather than twelve inline registrations.
//
// Skipped only when NODE_ENV=test. CI is not exempt: docker-compose.test.yml sets
// NODE_ENV=development, so the E2E stack does schedule every job.
if (process.env.NODE_ENV !== 'test') {
  const stopScheduledJobs = startScheduledJobs(coverageRetentionDays);
  process.once('SIGTERM', stopScheduledJobs);
  process.once('SIGINT', stopScheduledJobs);
}
