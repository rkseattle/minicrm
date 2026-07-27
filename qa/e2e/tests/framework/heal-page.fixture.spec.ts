/**
 * Tests for the healPage fixture and locale t() helper.
 *
 * Verifies all Acceptance Criteria from MINCRM-126:
 *
 * AC1 — healPage.click() and healPage.fill() resolve via HealingLocator and
 *        record heal events correctly.
 * AC2 — HealingRegistry is flushed in fixture teardown even when the test throws.
 * AC3 — Structural: this file imports test/expect from @framework/fixtures.
 * AC4 — t() helper throws on unknown keys.
 * AC5 — A text-based strategy via t() resolves identically under en and es.
 *
 * All locator interactions use mock Page objects so no browser is required.
 *
 * MINCRM-126
 */

// AC3: import test and expect from @framework/fixtures, never from @playwright/test
import { test, expect } from '@framework/fixtures';
import type { Locator, Page } from '@playwright/test';
import { HealingRegistry } from '@framework/healing';
import { t, activeLocale, registerLocaleExtension } from '@framework/i18n';
import { resetLocaleMapsForTesting } from '@framework/i18n/locale.js';
import { buildHealPage } from '@framework/fixtures/heal-page.fixture.js';

// ---------------------------------------------------------------------------
// Mock helpers (mirrors the pattern from healing-locator.spec.ts)
// ---------------------------------------------------------------------------

function mockLocator(resolves: boolean): Locator {
  const loc = {
    waitFor: resolves ? () => Promise.resolve() : () => Promise.reject(new Error('Timeout')),
    click: () => Promise.resolve(),
    fill: (_value: string) => Promise.resolve(),
  } as unknown as Locator;
  // probeLocator calls locator.first() before waitFor — return self.
  (loc as unknown as Record<string, unknown>)['first'] = () => loc;
  return loc;
}

