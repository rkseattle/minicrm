/**
 * UTC calendar-day helpers for values sent to the API.
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

/** Formats a Date as a UTC `YYYY-MM-DD` string. */
function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar day in UTC, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return toIso(now);
}

/** The first day of the UTC calendar month containing `now`, as `YYYY-MM-DD`. */
export function firstOfMonthIso(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * The UTC calendar day `dayOffset` days from `now`, as `YYYY-MM-DD`.
 *
 * Anchored to UTC midnight rather than shifting the local instant: across a DST
 * transition a local `setDate(n)` moves the wall clock 24h per day but the
 * instant 23h or 25h, so the serialized day can land off by one.
 */
export function dayOffsetIso(now: Date = new Date(), dayOffset = 0): string {
  return toIso(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset)),
  );
}

/**
 * The first day of the UTC calendar month `monthOffset` months from `now`.
 * `Date.UTC` normalizes an out-of-range month, so offsets crossing a year
 * boundary need no special handling.
 */
export function monthStartIso(now: Date = new Date(), monthOffset = 0): string {
  return toIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1)));
}

/**
 * The last day of the UTC calendar month `monthOffset` months from `now`.
 *
 * Day 0 of the following month is the last day of this one — computed in UTC,
 * so it cannot land in the wrong month the way a local `new Date(y, m + 1, 0)`
 * does for a viewer ahead of UTC.
 */
export function monthEndIso(now: Date = new Date(), monthOffset = 0): string {
  return toIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset + 1, 0)));
}

/**
 * The first day of the UTC calendar quarter `quarterOffset` quarters from `now`.
 * Quarters start in January, April, July, and October.
 */
export function quarterStartIso(now: Date = new Date(), quarterOffset = 0): string {
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 + quarterOffset * 3;
  return toIso(new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)));
}

/** The last day of the UTC calendar quarter `quarterOffset` quarters from `now`. */
export function quarterEndIso(now: Date = new Date(), quarterOffset = 0): string {
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 + quarterOffset * 3;
  return toIso(new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 0)));
}

/**
 * The Monday of the UTC week containing `now`, as `YYYY-MM-DD`.
 *
 * `getUTCDay()` returns 0 for Sunday, which belongs to the week that started six
 * days earlier rather than the one starting tomorrow.
 */
export function weekStartIso(now: Date = new Date()): string {
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return dayOffsetIso(now, diffToMonday);
}
