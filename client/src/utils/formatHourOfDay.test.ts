/**
 * Tests for the formatHourOfDay utility. (MINCRM-470)
 */

import { describe, it, expect } from 'vitest';
import { formatHourOfDay } from './formatHourOfDay.js';

describe('formatHourOfDay', () => {
  it('formats a morning hour in English 12-hour convention', () => {
    expect(formatHourOfDay(9, 'en')).toBe('9 AM');
  });

  it('formats an afternoon hour in English 12-hour convention', () => {
    expect(formatHourOfDay(14, 'en')).toBe('2 PM');
  });

  it('normalizes hour 24 to midnight (hour 0)', () => {
    expect(formatHourOfDay(24, 'en')).toBe(formatHourOfDay(0, 'en'));
  });

  it('formats using the target locale, not always English', () => {
    const german = formatHourOfDay(14, 'de');
    const english = formatHourOfDay(14, 'en');
    expect(german).not.toBe(english);
  });
});
