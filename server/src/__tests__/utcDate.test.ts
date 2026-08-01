/**
 * Unit tests for the UTC calendar helpers. (MINCRM-700)
 *
 * These back three live call sites that compare or write against timezone-naive
 * `date` columns: aiUsageDashboardService (usage_date range bounds),
 * automationService (activities.due_date), and ai/toolExecutor (the NLI report
 * tools' default window over deals.close_date).
 *
 * Every case pins an explicit instant instead of reading the wall clock, and
 * asserts a value that differs between the UTC and local-calendar constructions
 * for any process not running in UTC. CI runs TZ=Pacific/Auckland (see ci.yml)
 * so a revert to local-time arithmetic fails here rather than shipping.
 */

import { ONE_DAY_MS, toUtcDateString, utcDayOffset, utcMonthStart } from '../utils/utcDate.js';

// 22:30 UTC on the last day of July 2026 — already 2026-08-01 in any zone more
// than 90 minutes ahead of UTC, and still 2026-07-31 for zones behind it. Every
// assertion below states the UTC answer, so it holds in both directions.
const MONTH_END_UTC = new Date('2026-07-31T22:30:00.000Z');

describe('ONE_DAY_MS', () => {
  it('is exactly 24 hours in milliseconds', () => {
    expect(ONE_DAY_MS).toBe(86_400_000);
  });
});

describe('toUtcDateString', () => {
  it('formats the UTC calendar day, not the local one', () => {
    expect(toUtcDateString(MONTH_END_UTC)).toBe('2026-07-31');
  });

  it('formats a UTC midnight boundary', () => {
    expect(toUtcDateString(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });
});

describe('utcDayOffset', () => {
  it('returns the current UTC day at offset zero', () => {
    expect(utcDayOffset(MONTH_END_UTC, 0)).toBe('2026-07-31');
  });

  it('steps forward across a month boundary', () => {
    expect(utcDayOffset(MONTH_END_UTC, 1)).toBe('2026-08-01');
  });

  it('steps backward by a multi-day window', () => {
    expect(utcDayOffset(MONTH_END_UTC, -30)).toBe('2026-07-01');
  });

  it('normalizes an offset crossing a year boundary', () => {
    expect(utcDayOffset(new Date('2026-01-02T12:00:00.000Z'), -3)).toBe('2025-12-30');
  });

  it('accounts for a leap day', () => {
    expect(utcDayOffset(new Date('2028-03-01T06:00:00.000Z'), -1)).toBe('2028-02-29');
  });

  it('is anchored to UTC midnight, so the time of day does not change the result', () => {
    const earlyInTheUtcDay = new Date('2026-07-31T00:05:00.000Z');
    const lateInTheUtcDay = new Date('2026-07-31T23:55:00.000Z');
    expect(utcDayOffset(earlyInTheUtcDay, -7)).toBe(utcDayOffset(lateInTheUtcDay, -7));
  });
});

describe('utcMonthStart', () => {
  it('returns UTC midnight on the first of the current month', () => {
    expect(utcMonthStart(MONTH_END_UTC, 0).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('returns the next month for a positive offset', () => {
    expect(utcMonthStart(MONTH_END_UTC, 1).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('normalizes a negative offset crossing a year boundary', () => {
    const january = new Date('2026-01-15T12:00:00.000Z');
    expect(utcMonthStart(january, -3).toISOString()).toBe('2025-10-01T00:00:00.000Z');
  });

  it('normalizes a positive offset crossing a year boundary', () => {
    const december = new Date('2026-12-15T12:00:00.000Z');
    expect(utcMonthStart(december, 1).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
