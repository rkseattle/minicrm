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
import {
  todayIso,
  firstOfMonthIso,
  dayOffsetIso,
  monthStartIso,
  monthEndIso,
  quarterStartIso,
  quarterEndIso,
  weekStartIso,
} from './utcDate.js';

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

// ── Report-filter boundaries (MINCRM-700) ────────────────────────────────────
//
// These back useReportFilters, whose values filter deals.close_date. Every case
// pins an instant where the local and UTC constructions disagree for a viewer
// ahead of UTC — the direction the old local-calendar helpers were wrong in.
// CI runs TZ=Pacific/Auckland, so a revert fails here rather than shipping.

// 23:30 UTC on the last day of August 2026: already 2026-09-01 in UTC+13.
const AUG_END_UTC = new Date('2026-08-31T23:30:00.000Z');

describe('monthStartIso / monthEndIso', () => {
  it('resolves the current month in UTC at a month-end instant', () => {
    expect(monthStartIso(AUG_END_UTC)).toBe('2026-08-01');
    // The old local `new Date(y, m + 1, 0)` returned 2026-09-29 here — a month
    // late, not a day. That is the defect this pins.
    expect(monthEndIso(AUG_END_UTC)).toBe('2026-08-31');
  });

  it('resolves the previous month, crossing a year boundary', () => {
    const jan = new Date('2026-01-15T12:00:00.000Z');
    expect(monthStartIso(jan, -1)).toBe('2025-12-01');
    expect(monthEndIso(jan, -1)).toBe('2025-12-31');
  });

  it('handles February in a leap year', () => {
    const feb = new Date('2028-02-15T12:00:00.000Z');
    expect(monthEndIso(feb)).toBe('2028-02-29');
  });

  it('never produces a start after its end, across a full year of month ends', () => {
    for (let month = 0; month < 12; month++) {
      const lastInstant = new Date(Date.UTC(2026, month + 1, 0, 23, 30));
      expect(monthStartIso(lastInstant) <= monthEndIso(lastInstant)).toBe(true);
      expect(monthStartIso(lastInstant, -1) <= monthEndIso(lastInstant, -1)).toBe(true);
    }
  });
});

describe('quarterStartIso / quarterEndIso', () => {
  it('resolves the current quarter in UTC', () => {
    expect(quarterStartIso(AUG_END_UTC)).toBe('2026-07-01');
    expect(quarterEndIso(AUG_END_UTC)).toBe('2026-09-30');
  });

  it('resolves the previous quarter, crossing a year boundary', () => {
    const jan = new Date('2026-01-15T12:00:00.000Z');
    expect(quarterStartIso(jan, -1)).toBe('2025-10-01');
    // The old local helper returned 2025-12-30 at this instant — a day early,
    // because `new Date(y, m + 1, 0)` resolved local midnight and serialized
    // back across the UTC boundary.
    expect(quarterEndIso(jan, -1)).toBe('2025-12-31');
  });

  it('maps every month to its own quarter', () => {
    const expected = [
      ['2026-01-01', '2026-03-31'],
      ['2026-04-01', '2026-06-30'],
      ['2026-07-01', '2026-09-30'],
      ['2026-10-01', '2026-12-31'],
    ];
    for (let month = 0; month < 12; month++) {
      const instant = new Date(Date.UTC(2026, month, 15, 12));
      const [start, end] = expected[Math.floor(month / 3)];
      expect(quarterStartIso(instant)).toBe(start);
      expect(quarterEndIso(instant)).toBe(end);
    }
  });
});

describe('weekStartIso', () => {
  it('returns the Monday of the UTC week', () => {
    // 2026-08-31 is a Monday; the instant is already Tuesday in UTC+13.
    expect(weekStartIso(AUG_END_UTC)).toBe('2026-08-31');
  });

  it('treats Sunday as the end of the week that began six days earlier', () => {
    const sunday = new Date('2026-08-30T12:00:00.000Z');
    expect(new Date(sunday).getUTCDay()).toBe(0);
    expect(weekStartIso(sunday)).toBe('2026-08-24');
  });

  it('is never after today, across a full year', () => {
    for (let day = 0; day < 365; day++) {
      const instant = new Date(Date.UTC(2026, 0, 1, 23, 30) + day * 86_400_000);
      expect(weekStartIso(instant) <= todayIso(instant)).toBe(true);
    }
  });
});

describe('dayOffsetIso', () => {
  it('is anchored to UTC midnight, so time of day does not change the result', () => {
    const early = new Date('2026-08-31T00:05:00.000Z');
    const late = new Date('2026-08-31T23:55:00.000Z');
    expect(dayOffsetIso(early, -1)).toBe(dayOffsetIso(late, -1));
    expect(dayOffsetIso(early, -1)).toBe('2026-08-30');
  });

  it('normalizes an offset crossing a year boundary', () => {
    expect(dayOffsetIso(new Date('2026-01-02T12:00:00.000Z'), -3)).toBe('2025-12-30');
  });
});
