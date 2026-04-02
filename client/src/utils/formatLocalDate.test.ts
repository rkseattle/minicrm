/**
 * Unit tests for the formatLocalDate utility.
 * Covers: date-only strings, full ISO timestamps, Date objects,
 * null/undefined/invalid inputs, and locale variation.
 */

import { describe, it, expect } from 'vitest';
import { formatLocalDate } from './formatLocalDate.js';

describe('formatLocalDate', () => {
  it('formats a YYYY-MM-DD string in English', () => {
    expect(formatLocalDate('2026-12-31', 'en')).toBe('Dec 31, 2026');
  });

  it('formats a YYYY-MM-DD string in German', () => {
    // Derive the expected string at runtime so the test stays in sync with the ICU
    // data bundled in the current Node.js version rather than encoding a hardcoded string.
    const expected = new Intl.DateTimeFormat('de', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-12-31T00:00:00Z'));
    expect(formatLocalDate('2026-12-31', 'de')).toBe(expected);
  });

  it('formats a YYYY-MM-DD string in French', () => {
    const expected = new Intl.DateTimeFormat('fr', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-12-31T00:00:00Z'));
    expect(formatLocalDate('2026-12-31', 'fr')).toBe(expected);
  });

  it('formats a YYYY-MM-DD string in zh-Hans without falling back to default locale', () => {
    const expected = new Intl.DateTimeFormat('zh-Hans', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date('2026-12-31T00:00:00Z'));
    expect(formatLocalDate('2026-12-31', 'zh-Hans')).toBe(expected);
  });

  it('does not shift the day due to local timezone offset for date-only strings', () => {
    // '2026-01-01' must always render as Jan 1, never Dec 31 due to negative UTC offsets
    expect(formatLocalDate('2026-01-01', 'en')).toBe('Jan 1, 2026');
  });

  it('formats a full ISO timestamp string', () => {
    // Use noon UTC so the displayed day is the same regardless of local timezone offset
    expect(formatLocalDate('2025-01-01T12:00:00.000Z', 'en')).toBe('Jan 1, 2025');
  });

  it('formats a Date object', () => {
    expect(formatLocalDate(new Date('2025-06-15T12:00:00.000Z'), 'en')).toBe('Jun 15, 2025');
  });

  it('returns — for null', () => {
    expect(formatLocalDate(null, 'en')).toBe('—');
  });

  it('returns — for undefined', () => {
    expect(formatLocalDate(undefined, 'en')).toBe('—');
  });

  it('returns — for an empty string', () => {
    expect(formatLocalDate('', 'en')).toBe('—');
  });

  it('returns — for an invalid date string', () => {
    expect(formatLocalDate('not-a-date', 'en')).toBe('—');
  });
});
