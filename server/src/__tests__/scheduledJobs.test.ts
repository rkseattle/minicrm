/**
 * Unit tests for the scheduled-job inventory.
 *
 * server.ts is imported by no test — it binds a port and runs migrations — so
 * this is the only automated cover for the registration it delegates here.
 *
 * The expected inventory is written out literally rather than derived from the
 * module: an expectation computed from the code under test passes for any
 * inventory, including an empty one.
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import cron from 'node-cron';
import logger from '../logger.js';
import { buildScheduledJobs, startScheduledJobs } from '../services/scheduledJobs.js';
import * as notificationService from '../services/notificationService.js';
import * as sequenceService from '../services/sequenceService.js';
import * as retentionService from '../services/retentionService.js';
import * as winLossAnalysisService from '../services/winLossAnalysisService.js';
import * as churnExpansionService from '../services/churnExpansionService.js';
import * as relationshipHealthService from '../services/relationshipHealthService.js';
import * as followUpTimingService from '../services/followUpTimingService.js';
import * as repCoachingService from '../services/repCoachingService.js';
import * as dataHygieneService from '../services/dataHygieneService.js';
import * as auditPartitionService from '../services/auditPartitionService.js';
import * as emailSyncService from '../services/emailSyncService.js';
import * as coverageRetentionScheduler from '../coverageAgent/coverageRetentionScheduler.js';

const COVERAGE_RETENTION_DAYS = 30;

/** The jobs the server is expected to run, in fire-time order. */
const EXPECTED_JOBS = [
  ['Log table retention purge', '0 2 * * *'],
  ['Win/loss pattern analysis', '0 3 * * *'],
  ['Churn/expansion signal detection', '0 4 * * *'],
  ['Relationship health scoring', '0 5 * * *'],
  ['Follow-up timing suggestions', '30 5 * * *'],
  ['Rep coaching insights', '0 6 * * *'],
  ['Data hygiene scan', '30 6 * * *'],
  ['Coverage/TIA retention pruning', '0 7 * * *'],
  ['Overdue task digest', '0 8 * * *'],
  ['Sequence step advancement', '*/15 * * * *'],
  ['Email sync', '*/15 * * * *'],
  ['Audit log partition maintenance', '0 0 1 * *'],
  ['Feature flag rollout advancement', 'every 60 seconds'],
] as const;

/** Which service each cron job must reach, by job name. */
const JOB_SERVICE_CALLS: ReadonlyArray<[string, object, string]> = [
  ['Log table retention purge', retentionService, 'runRetentionPurge'],
  ['Win/loss pattern analysis', winLossAnalysisService, 'analyzeWinLossPatterns'],
  ['Churn/expansion signal detection', churnExpansionService, 'detectChurnExpansionSignals'],
  ['Relationship health scoring', relationshipHealthService, 'computeAccountHealthScores'],
  ['Follow-up timing suggestions', followUpTimingService, 'computeFollowUpTimingSuggestions'],
  ['Rep coaching insights', repCoachingService, 'generateRepCoachingInsights'],
  ['Data hygiene scan', dataHygieneService, 'runDataHygieneScan'],
  ['Coverage/TIA retention pruning', coverageRetentionScheduler, 'runCoverageRetentionPruning'],
  ['Overdue task digest', notificationService, 'sendOverdueDigests'],
  ['Sequence step advancement', sequenceService, 'advanceDueEnrollments'],
  ['Email sync', emailSyncService, 'syncDueAccounts'],
  ['Audit log partition maintenance', auditPartitionService, 'ensureAuditLogPartitions'],
];

