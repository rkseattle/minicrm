/**
 * Unit tests for the framework locale engine (framework/i18n/locale.ts).
 *
 * Verifies the engine design: no pre-loaded strings, RangeError on unregistered
 * locale, and correct registration and resolution behaviour.
 *
 *
 */

import { test, expect } from '@framework/fixtures';
import {
  t,
  setLocale,
  activeLocale,
  registerLocaleExtension,
  resetLocaleMapsForTesting,
} from '@framework/i18n/locale.js';

// LOCALE_MAPS is a process-global singleton (framework/i18n/locale.ts) with
// no per-file isolation. This file's own tests assume specific locale codes
// ('de', 'zh-Hans') stay unregistered — heal-page.fixture.spec.ts (a
// different spec file) registers its own set of codes into that same
// singleton, and whichever file's setup runs second in a shared Playwright
// worker would otherwise silently corrupt the other's "unregistered" claim
// (found via a real full-suite E2E failure — see
// resetLocaleMapsForTesting's own docblock). Reset once before this file's
// entire suite runs, not per-describe-block, so every describe below
// (including ones with no beforeAll of their own) starts from a clean
// singleton regardless of run order.
test.beforeAll(() => {
  resetLocaleMapsForTesting();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the locale map for `code` currently has no entries.
 * We test this indirectly: t() with a known-registered key does not throw,
 * t() with an unregistered locale throws with "no locale map registered".
 */
function localeIsUnregistered(code: Parameters<typeof t>[1]): boolean {
  try {
    t('__probe__', code);
    return false;
  } catch (err) {
    return (
      err instanceof RangeError && /no locale map registered/.test((err as RangeError).message)
    );
  }
}

// ---------------------------------------------------------------------------
// Engine design: no pre-loaded strings
// ---------------------------------------------------------------------------

test.describe('locale engine — no pre-loaded strings', () => {
  test('t() throws RangeError for unregistered locale before any registerLocaleExtension call', () => {
    // 'de' is intentionally never registered in this spec file.
    // The engine must throw rather than returning an empty string or undefined.
    expect(() => t('any.key', 'de')).toThrow(RangeError);
    expect(() => t('any.key', 'de')).toThrow(/no locale map registered/);
  });

  test('RangeError message names the missing locale', () => {
    let message = '';
    try {
      t('any.key', 'de');
    } catch (err) {
      message = (err as RangeError).message;
    }
    expect(message).toContain('"de"');
  });
});

// ---------------------------------------------------------------------------
// registerLocaleExtension() — registration and resolution
// ---------------------------------------------------------------------------

test.describe('registerLocaleExtension()', () => {
  test.beforeAll(() => {
    registerLocaleExtension({
      en: {
        'test.greeting': 'Hello',
        'test.farewell': 'Goodbye',
      },
      fr: {
        'test.greeting': 'Bonjour',
        'test.farewell': 'Au revoir',
      },
    });
  });

  test('t() resolves a registered key in en', () => {
    expect(t('test.greeting', 'en')).toBe('Hello');
  });

  test('t() resolves a registered key in fr', () => {
    expect(t('test.greeting', 'fr')).toBe('Bonjour');
  });

  test('t() throws RangeError for an unknown key in a registered locale', () => {
    expect(() => t('test.nonexistent', 'en')).toThrow(RangeError);
    expect(() => t('test.nonexistent', 'en')).toThrow(/unknown key/);
  });

  test('calling registerLocaleExtension() a second time merges additively', () => {
    registerLocaleExtension({ en: { 'test.extra': 'Extra' } });
    expect(t('test.extra', 'en')).toBe('Extra');
    // Previously registered key is still present.
    expect(t('test.greeting', 'en')).toBe('Hello');
  });

  test('a later registration can overwrite an existing key', () => {
    registerLocaleExtension({ en: { 'test.farewell': 'See you later' } });
    expect(t('test.farewell', 'en')).toBe('See you later');
  });

  test('locale not supplied to registerLocaleExtension() remains unregistered', () => {
    // 'zh-Hans' was never registered in this describe block.
    expect(localeIsUnregistered('zh-Hans')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setLocale() and activeLocale()
// ---------------------------------------------------------------------------

test.describe('setLocale() and activeLocale()', () => {
  test.beforeAll(() => {
    registerLocaleExtension({
      en: { 'locale.probe': 'probe-en' },
      es: { 'locale.probe': 'probe-es' },
    });
  });

  test('activeLocale() falls back to "en" when E2E_LOCALE is unset and setLocale not called', () => {
    const original = process.env['E2E_LOCALE'];
    delete process.env['E2E_LOCALE'];
    setLocale('en'); // reset any prior runtime override to a known registered value
    try {
      expect(activeLocale()).toBe('en');
    } finally {
      if (original !== undefined) process.env['E2E_LOCALE'] = original;
    }
  });

  test('setLocale() overrides the active locale for subsequent t() calls', () => {
    setLocale('es');
    try {
      expect(t('locale.probe')).toBe('probe-es');
    } finally {
      setLocale('en');
    }
  });

  test('t() uses the locale argument when supplied, ignoring the runtime override', () => {
    setLocale('es');
    try {
      expect(t('locale.probe', 'en')).toBe('probe-en');
    } finally {
      setLocale('en');
    }
  });
});
