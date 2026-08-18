/**
 * UTC calendar helpers for values compared against timezone-naive `date`
 * columns.
 *
 * Postgres sessions in this stack run Etc/UTC, so `date` columns
 * (`ai_token_usage_daily.usage_date`, `deals.close_date`, `activities.due_date`)
 * are written and compared against a UTC "today". A boundary derived from the
 * Node process's LOCAL calendar fields names a different day than the database
 * does whenever the process timezone isn't UTC — which drops the edge days of a
 * range, or writes a due date that reads as overdue a day early.
 *
 * `now` is injectable throughout so tests can pin an instant without faking
 * global timers: vitest's setSystemTime requires vi.useFakeTimers(), which
 * cannot wrap pool.query (it hangs on the pool's connection/idle timeouts).
 *
 * See docs/dev/dates-and-timezones.md for the full convention.
 */

/** One day in milliseconds. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats a Date as a UTC 'YYYY-MM-DD' string.
 *
 * Bind this rather than a bare Date against a `date` column: node-postgres
 * infers the wire type from the target column and serializes `date` params
 * using the JS Date's LOCAL calendar fields, shifting the bound day off-UTC.
 */
export function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The UTC calendar day `dayOffset` days from the one containing `now`, as
 * 'YYYY-MM-DD'. A negative offset looks backwards.
 *
 * Anchored to UTC midnight rather than to `now` itself, so the result depends
 * only on which UTC day it is — not on the time of day or the process's local
 * offset. Date.UTC normalizes out-of-range days, so an offset crossing a month
 * or year boundary needs no special handling.
 */
export function utcDayOffset(now: Date, dayOffset: number): string {
  const shifted = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset),
  );
  return toUtcDateString(shifted);
}

/**
 * The start of the UTC calendar month `monthOffset` months from the one
 * containing `now`. Date.UTC normalizes out-of-range months, so an offset
 * crossing a year boundary (December + 1, January - 3) needs no special
 * handling.
 */
export function utcMonthStart(now: Date, monthOffset: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
}
