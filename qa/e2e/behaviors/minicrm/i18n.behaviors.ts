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

/**
 * Switches the running app to 'pseudo' locale via the exposed window.i18n handle.
 * Returns a string error message if the switch fails, null on success.
 */
const SWITCH_TO_PSEUDO = new Function(`
  const w = window;
  if (!w.i18n) return 'window.i18n is not defined — check main.tsx exposure';
  return w.i18n.changeLanguage('pseudo').then(() => null).catch((e) => String(e));
`) as () => Promise<string | null>;

// ---------------------------------------------------------------------------
// applyPseudoLocale()
// ---------------------------------------------------------------------------

/**
 * Switches the running app to pseudo locale via window.i18n and waits for the
 * nav to actually re-render with pseudo strings before returning.
 *
 * The locale switch is a pure client-side React state update — no network
 * request is involved — so `page.evaluate(SWITCH_TO_PSEUDO)` resolving only
 * confirms i18next's internal state changed, not that React has finished
 * re-rendering with the new strings. A `networkidle` wait afterward resolves
 * almost immediately (there is no network activity to wait for) and can
 * return before the re-render completes, letting the caller read stale
 * English text — a real observed race under CI load. Every pseudo.json
 * string is wrapped in `[...]` brackets (see client/src/locales/pseudo.json),
 * so waiting for that marker on a known always-rendered nav element (the
 * Dashboard link) is a reliable, specific DOM-condition wait instead.
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
  const err = await page.evaluate(SWITCH_TO_PSEUDO);
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
