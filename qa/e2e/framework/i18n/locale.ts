/**
 * Translation engine for E2E text-based locator strategies.
 *
 * This module is a pure engine — it ships with no pre-loaded strings. Every
 * key-value pair is application knowledge and must be supplied by the app layer
 * via registerLocaleExtension() before any call to t() will succeed.
 *
 * Calling t() without a registered map for the active locale throws a RangeError.
 * This is correct and intentional behaviour, not an error to be worked around.
 *
 * Design principle:
 *   - Framework exports: t(), registerLocaleExtension(), setLocale(),
 *     activeLocale(), and the LocaleCode / LocaleMap types.
 *   - App layer responsibility: call registerLocaleExtension() at fixture startup
 *     with a full locale map for every supported locale code.
 */

/**
 * Locale codes supported by this engine.
 * Extend this union and supply a matching entry via registerLocaleExtension()
 * when adding a new locale to an application.
 */
export type LocaleCode = 'en' | 'es' | 'fr' | 'de' | 'zh-Hans';

/**
 * A flat map from dotted key to translated string.
 * Keys mirror the nested path in the application's locale JSON files
 * (e.g. "nav.dashboard" → "Dashboard").
 */
export type LocaleMap = Record<string, string>;

/** All registered locale maps indexed by locale code. Populated entirely by app-layer calls. */
const LOCALE_MAPS: Partial<Record<LocaleCode, LocaleMap>> = {};

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

/**
 * Merges additional locale keys into the registered locale maps.
 *
 * Call this once at app-fixture startup to register all app-domain keys before
 * any test creates a Page Object. Extension keys are merged additively — calling
 * this multiple times is safe; each call adds or overwrites the keys provided.
 *
 * @param extension - Partial map of locale code → key/value pairs to register.
 */
export function registerLocaleExtension(extension: Partial<Record<LocaleCode, LocaleMap>>): void {
  for (const [code, keys] of Object.entries(extension) as [LocaleCode, LocaleMap][]) {
    const existing = LOCALE_MAPS[code];
    if (existing !== undefined) {
      Object.assign(existing, keys);
    } else {
      LOCALE_MAPS[code] = { ...keys };
    }
  }
}

// ---------------------------------------------------------------------------
// Active locale resolution
// ---------------------------------------------------------------------------

/** Overrides the active locale at runtime (e.g. from i18n E2E specs). */
let _runtimeLocale: LocaleCode | null = null;

/**
 * Sets the active locale at runtime, allowing i18n E2E tests to switch the
 * framework locale to match the language being tested.
 *
 * @param code - The locale code to activate.
 */
export function setLocale(code: LocaleCode): void {
  _runtimeLocale = code;
}

/**
 * Returns the active locale code. Priority order:
 * 1. Runtime override set via `setLocale()`.
 * 2. The `E2E_LOCALE` environment variable.
 * 3. Falls back to "en" if neither is set or the value is unregistered.
 */
export function activeLocale(): LocaleCode {
  if (_runtimeLocale !== null) {
    return _runtimeLocale;
  }
  const envLocale = process.env['E2E_LOCALE'];
  if (envLocale && envLocale in LOCALE_MAPS) {
    return envLocale as LocaleCode;
  }
  return 'en';
}

// ---------------------------------------------------------------------------
// t() helper
// ---------------------------------------------------------------------------

/**
 * Resolves a dotted key to its translated string in the given locale.
 *
 * Throws a `RangeError` if:
 * - The locale has no registered map (registerLocaleExtension() was not called).
 * - The key does not exist in that map.
 *
 * This ensures typos surface at test time, not as empty selectors that
 * silently match nothing.
 *
 * @param key - Dotted locale key (e.g. "login.submitButton").
 * @param locale - Locale code to resolve against. Defaults to `activeLocale()`.
 * @returns The translated string for the key.
 * @throws {RangeError} If the locale or key is unknown.
 *
 * @example
 * ```ts
 * const label = t('login.submitButton');           // uses E2E_LOCALE
 * const labelEs = t('login.submitButton', 'es');   // explicit locale
 * ```
 */
export function t(key: string, locale?: LocaleCode): string {
  const resolvedLocale = locale ?? activeLocale();
  const map = LOCALE_MAPS[resolvedLocale];

  if (map === undefined) {
    throw new RangeError(
      `t(): no locale map registered for locale "${resolvedLocale}". ` +
        `Call registerLocaleExtension() at app fixture startup before invoking t(). ` +
        `Registered locales: ${Object.keys(LOCALE_MAPS).join(', ') || '(none)'}`,
    );
  }

  const value = map[key];
  if (value === undefined) {
    throw new RangeError(
      `t(): unknown key "${key}" in locale "${resolvedLocale}". ` +
        `Available keys: ${Object.keys(map).join(', ')}`,
    );
  }

  return value;
}
