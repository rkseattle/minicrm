/**
 * Formats an hour-of-day integer (0-23) as a locale-appropriate, timezone-agnostic
 * clock time string (e.g. "9 AM", "14:00", depending on locale) — used for
 * displaying a follow-up-timing suggestion's hour_start/hour_end, which are
 * plain hour integers already projected into the target display timezone by
 * the server, not full Date/timestamp values.
 *
 * @param hour   - Hour of day, 0-23 (24 is treated as midnight/0 — see
 *                 followUpTimingService.ts's hour_end_utc convention).
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans").
 */
export function formatHourOfDay(hour: number, locale: string): string {
  const normalizedHour = hour % 24;
  // Anchor to an arbitrary UTC date/hour and format in UTC so the locale's
  // hour-cycle/AM-PM convention is applied without any timezone shift —
  // the hour value itself is already the correct local wall-clock hour.
  const anchor = new Date(Date.UTC(1970, 0, 1, normalizedHour));
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: undefined,
    timeZone: 'UTC',
  }).format(anchor);
}