describe('the email sync interval', () => {
  it('drives the cron expression and its displayed schedule', () => {
    const jobs = buildScheduledJobs(COVERAGE_RETENTION_DAYS, 5);
    const sync = jobs.find((job) => job.name === 'Email sync');

    expect(sync?.schedule).toBe('*/5 * * * *');
    expect(sync?.displaySchedule).toBe('Every 5 minutes');
  });

  it('defaults to 15 minutes, which is what the docs row states', () => {
    const jobs = buildScheduledJobs(COVERAGE_RETENTION_DAYS);
    const sync = jobs.find((job) => job.name === 'Email sync');

    expect(sync?.schedule).toBe('*/15 * * * *');
    expect(sync?.displaySchedule).toBe('Every 15 minutes');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildScheduledJobs', () => {
  it('declares exactly the expected jobs, in fire-time order', () => {
    const jobs = buildScheduledJobs(COVERAGE_RETENTION_DAYS);

    expect(jobs.map((job) => [job.name, job.schedule])).toEqual(
      EXPECTED_JOBS.map(([name, schedule]) => [name, schedule]),
    );
  });

  it('gives every job a purpose for the operations guide', () => {
    for (const job of buildScheduledJobs(COVERAGE_RETENTION_DAYS)) {
      expect(job.purpose, `${job.name} needs a purpose`).toBeTruthy();
    }
  });

  it('sets an explicit timezone only where the schedule depends on one', () => {
    const withTimezone = buildScheduledJobs(COVERAGE_RETENTION_DAYS).filter(
      (job) => job.kind === 'cron' && job.options !== undefined,
    );

    // Partition boundaries are UTC; every other job runs on server local time.
    expect(withTimezone.map((job) => job.name)).toEqual(['Audit log partition maintenance']);
  });

  it.each(JOB_SERVICE_CALLS)('%s runs its own service', (name, service, method) => {
    const spy = vi
      .spyOn(service as Record<string, () => Promise<void>>, method)
      .mockResolvedValue(undefined);
    const job = buildScheduledJobs(COVERAGE_RETENTION_DAYS).find((entry) => entry.name === name);

    expect(job?.kind).toBe('cron');
    if (job?.kind !== 'cron') return;
    // A proceeding tick returns the work's promise; null means it was skipped.
    expect(job.run()).not.toBeNull();

    // A job wired to the wrong service still schedules and still logs; only
    // this assertion distinguishes it.
    expect(spy).toHaveBeenCalledOnce();
  });

  it('passes the boot-resolved retention window to the coverage prune', () => {
    const spy = vi
      .spyOn(coverageRetentionScheduler, 'runCoverageRetentionPruning')
      .mockResolvedValue(undefined as never);
    const job = buildScheduledJobs(COVERAGE_RETENTION_DAYS).find(
      (entry) => entry.name === 'Coverage/TIA retention pruning',
    );

    if (job?.kind !== 'cron') throw new Error('expected a cron job');
    job.run();

    expect(spy).toHaveBeenCalledWith(COVERAGE_RETENTION_DAYS);
  });

  it('skips a re-entrant tick rather than overlapping a slow run', async () => {
    let release: (() => void) | undefined;
    vi.spyOn(dataHygieneService, 'runDataHygieneScan').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }) as never,
    );
    const job = buildScheduledJobs(COVERAGE_RETENTION_DAYS).find(
      (entry) => entry.name === 'Data hygiene scan',
    );
    if (job?.kind !== 'cron') throw new Error('expected a cron job');

    expect(job.run(), 'first tick proceeds').not.toBeNull();
    expect(job.run(), 'second tick is skipped while the first is still running').toBeNull();

    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(job.run(), 'a tick after the run completes proceeds again').not.toBeNull();
  });

  it('keeps each re-entrancy guard private to its own job', () => {
    vi.spyOn(dataHygieneService, 'runDataHygieneScan').mockReturnValue(
      new Promise<void>(() => {}) as never,
    );
    vi.spyOn(sequenceService, 'advanceDueEnrollments').mockResolvedValue(undefined as never);
    const jobs = buildScheduledJobs(COVERAGE_RETENTION_DAYS);
    const hygiene = jobs.find((job) => job.name === 'Data hygiene scan');
    const sequence = jobs.find((job) => job.name === 'Sequence step advancement');
    if (hygiene?.kind !== 'cron' || sequence?.kind !== 'cron')
      throw new Error('expected cron jobs');

    hygiene.run();
    hygiene.run();

    // A guard shared between jobs would let the stalled scan suppress this tick.
    expect(sequence.run()).not.toBeNull();
  });

  it('surfaces a rejection to the caller rather than swallowing it', async () => {
    vi.spyOn(auditPartitionService, 'ensureAuditLogPartitions').mockRejectedValue(
      new Error('partition failure'),
    );
    const job = buildScheduledJobs(COVERAGE_RETENTION_DAYS).find(
      (entry) => entry.name === 'Audit log partition maintenance',
    );
    if (job?.kind !== 'cron') throw new Error('expected a cron job');

    // run() hands the rejection back so startScheduledJobs can log it with the
    // job name; swallowing it here would lose that attribution.
    await expect(job.run()).rejects.toThrow('partition failure');
  });
});

