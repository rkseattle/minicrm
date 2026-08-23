/**
 * The inventory of background jobs the server runs.
 *
 * Declared here rather than inline in server.ts so the schedule is one list a
 * test can enumerate and the operations guide can be pinned against. server.ts
 * registers from it; nothing else should schedule work directly.
 */

import cron, { type ScheduledTask } from 'node-cron';
import logger from '../logger.js';
import { sendOverdueDigests } from './notificationService.js';
import { advanceDueEnrollments } from './sequenceService.js';
import { runRetentionPurge } from './retentionService.js';
import { analyzeWinLossPatterns } from './winLossAnalysisService.js';
import { detectChurnExpansionSignals } from './churnExpansionService.js';
import { computeAccountHealthScores } from './relationshipHealthService.js';
import { computeFollowUpTimingSuggestions } from './followUpTimingService.js';
import { generateRepCoachingInsights } from './repCoachingService.js';
import { runDataHygieneScan } from './dataHygieneService.js';
import { ensureAuditLogPartitions } from './auditPartitionService.js';
import { startRolloutScheduler, stopRolloutScheduler } from './featureFlagService.js';
import { runCoverageRetentionPruning } from '../coverageAgent/coverageRetentionScheduler.js';

/** A job driven by a cron expression, or one polling on a fixed interval. */
export type ScheduledJobKind = 'cron' | 'interval';

interface ScheduledJobCommon {
  /** Stable identifier, also the label in the operations guide. */
  name: string;
  /** Cron expression, or a human interval for the interval kind. */
  schedule: string;
  /** The same schedule as the operations guide states it, so the two can be pinned. */
  displaySchedule: string;
  /** What the job does, in one line, for the operations guide. */
  purpose: string;
}

/**
 * A scheduled job.
 *
 * Discriminated on `kind` so a cron job cannot be declared without work to run —
 * an optional `run` would register a tick that logs and does nothing.
 */
export type ScheduledJob = ScheduledJobCommon &
  (
    | {
        kind: 'cron';
        /** Returns false when the tick was skipped, so the caller can stay quiet. */
        run: () => boolean;
        /** node-cron options, e.g. an explicit timezone. */
        options?: { timezone: string };
      }
    | { kind: 'interval'; start: () => void; stop: () => void }
  );

/**
 * Wraps `work` so a tick is skipped while the previous one is still running.
 *
 * Each job gets its own flag via closure — a shared one would let a slow job
 * suppress an unrelated job's tick.
 */
function skipWhileRunning(label: string, work: () => Promise<unknown>): () => boolean {
  let running = false;
  return () => {
    if (running) {
      logger.warn(`cron: ${label} still in progress — skipping tick`);
      return false;
    }
    running = true;
    void work().finally(() => {
      running = false;
    });
    return true;
  };
}

/** Runs `work`, logging a rejection rather than leaving it unhandled. */
function logRejection(message: string, work: () => Promise<unknown>): () => boolean {
  return () => {
    work().catch((err: unknown) => {
      logger.error({ err }, message);
    });
    return true;
  };
}

/**
 * Every scheduled job, in fire-time order.
 *
 * `coverageRetentionDays` is passed in because it is resolved once at boot;
 * re-reading it per tick would let a mid-run env change take effect silently.
 */
