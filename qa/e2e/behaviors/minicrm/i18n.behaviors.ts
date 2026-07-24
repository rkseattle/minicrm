/**
 * i18n / pseudolocalization behaviors for MiniCRM.
 *
 * Encapsulates browser-evaluated language switching and page reload helpers
 * so spec files never call page.evaluate() or page.reload() directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-418
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import type { SafePage } from '@framework/types/safe-page.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by i18n behaviors. */
export interface I18nBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// Browser-side evaluate functions
// These run inside page.evaluate() — must not reference Node.js globals.
// Written as plain function expressions to avoid TypeScript DOM type errors
// in the Node-targeted qa tsconfig (lib: ["ES2022"]).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// applyPseudoLocale()
// ---------------------------------------------------------------------------

/**
 * Locks window.i18n so any FUTURE changeLanguage() call other than ours is a
 * no-op — installed immediately before we switch to pseudo, so a delayed
 * in-flight call from the app's own initial-load language resolution (see
 * applyPseudoLocale's doc comment) cannot land afterward and overwrite it.
 * Returns a string error message if window.i18n is not present, null on success.
 */
const LOCK_TO_PSEUDO = new Function(`
  const w = window;
  if (!w.i18n) return 'window.i18n is not defined — check main.tsx exposure';
  const original = w.i18n.changeLanguage.bind(w.i18n);
  w.i18n.changeLanguage = (lng, ...rest) => {
    // Ignore any further call that isn't switching to pseudo — a no-op
    // resolved promise is sufficient since no caller in this app awaits or
    // reads changeLanguage()'s return value (it is always fired with void).
    if (lng !== 'pseudo') return Promise.resolve();
    return original(lng, ...rest);
  };
  return original('pseudo').then(() => null).catch((e) => String(e));
`) as () => Promise<string | null>;

/**
 * Switches the running app to pseudo locale via window.i18n and waits for the
 * nav to actually re-render with pseudo strings before returning.
 *
 * Two distinct races are guarded against here:
 *
 * 1. The locale switch is a pure client-side React state update — no network
 *    request is involved — so the switch resolving only confirms i18next's
 *    internal state changed, not that React has finished re-rendering with
 *    the new strings. A `networkidle` wait afterward resolves almost
 *    immediately (there is no network activity to wait for) and can return
 *    before the re-render completes. Every pseudo.json string is wrapped in
 *    `[...]` brackets (see client/src/locales/pseudo.json), so waiting for
 *    that marker on a known always-rendered nav element (the Dashboard link)
 *    is a reliable, specific DOM-condition wait instead.
 *
 * 2. A SEPARATE, easy-to-miss race: `useAuth` (client/src/hooks/useAuth.ts)
 *    fires a one-time `applyResolvedLanguage()` call after the first
 *    successful `/api/v1/auth/me` fetch on page load, which itself may fetch
 *    `/api/v1/settings/default-language` and call `i18n.changeLanguage(...)`
 *    if the user has no stored `preferred_language` (true for every ephemeral
 *    test user). By the time this function runs, that HTTP response has
 *    likely already arrived (the caller already waited for page-load
 *    networkidle) — but the async chain from "response received" to
 *    "changeLanguage() promise resolved and React re-rendered" is itself not
 *    tracked by any network-based wait, and can still be in flight. If it
 *    resolves AFTER this function's own pseudo switch, it silently overwrites
 *    the locale back to the system default moments later — exactly the
 *    failure observed in CI, where every string reverted to English despite
 *    the DOM wait confirming pseudo strings had rendered moments earlier.
 *    LOCK_TO_PSEUDO closes this race at its source (rather than polling for a
 *    late overwrite after the fact) by monkey-patching `changeLanguage` to
 *    reject any further call that isn't ours before the switch happens.
 *
 * @param context - Behavior context with page.
 */
export async function applyPseudoLocale(context: I18nBehaviorContext): Promise<void>;
/**
 * Overload that accepts a raw SafePage for backward-compat with call sites
 * that pass page directly before the context refactor.
 *
 * @deprecated Pass `{ page }` context object instead.
 */
export async function applyPseudoLocale(page: SafePage): Promise<void>;
export async function applyPseudoLocale(
  pageOrContext: I18nBehaviorContext | SafePage,
): Promise<void> {
  const page =
    'page' in (pageOrContext as I18nBehaviorContext)
      ? (pageOrContext as I18nBehaviorContext).page
      : (pageOrContext as SafePage);
  const err = await page.evaluate(LOCK_TO_PSEUDO);
  if (err) throw new Error(`applyPseudoLocale: ${err}`);
  await page.waitForFunction(
    `(document.querySelector('[data-testid="nav-top-dashboard"]')?.textContent ?? '').includes('[')`,
    undefined,
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// reloadAndWait()
// ---------------------------------------------------------------------------

/**
 * Reloads the current page and waits for network idle.
 * Use to confirm that a language or locale change persists across navigation.
 */
export async function reloadAndWait(context: I18nBehaviorContext): Promise<void> {
  await context.page.reload({ waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Pseudolocalization DOM inspection helpers (MINCRM-418)
// ---------------------------------------------------------------------------

/** Shape of a hardcoded-string finding. */
export interface HardcodedStringFinding {
  testId: string;
  text: string;
}

/** Shape of an overflowing-element finding. */
export interface OverflowFinding {
  testId: string;
  text: string;
  scrollWidth: number;
  clientWidth: number;
}

// Browser-side evaluate functions (not referenced at Node type-check level).
const FIND_HARDCODED_STRINGS = new Function(`
  const PLAIN_ASCII_RE = /^[A-Za-z][A-Za-z\\s]{2,}$/;
  const DATA_TESTID_RE = /-(record|subject|time)-/;
  const results = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode()) !== null) {
    const text = (node.textContent || '').trim();
    if (text.length <= 3) continue;
    if (!PLAIN_ASCII_RE.test(text)) continue;
    if (node.parentElement && node.parentElement.tagName === 'OPTION') continue;
    let el = node.parentElement;
    let testId = null;
    while (el && el !== document.body) {
      const tid = el.getAttribute('data-testid');
      if (tid) { testId = tid; break; }
      el = el.parentElement;
    }
    if (testId && !DATA_TESTID_RE.test(testId)) results.push({ testId, text });
  }
  return results;
`) as () => HardcodedStringFinding[];

const FIND_OVERFLOW_ELEMENTS = new Function(`
  const SELECTOR = 'nav a, button, th, [data-testid$="-badge"], [data-testid$="-card"]';
  const elements = Array.from(document.querySelectorAll(SELECTOR));
  return elements
    .filter((el) => el.scrollWidth > el.clientWidth)
    .map((el) => ({
      testId: el.getAttribute('data-testid') || el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 60),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
`) as () => OverflowFinding[];

/**
 * Evaluates the DOM to find elements with plain ASCII text that were not
 * translated. Returns an array of { testId, text } findings.
 */
export async function findHardcodedStrings(
  context: I18nBehaviorContext,
): Promise<HardcodedStringFinding[]> {
  return context.page.evaluate(FIND_HARDCODED_STRINGS) as Promise<HardcodedStringFinding[]>;
}

/**
 * Evaluates the DOM to find key UI containers with horizontal overflow.
 * Returns an array of { testId, text, scrollWidth, clientWidth } findings.
 */
export async function findOverflowingElements(
  context: I18nBehaviorContext,
): Promise<OverflowFinding[]> {
  return context.page.evaluate(FIND_OVERFLOW_ELEMENTS) as Promise<OverflowFinding[]>;
}
