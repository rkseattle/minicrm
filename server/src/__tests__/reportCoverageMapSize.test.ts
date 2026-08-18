/**
 * Unit tests for the coverage-map size gate.
 *
 * WHY THIS MATTERS
 * ----------------
 * This is not a reporting nicety — tia-record-mode.yml gates the "Commit
 * updated coverage map" step on this script's outcome. Get the decision wrong
 * in one direction and a legitimate map is blocked at the end of a multi-hour
 * run; wrong in the other and an oversized file is pushed and rejected by
 * GitHub at that same last step, which is exactly what the gate exists to turn
 * into an early, legible failure.
 *
 * The decision is separated from the database read precisely so it can be
 * tested without a database and without materializing a 100MB fixture.
 */

import { describe, it, expect } from 'vitest';
import { buildCoverageMapSizeReport } from '../scripts/report-coverage-map-size.js';

const MB = 1024 * 1024;
const LIMIT = 100 * MB;

const stats = {
  rawRows: 120_000,
  distinctShas: 40,
  collapsedEntries: 3_000,
  distinctTests: 600,
  distinctUnits: 1_500,
};

describe('buildCoverageMapSizeReport', () => {
  it('reports under-limit as committable', () => {
    const { overLimit } = buildCoverageMapSizeReport(stats, 30 * MB);
    expect(overLimit).toBe(false);
  });

  it('reports over-limit as not committable', () => {
    const { overLimit, markdown } = buildCoverageMapSizeReport(stats, LIMIT + 1);
    expect(overLimit).toBe(true);
    expect(markdown).toContain('cannot be committed');
  });

  it('treats exactly the limit as committable', () => {
    // The boundary matters: GitHub rejects files LARGER than the limit, so a
    // map of exactly 100MB is fine and blocking it would fail a good run.
    const { overLimit } = buildCoverageMapSizeReport(stats, LIMIT);
    expect(overLimit).toBe(false);
  });

  it('does not warn when the map is under the limit', () => {
    const { markdown } = buildCoverageMapSizeReport(stats, 30 * MB);
    expect(markdown).not.toContain('cannot be committed');
  });

  it('handles an absent map without claiming it is over the limit', () => {
    // bytes = 0 is what the caller passes when the file does not exist. A
    // missing map is not an oversized one.
    const { overLimit, markdown } = buildCoverageMapSizeReport(stats, 0);
    expect(overLimit).toBe(false);
    expect(markdown).toContain('| Map size | 0.0 MB |');
  });

  it('renders every measured count into the summary table', () => {
    // These counts are the input to deciding whether the layout needs to change
    // again, so a silently-dropped row would cost a whole record-mode run.
    const { markdown } = buildCoverageMapSizeReport(stats, 30 * MB);
    expect(markdown).toContain('| Rows in coverage_test_links | 120000 |');
    expect(markdown).toContain('| Distinct commit SHAs | 40 |');
    expect(markdown).toContain('| Entries after collapse | 3000 |');
    expect(markdown).toContain('| Distinct test IDs | 600 |');
    expect(markdown).toContain('| Distinct code units | 1500 |');
  });

  it('reports headroom as a percentage of the limit', () => {
    const { markdown } = buildCoverageMapSizeReport(stats, 50 * MB);
    expect(markdown).toContain('50.0%');
  });
});