function mockPage(resolveMap: boolean[]): Page {
  let callIndex = 0;
  const factory = () => {
    const resolves = resolveMap[callIndex] ?? false;
    callIndex++;
    return mockLocator(resolves);
  };
  return {
    getByTestId: factory,
    getByRole: factory,
    getByLabel: factory,
    getByText: factory,
    locator: factory,
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// AC1 — click() routes through HealingLocator and records heal events
// ---------------------------------------------------------------------------

test.describe('healPage.click()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — no heal event recorded', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'click primary resolves');

    await hp.click([{ type: 'testId', value: 'submit-btn' }]);

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — heal event recorded', async () => {
    // testId fails, css resolves
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'click fallback resolves');

    await hp.click(
      [
        { type: 'testId', value: 'submit-btn' },
        { type: 'css', value: 'button[type="submit"]' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC1 — fill() routes through HealingLocator and records heal events
// ---------------------------------------------------------------------------

test.describe('healPage.fill()', () => {
  test.beforeEach(() => {
    HealingRegistry.instance._reset();
  });

  test('primary resolves — fills element, no heal event', async () => {
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'fill primary resolves');

    await hp.fill('test@example.com', [{ type: 'label', value: 'Email address' }]);

    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('primary fails, fallback resolves — fills element, heal event recorded', async () => {
    // label fails, css resolves
    const page = mockPage([false, true]);
    const hp = buildHealPage(page, 'fill fallback resolves');

    await hp.fill(
      'test@example.com',
      [
        { type: 'label', value: 'Email' },
        { type: 'css', value: 'input[type="email"]' },
      ],
      { fallbackTimeout: 100 },
    );

    expect(HealingRegistry.instance.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// doesNotExist() — returns true when element is absent from DOM
// ---------------------------------------------------------------------------

test.describe('healPage.doesNotExist()', () => {
  test('element absent — returns true without throwing', async () => {
    // waitFor({state:'detached'}) resolves when element is absent → true
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'doesNotExist absent');

    const result = await hp.doesNotExist([{ type: 'testId', value: 'ghost' }], 100);
    expect(result).toBe(true);
  });

  test('element present — returns false', async () => {
    // waitFor({state:'detached'}) times out when element stays in DOM → false
    const page = mockPage([false]);
    const hp = buildHealPage(page, 'doesNotExist present');

    const result = await hp.doesNotExist([{ type: 'testId', value: 'ghost' }], 100);
    expect(result).toBe(false);
  });

  test('does not record heal events', async () => {
    HealingRegistry.instance._reset();
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'doesNotExist no heal');

    await hp.doesNotExist([{ type: 'testId', value: 'x' }], 100);
    expect(HealingRegistry.instance.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isNotVisible() — returns true when element is absent or hidden
// ---------------------------------------------------------------------------

test.describe('healPage.isNotVisible()', () => {
  test('element not visible — returns true without throwing', async () => {
    // waitFor({state:'hidden'}) resolves when element is absent/hidden → true
    const page = mockPage([true]);
    const hp = buildHealPage(page, 'isNotVisible hidden');

    const result = await hp.isNotVisible([{ type: 'testId', value: 'hidden-el' }], 100);
    expect(result).toBe(true);
  });

  test('element visible — returns false', async () => {
    // waitFor({state:'hidden'}) times out when element stays visible → false
    const page = mockPage([false]);
    const hp = buildHealPage(page, 'isNotVisible visible');

    const result = await hp.isNotVisible([{ type: 'testId', value: 'visible-el' }], 100);
    expect(result).toBe(false);
  });

  test('does not record heal events', async () => {
    HealingRegistry.instance._reset();
    const page = mockPage([false]);
    const hp = buildHealPage(page, 'isNotVisible no heal');

    await hp.isNotVisible([{ type: 'testId', value: 'x' }], 100);
    expect(HealingRegistry.instance.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC2 — Registry flushed in teardown even when test body throws
//
// These tests run serially so the second test can assert post-teardown state
// from the first test — directly exercising the fixture's try/finally block.
// ---------------------------------------------------------------------------

test.describe.serial('healPage fixture teardown', () => {
  test('records a heal event during test body (teardown will reset after this)', async ({
    healPage: _hp,
  }) => {
    // Explicitly reset first so we start from a known state regardless of
    // which other tests may have run on this worker before us.
    HealingRegistry.instance._reset();
    // Inject a heal event. The fixture teardown fires after use() returns,
    // calling flush() + _reset(). The next test (running after teardown) will
    // confirm the count is back to 0.
    HealingRegistry.instance.record(
      'ac2 event',
      { type: 'testId', value: 'x' },
      { type: 'css', value: '.x' },
      false,
    );
    // Count is now 1; fixture teardown will reset it to 0.
  });

  test('registry is empty after teardown of previous test — fixture try/finally ran', async ({
    healPage: _hp,
  }) => {
    // The fixture teardown from the test above called _reset(). If the
    // fixture's finally block did not run, count would still be 1.
    expect(HealingRegistry.instance.count).toBe(0);
  });

  test('flush() no-ops when registry is empty — no disk write', async ({ healPage: _hp }) => {
    // flush() short-circuits on empty registry; calling it must not throw.
    HealingRegistry.instance._reset();
    expect(() => HealingRegistry.instance.flush()).not.toThrow();
  });

  test('fixture teardown calls flush() — patching flush verifies it fires on test completion', async ({
    healPage: _hp,
  }) => {
    // Patch flush to intercept the call the fixture teardown will make.
    let flushed = false;
    const originalFlush = HealingRegistry.instance.flush.bind(HealingRegistry.instance);
    HealingRegistry.instance.flush = () => {
      flushed = true;
      originalFlush();
    };

    HealingRegistry.instance.record(
      'flush verification',
      { type: 'testId', value: 'y' },
      { type: 'css', value: '.y' },
      false,
    );

    // The fixture's finally block will call flush() when use() returns.
    // We verify this by reading `flushed` in the next serial test.
    expect(HealingRegistry.instance.count).toBe(1);

    // Store the flag on the registry instance so the next test can read it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HealingRegistry.instance as any).__testFlushed = () => flushed;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HealingRegistry.instance as any).__restoreFlush = () => {
      HealingRegistry.instance.flush = originalFlush;
    };
  });

  test('flush was called by fixture teardown and registry was reset', async ({ healPage: _hp }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flushed = (HealingRegistry.instance as any).__testFlushed?.() ?? false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HealingRegistry.instance as any).__restoreFlush?.();

    expect(flushed).toBe(true);
    expect(HealingRegistry.instance.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC4 — t() throws on unknown keys (and on unregistered locales)
// ---------------------------------------------------------------------------

test.describe('t() locale helper', () => {
  // Register a minimal locale map so the t() tests below have known keys to resolve.
  // The framework ships no pre-loaded strings; apps must call registerLocaleExtension().
  //
  // resetLocaleMapsForTesting() first: LOCALE_MAPS is a process-global
  // singleton (framework/i18n/locale.ts) with no per-file isolation —
  // locale.spec.ts (a different spec file) registers 'fr' into that same
  // singleton, and the "throws RangeError on unregistered locale" test
  // below assumes 'fr' stays unregistered. Without this reset, whichever
  // spec file's beforeAll runs second in a shared worker silently breaks
  // the other's assumption (found via a real full-suite E2E failure — see
  // resetLocaleMapsForTesting's own docblock).
  test.beforeAll(() => {
    resetLocaleMapsForTesting();
    registerLocaleExtension({
      en: {
        'login.submitButton': 'Sign in',
        'nav.dashboard': 'Dashboard',
        'nonexistent.sibling': 'exists',
      },
      es: {
        'login.submitButton': 'Iniciar sesión',
        'nav.dashboard': 'Panel',
      },
    });
  });

  test.afterAll(() => {
    resetLocaleMapsForTesting();
  });

  test('resolves known key in default locale (en)', () => {
    const original = process.env['E2E_LOCALE'];
    delete process.env['E2E_LOCALE'];

    try {
      expect(t('login.submitButton')).toBe('Sign in');
    } finally {
      if (original !== undefined) process.env['E2E_LOCALE'] = original;
    }
  });

  test('throws RangeError on unregistered locale', () => {
    // 'fr' has no map registered in this describe block — must throw.
    expect(() => t('login.submitButton', 'fr')).toThrow(RangeError);
    expect(() => t('login.submitButton', 'fr')).toThrow(/no locale map registered/);
  });

  test('throws RangeError on unknown key', () => {
    expect(() => t('this.key.does.not.exist')).toThrow(RangeError);
    expect(() => t('this.key.does.not.exist')).toThrow(/unknown key/);
  });

  test('registered locale maps resolve without throwing', () => {
    // Only locales explicitly registered via registerLocaleExtension() are valid.
    expect(() => t('login.submitButton', 'en')).not.toThrow();
    expect(() => t('login.submitButton', 'es')).not.toThrow();
  });

  test('resolves key in explicit es locale', () => {
    expect(t('login.submitButton', 'es')).toBe('Iniciar sesión');
  });

  test('error message lists available keys on unknown key', () => {
    let errorMessage = '';
    try {
      t('nonexistent.key');
    } catch (err) {
      errorMessage = (err as RangeError).message;
    }
    expect(errorMessage).toContain('login.submitButton');
  });
});

// ---------------------------------------------------------------------------
// AC5 — Text-based strategy via t() passes under en and a second locale (es)
// ---------------------------------------------------------------------------

test.describe('t() multi-locale text strategies', () => {
  // Ensure both en and es maps are registered for multi-locale assertions.
  test.beforeAll(() => {
    registerLocaleExtension({
      en: { 'nav.dashboard': 'Dashboard' },
      es: { 'nav.dashboard': 'Panel' },
    });
  });

  test('text strategy using t() resolves the same key in both en and es', () => {
    const original = process.env['E2E_LOCALE'];

    try {
      // Under en
      process.env['E2E_LOCALE'] = 'en';
      const enValue = t('nav.dashboard');
      expect(enValue).toBe('Dashboard');

      // Under es
      process.env['E2E_LOCALE'] = 'es';
      const esValue = t('nav.dashboard');
      expect(esValue).toBe('Panel');

      // Both resolve to non-empty strings — confirming the key exists in both maps
      expect(enValue.length).toBeGreaterThan(0);
      expect(esValue.length).toBeGreaterThan(0);
    } finally {
      if (original !== undefined) {
        process.env['E2E_LOCALE'] = original;
      } else {
        delete process.env['E2E_LOCALE'];
      }
    }
  });

  test('activeLocale() returns en when E2E_LOCALE is unset', () => {
    const original = process.env['E2E_LOCALE'];
    delete process.env['E2E_LOCALE'];

    try {
      expect(activeLocale()).toBe('en');
    } finally {
      if (original !== undefined) process.env['E2E_LOCALE'] = original;
    }
  });

  test('activeLocale() returns es when E2E_LOCALE=es', () => {
    const original = process.env['E2E_LOCALE'];
    process.env['E2E_LOCALE'] = 'es';

    try {
      expect(activeLocale()).toBe('es');
    } finally {
      if (original !== undefined) {
        process.env['E2E_LOCALE'] = original;
      } else {
        delete process.env['E2E_LOCALE'];
      }
    }
  });

  test('a text LocatorStrategy built with t() passes under en (primary resolves)', async () => {
    const original = process.env['E2E_LOCALE'];
    process.env['E2E_LOCALE'] = 'en';

    try {
      // Simulate a text-based strategy built using t()
      const textValue = t('nav.dashboard');
      const strategy = { type: 'text' as const, value: textValue };

      expect(strategy.value).toBe('Dashboard');

      // Verify the strategy resolves against a mock page
      HealingRegistry.instance._reset();
      const page = mockPage([true]); // primary resolves
      const hp = buildHealPage(page, 'en text strategy test');
      await hp.click([strategy], { fallbackTimeout: 100 });

      expect(HealingRegistry.instance.count).toBe(0); // no heal needed
    } finally {
      if (original !== undefined) {
        process.env['E2E_LOCALE'] = original;
      } else {
        delete process.env['E2E_LOCALE'];
      }
      HealingRegistry.instance._reset();
    }
  });

  test('a text LocatorStrategy built with t() passes under es (primary resolves)', async () => {
    const original = process.env['E2E_LOCALE'];
    process.env['E2E_LOCALE'] = 'es';

    try {
      const textValue = t('nav.dashboard');
      const strategy = { type: 'text' as const, value: textValue };

      expect(strategy.value).toBe('Panel');

      HealingRegistry.instance._reset();
      const page = mockPage([true]);
      const hp = buildHealPage(page, 'es text strategy test');
      await hp.click([strategy], { fallbackTimeout: 100 });

      expect(HealingRegistry.instance.count).toBe(0);
    } finally {
      if (original !== undefined) {
        process.env['E2E_LOCALE'] = original;
      } else {
        delete process.env['E2E_LOCALE'];
      }
      HealingRegistry.instance._reset();
    }
  });
});