export function buildScheduledJobs(coverageRetentionDays: number): ScheduledJob[] {
  return [
    {
      name: 'Log table retention purge',
      kind: 'cron',
      schedule: '0 2 * * *',
      displaySchedule: 'Daily, 02:00',
      purpose:
        'Purges automation_rule_logs (>90d), webhook_delivery_logs (>30d), and completed/failed import_jobs (>180d).',
      run: () => {
        void runRetentionPurge();
        return true;
      },
    },
    {
      name: 'Win/loss pattern analysis',
      kind: 'cron',
      schedule: '0 3 * * *',
      displaySchedule: 'Daily, 03:00',
      purpose:
        'Replaces deal_win_loss_insights from all closed deals. No-ops when AI is disabled or below the minimum closed-deal threshold.',
      run: () => {
        void analyzeWinLossPatterns();
        return true;
      },
    },
    {
      name: 'Churn/expansion signal detection',
      kind: 'cron',
      schedule: '0 4 * * *',
      displaySchedule: 'Daily, 04:00',
      purpose:
        'Rescans closed-won accounts with activity history for churn-risk or expansion signals. No-ops when AI is disabled.',
      run: () => {
        void detectChurnExpansionSignals();
        return true;
      },
    },
    {
      name: 'Relationship health scoring',
      kind: 'cron',
      schedule: '0 5 * * *',
      displaySchedule: 'Daily, 05:00',
      purpose:
        'Recomputes the cached health score for every account meeting the configured minimum logged activities (default 3). SQL-driven, no AI call.',
      run: () => {
        void computeAccountHealthScores();
        return true;
      },
    },
    {
      name: 'Follow-up timing suggestions',
      kind: 'cron',
      schedule: '30 5 * * *',
      displaySchedule: 'Daily, 05:30',
      purpose:
        'Recomputes the cached best-time-to-contact suggestion for every contact with 5+ logged interactions.',
      run: () => {
        void computeFollowUpTimingSuggestions();
        return true;
      },
    },
    {
      name: 'Rep coaching insights',
      kind: 'cron',
      schedule: '0 6 * * *',
      displaySchedule: 'Daily, 06:00',
      purpose:
        'Recomputes coaching insights for every rep meeting the minimum closed-deal count. SQL-driven, no AI call.',
      run: () => {
        void generateRepCoachingInsights();
        return true;
      },
    },
    {
      name: 'Data hygiene scan',
      kind: 'cron',
      schedule: '30 6 * * *',
      displaySchedule: 'Daily, 06:30',
      purpose:
        'Checks records for stale or invalid data using MX lookups and website reachability. Skips a tick while the previous scan is still running.',
      run: skipWhileRunning('data hygiene scan', runDataHygieneScan),
    },
    {
      name: 'Coverage/TIA retention pruning',
      kind: 'cron',
      schedule: '0 7 * * *',
      displaySchedule: 'Daily, 07:00',
      purpose:
        'Deletes coverage_units, coverage_test_links, coverage_ingested_dumps, and coverage_sessions rows older than the retention window. Runs regardless of COVERAGE_INSTRUMENTATION.',
      run: logRejection('cron: coverage retention pruning failed', () =>
        runCoverageRetentionPruning(coverageRetentionDays),
      ),
    },
    {
      name: 'Overdue task digest',
      kind: 'cron',
      schedule: '0 8 * * *',
      displaySchedule: 'Daily, 08:00',
      purpose:
        'Emails each opted-in user one digest of their open tasks past due, deduplicated so a task is notified once.',
      run: () => {
        void sendOverdueDigests();
        return true;
      },
    },
    {
      name: 'Sequence step advancement',
      kind: 'cron',
      schedule: '*/15 * * * *',
      displaySchedule: 'Every 15 minutes',
      purpose:
        'Advances due sequence enrollments to their next step. Skips a tick while the previous run is still in progress.',
      run: skipWhileRunning('sequence advancement', advanceDueEnrollments),
    },
    {
      name: 'Audit log partition maintenance',
      kind: 'cron',
      schedule: '0 0 1 * *',
      displaySchedule: 'Monthly, 1st at 00:00 UTC',
      // The only job with an explicit timezone: partition boundaries are UTC, so
      // firing on server local time would straddle them near month end.
      options: { timezone: 'UTC' },
      purpose:
        'Pre-creates audit_log partitions for the current month and three ahead, so no write lands on audit_log_default.',
      run: logRejection(
        'cron: audit_log partition maintenance failed — rows may route to audit_log_default',
        ensureAuditLogPartitions,
      ),
    },
    {
      name: 'Feature flag rollout advancement',
      kind: 'interval',
      schedule: 'every 60 seconds',
      displaySchedule: 'Every 60 seconds',
      purpose: 'Advances feature flags whose next rollout stage has come due.',
      start: startRolloutScheduler,
      stop: stopRolloutScheduler,
    },
  ];
}

/**
 * Starts every job and returns a function that stops them all.
 *
 * One returned stopper rather than a handler per job: at twelve jobs, a pair of
 * signal listeners each would exceed Node's default max-listeners warning.
 */
export function startScheduledJobs(coverageRetentionDays: number): () => void {
  const started: ScheduledTask[] = [];
  const stoppers: Array<() => void> = [];

  for (const job of buildScheduledJobs(coverageRetentionDays)) {
    if (job.kind === 'interval') {
      job.start();
      stoppers.push(job.stop);
      logger.info(`Scheduled ${job.name} (${job.schedule})`);
      continue;
    }
    const task = cron.schedule(
      job.schedule,
      () => {
        // Logged only when the tick proceeds: a skipped re-entrant tick logging
        // "running" then "skipping" would over-count runs for anything parsing logs.
        if (job.run()) logger.info(`cron: running ${job.name}`);
      },
      job.options,
    );
    started.push(task);
    logger.info(`Scheduled ${job.name} (${job.schedule})`);
  }

  return () => {
    for (const task of started) task.stop();
    for (const stop of stoppers) stop();
  };
}
