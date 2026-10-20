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
