/**
 * UTC calendar-day helpers for values sent to the API. (MINCRM-700)
 *
 * The server stores these against timezone-naive `date` columns
 * (`ai_token_usage_daily.usage_date`, `deals.close_date`) written under a UTC
 * Postgres session, and compares them against UTC-resolved boundaries. A day
 * derived from the browser's LOCAL calendar fields names a different date than
 * the server does whenever the viewer isn't in UTC — which shifts a default
 * close date by a day, or inverts a date range so the API rejects it outright.
 *
 * `now` is injectable so tests can pin an instant without faking global timers.
 *
 * See docs/dev/dates-and-timezones.md for the full convention.
 */

/** Today's calendar day in UTC, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The first day of the UTC calendar month containing `now`, as `YYYY-MM-DD`. */
export function firstOfMonthIso(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
