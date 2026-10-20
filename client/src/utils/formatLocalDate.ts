/**
 * Formats a date value for display using the active locale.
 *
 * Two input shapes are supported:
 *  - Date-only strings (YYYY-MM-DD): parsed as UTC midnight to avoid timezone-driven
 *    day shifts (e.g. "2025-01-15" must never display as Jan 14 due to a negative UTC offset).
 *  - Full ISO timestamp strings or Date objects: passed directly to Intl.DateTimeFormat.
 *
 * @param value  - ISO date string (YYYY-MM-DD or full timestamp) or Date, or null/undefined
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns      Locale-formatted date string, or '—' when value is absent
 */
export function formatLocalDate(value: string | Date | null | undefined, locale: string): string {
  if (!value) return '—';

  let date: Date;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Date-only: append UTC midnight so the day is never shifted by local timezone offset
    date = new Date(`${value}T00:00:00Z`);
  } else {
    date = typeof value === 'string' ? new Date(value) : value;
  }

  if (isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : undefined,
  }).format(date);
}

/**
 * Formats an instant as a date and time in the viewer's timezone and the active locale.
 *
 * For timestamps only: a date-only `YYYY-MM-DD` has no time to show, so use
 * `formatLocalDate` for those.
 *
 * @param value  - Full ISO timestamp string or Date, or null/undefined
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns      Locale-formatted date and time, or '—' when value is absent or invalid
 */
export function formatLocalDateTime(
  value: string | Date | null | undefined,
  locale: string,
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
/** Past this many days a relative label stops helping, so the date is shown instead. */
const RELATIVE_DAYS_LIMIT = 7;

/**
 * Formats a past instant relative to now ("3 hours ago"), in the active locale, falling back
 * to `formatLocalDate` once it is a week old.
 *
 * @param value  - Full ISO timestamp string or Date, or null/undefined
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @param now    - The current time in milliseconds; injectable for tests
 * @returns      Locale-formatted relative time, or '—' when value is absent or invalid
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  locale: string,
  now: number = Date.now(),
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return '—';

  const seconds = Math.floor((now - date.getTime()) / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (minutes < 1) return relative.format(0, 'second');
  if (hours < 1) return relative.format(-minutes, 'minute');
  if (days < 1) return relative.format(-hours, 'hour');
  if (days < RELATIVE_DAYS_LIMIT) return relative.format(-days, 'day');
  return formatLocalDate(date, locale);
}

/**
 * The viewer's own calendar day as `YYYY-MM-DD`, for a file name. A download named by the
 * UTC day reads as tomorrow to anyone west of UTC in the evening.
 */
export function localDateStamp(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