describe('startScheduledJobs', () => {
  it('schedules every cron job with its own expression', () => {
    const scheduled: string[] = [];
    vi.spyOn(cron, 'schedule').mockImplementation(((expression: string) => {
      scheduled.push(expression);
      return { stop: vi.fn() };
    }) as unknown as typeof cron.schedule);

    const stop = startScheduledJobs(COVERAGE_RETENTION_DAYS);

    expect(scheduled).toEqual(
      EXPECTED_JOBS.filter(([, schedule]) => schedule !== 'every 60 seconds').map(
        ([, schedule]) => schedule,
      ),
    );
    stop();
  });

  it('logs a tick only when the job actually runs', () => {
    const ticks = new Map<string, () => void>();
    vi.spyOn(cron, 'schedule').mockImplementation(((expression: string, handler: () => void) => {
      ticks.set(expression, handler);
      return { stop: vi.fn() };
    }) as unknown as typeof cron.schedule);
    const infoSpy = vi.spyOn(logger, 'info');
    let release: (() => void) | undefined;
    vi.spyOn(dataHygieneService, 'runDataHygieneScan').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }) as never,
    );

    const stop = startScheduledJobs(COVERAGE_RETENTION_DAYS);
    infoSpy.mockClear();

    const hygieneTick = ticks.get('30 6 * * *');
    hygieneTick?.();
    expect(infoSpy).toHaveBeenCalledWith('cron: running Data hygiene scan');

    // The skipped tick must not also claim to be running.
    infoSpy.mockClear();
    hygieneTick?.();
    expect(infoSpy).not.toHaveBeenCalledWith('cron: running Data hygiene scan');

    release?.();
    stop();
  });

  it('logs a rejecting job by name rather than letting it escape', async () => {
    const ticks = new Map<string, () => void>();
    vi.spyOn(cron, 'schedule').mockImplementation(((expression: string, handler: () => void) => {
      ticks.set(expression, handler);
      return { stop: vi.fn() };
    }) as unknown as typeof cron.schedule);
    const errorSpy = vi.spyOn(logger, 'error');
    vi.spyOn(auditPartitionService, 'ensureAuditLogPartitions').mockRejectedValue(
      new Error('partition failure'),
    );

    const stop = startScheduledJobs(COVERAGE_RETENTION_DAYS);
    ticks.get('0 0 1 * *')?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Unhandled, this reaches the process-level handler with no job name. The
    // consequence note is carried through too.
    const logged = errorSpy.mock.calls.find(
      ([, message]) =>
        typeof message === 'string' && message.includes('Audit log partition maintenance'),
    );
    expect(logged, 'the failure must name the job').toBeDefined();
    expect(String(logged?.[1])).toContain('rows may route to audit_log_default');

    stop();
  });

  it('stops every job through the single returned stopper', () => {
    const stops: Array<() => void> = [];
    vi.spyOn(cron, 'schedule').mockImplementation(((): unknown => {
      const stopFn = vi.fn();
      stops.push(stopFn);
      return { stop: stopFn };
    }) as unknown as typeof cron.schedule);

    const stop = startScheduledJobs(COVERAGE_RETENTION_DAYS);
    stop();

    // One stopper, not a signal handler per job: thirteen jobs registering a
    // SIGTERM and SIGINT handler each would cross Node's max-listeners warning.
    expect(stops).toHaveLength(EXPECTED_JOBS.length - 1);
    for (const stopFn of stops) {
      expect(stopFn).toHaveBeenCalledOnce();
    }
  });
});
