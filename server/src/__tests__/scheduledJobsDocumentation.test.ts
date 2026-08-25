/**
 * Pins docs/operations.md's Scheduled Jobs table to the job inventory.
 *
 * Bidirectional: a job added without a row fails, and a row left behind by a
 * deleted job fails too. A one-directional check would let the table keep
 * advertising work the server no longer does.
 *
 * A second assertion sweeps the docs that describe a job without owning its
 * schedule, so a duplicated schedule fails rather than drifting.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildScheduledJobs } from '../services/scheduledJobs.js';
import { expectGuardIsTriggered } from './ciFilterWiring.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const COVERAGE_RETENTION_DAYS = 30;
const OPERATIONS_DOC = resolve(REPO_ROOT, 'docs/operations.md');

/** Docs that describe a job but must not restate its schedule. */
const NO_SCHEDULE_LITERAL_DOCS = [
  'docs/admin-guide.md',
  'docs/dev/retention.md',
  'docs/dev/schema.md',
  'docs/dev/coverage.md',
  'README.md',
];

/**
 * The phrasings these docs actually used before their schedules were collapsed.
 *
 * Deliberately not a general classifier for "states a schedule" — regex over
 * English does not converge. This catches a reintroduced copy in the form it
 * previously took, and lets a reworded one through; the pairwise table pin
 * above is what makes the schedules themselves authoritative.
 */
const SCHEDULE_LITERAL =
  /\b(runs?|running|purged?|scheduled?|fires?)\b[^.\n]{0,30}\b(daily|nightly|hourly|monthly|every)\b[^.\n]{0,30}\b\d{1,2}:\d{2}\b|\b(daily|nightly|hourly|monthly)\b[^.\n]{0,20}\b(at|,)\s*\**\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\s+server time\b/i;

/** The Scheduled Jobs table rows, bounded to that section. */
function readScheduledJobsTable(): string[] {
  const doc = readFileSync(OPERATIONS_DOC, 'utf8');
  const start = doc.indexOf('## Scheduled Jobs');
  expect(start, 'docs/operations.md needs a "## Scheduled Jobs" section').toBeGreaterThan(-1);
  const next = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, next === -1 ? undefined : next);

  return section
    .split('\n')
    .filter(
      (line) => line.startsWith('| ') && !line.startsWith('| ---') && !line.startsWith('| Job'),
    );
}

describe('Scheduled Jobs documentation', () => {
  it('documents every job with the schedule it actually runs on', () => {
    const rows = readScheduledJobsTable();
    const documented = new Map(
      rows.map((row) => {
        const cells = row.split('|').map((cell) => cell.trim());
        return [cells[1] ?? '', cells[2] ?? ''];
      }),
    );

    const expected = buildScheduledJobs(COVERAGE_RETENTION_DAYS).map((job) => [
      job.name,
      job.displaySchedule,
    ]);

    // Pairs, not names: a table that lists every job but states the wrong time
    // is the drift this guard exists to catch, now that operations.md is the
    // only place the schedules are written down.
    expect(expected.map(([name]) => [name, documented.get(name) ?? null])).toEqual(expected);
  });

  it('documents no job the server does not run', () => {
    const rows = readScheduledJobsTable();
    const names = new Set(buildScheduledJobs(COVERAGE_RETENTION_DAYS).map((job) => job.name));

    const stale = rows
      .map((row) => row.split('|')[1]?.trim() ?? '')
      .filter((name) => name.length > 0 && !names.has(name));

    expect(stale, 'rows in docs/operations.md naming a job that no longer exists').toEqual([]);
  });

  it('has one row per job', () => {
    expect(readScheduledJobsTable()).toHaveLength(
      buildScheduledJobs(COVERAGE_RETENTION_DAYS).length,
    );
  });

  it.each([
    'Changes take effect on the next nightly run at 02:00.',
    'The scan runs nightly at **06:30 server time**.',
    'Purged daily at 02:00 by `runRetentionPurge()`.',
    'Coaching runs nightly at **06:00 server time**.',
  ])('recognizes %s as a restated schedule', (line) => {
    expect(SCHEDULE_LITERAL.test(line)).toBe(true);
  });

  it.each([
    'A nightly 03:00 UTC cron was removed: the map is a function of the code.',
    'Business hours in the example run 09:00 to 17:00.',
    'The retention window is 30 days.',
  ])('leaves %s alone', (line) => {
    // A guard whose only failure mode is silence needs its non-matches pinned
    // too: over-broad, it flags prose about CI crons and worked examples.
    expect(SCHEDULE_LITERAL.test(line)).toBe(false);
  });

  it.each(NO_SCHEDULE_LITERAL_DOCS)('%s does not restate a schedule', (relative) => {
    const doc = readFileSync(resolve(REPO_ROOT, relative), 'utf8');

    const offenders = doc
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      .filter(([, line]) => SCHEDULE_LITERAL.test(line));

    // These docs describe the jobs; operations.md owns when they run.
    expect(offenders, `${relative} should link to Scheduled Jobs instead`).toEqual([]);
  });

  it('the files read here trigger the job that runs this guard', () => {
    expectGuardIsTriggered({
      output: 'scheduled-jobs-docs',
      job: 'server-tests',
      filesRead: ['docs/operations.md', ...NO_SCHEDULE_LITERAL_DOCS],
    });
  });
});
