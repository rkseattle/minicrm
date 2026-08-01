/**
 * Unit tests for the client's UTC calendar-day helpers. (MINCRM-700)
 *
 * These seed AiUsageDashboardPage's default custom range and DealsPage's
 * default close date. Both are sent to the server and compared against
 * timezone-naive `date` columns resolved in UTC, so a locally-derived day
 * disagrees with the server about which date it is.
 *
 * Every case pins an explicit instant rather than reading the clock. CI runs
 * TZ=Pacific/Auckland (see ci.yml), where the local and UTC constructions
 * genuinely differ, so a revert to local calendar fields fails here.
 */

import { describe, it, expect } from 'vitest';
import { todayIso, firstOfMonthIso } from './utcDate.js';

// 22:30 UTC on the last day of July 2026 — already 2026-08-01 in any zone more
// than 90 minutes ahead of UTC, still 2026-07-31 for zones behind it.
const MONTH_END_UTC = new Date('2026-07-31T22:30:00.000Z');

describe('todayIso', () => {
  it('returns the UTC calendar day, not the local one', () => {
    expect(todayIso(MONTH_END_UTC)).toBe('2026-07-31');
  });

  it('returns a UTC midnight boundary unchanged', () => {
    expect(todayIso(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });
});

describe('firstOfMonthIso', () => {
  it('returns the first of the UTC month', () => {
    expect(firstOfMonthIso(MONTH_END_UTC)).toBe('2026-07-01');
  });

  it('zero-pads a single-digit month', () => {
    expect(firstOfMonthIso(new Date('2026-03-15T12:00:00.000Z'))).toBe('2026-03-01');
  });

  it('uses the UTC month at a year boundary', () => {
    // 23:30Z on Dec 31 is already January in UTC+13 — the local construction
    // would name 2027-01-01 while the server is still in December.
    expect(firstOfMonthIso(new Date('2026-12-31T23:30:00.000Z'))).toBe('2026-12-01');
  });
});

describe('the two helpers together', () => {
  it('derive the default custom range from the same UTC day', () => {
    expect(firstOfMonthIso(MONTH_END_UTC)).toBe('2026-07-01');
    expect(todayIso(MONTH_END_UTC)).toBe('2026-07-31');
  });

  it('never produce a range whose start is after its end', () => {
    // Sampled across a full year of month-end instants. Mixing a local month
    // start with a UTC "today" inverts the range for a UTC-ahead viewer on
    // every one of these, and the API rejects an inverted range with a 400.
    for (let month = 0; month < 12; month++) {
      const lastInstantOfMonth = new Date(Date.UTC(2026, month + 1, 0, 23, 30));
      expect(firstOfMonthIso(lastInstantOfMonth) <= todayIso(lastInstantOfMonth)).toBe(true);
    }
  });
});
