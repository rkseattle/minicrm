/**
 * Custom ESLint rule: no-page-direct-in-spec
 *
 * Enforces that spec files (qa/e2e/tests/apps/**‌/*.spec.ts) do not call
 * navigation or interaction methods directly on the `page` fixture. These
 * calls belong in behavior functions (qa/e2e/behaviors/) or page objects
 * (qa/e2e/pages/), not in spec bodies.
 *
 * WHY THIS EXISTS
 * ---------------
 * The three-layer architecture is:
 *   specs  →  behaviors  →  page objects  →  HealingLocator
 *
 * `no-page-forbidden-methods` blocks raw Playwright query methods
 * (getByTestId, locator, etc.) in both spec and behavior files. But it
 * intentionally allows HealMethods and navigation calls everywhere, because
 * those are valid in behaviors and page objects. That allowlist means a spec
 * can call page.goto(), page.click(), page.waitForPresent(), page.evaluate()
 * etc. directly without any lint error — bypassing the behavior layer silently.
 *
 * This rule closes that gap for spec files specifically. Behaviors keep full
 * access; only specs are restricted.
 *
 * FORBIDDEN IN SPEC FILES (belong in a behavior or page object)
 * -------------------------------------------------------------
 *   Navigation:    goto, reload, goBack, goForward, waitForURL
 *   Interaction:   click, fill, check, uncheck, hover, selectOption,
 *                  evaluate, waitForFunction, waitForEvent,
 *                  waitForRequest, waitForResponse
 *   Querying:      locate, waitFor, textContent, getAttribute, count,
 *                  doesNotExist, isNotVisible
 *   DOM waits:     waitForPresent, waitForAbsent, waitForPainted
 *   Load waits:    waitForLoadState (except post-mockRoute patterns —
 *                  see note below)
 *
 * ALLOWED IN SPEC FILES (spec-level concerns with no behavior equivalent)
 * -----------------------------------------------------------------------
 *   page.setViewportSize()  — test-matrix viewport configuration
 *   page.mockRoute()        — network interception (test-local mock setup)
 *   page.unmockRoute()      — mock cleanup mid-test
 *   page.unmockAllRoutes()  — mock cleanup in afterEach
 *   page.waitForTimeout()   — deliberate user-perceived pause
 *   page.waitForLoadState() — settling after mockRoute / network interception
 *                             (post-intercept networkidle is a spec concern)
 *   page.on/once/removeListener — event listener registration (rarely needed)
 *   page.pause()            — debugging only
 *
 * Note: waitForLoadState is allowed because specs that use mockRoute() often
 * need to wait for networkidle after the intercepted response. Requiring a
 * behavior wrapper for a one-liner settle call would add noise without value.
 * All *navigation* (goto) must still be in a behavior.
 *
 * HOW TO FIX A VIOLATION
 * ----------------------
 * 1. Find the page method call in the spec.
 * 2. Add a behavior function in qa/e2e/behaviors/minicrm/<domain>.behaviors.ts
 *    that wraps the interaction and exports it with an intent-bearing name.
 * 3. Import and call the behavior in the spec instead.
 * 4. If the interaction is truly spec-specific (e.g. combined with a unique
 *    assertion), extract a locator getter or navigation helper and compose
 *    them in the behavior layer.
 *
 * MINCRM-401
 */

/** @type {import('eslint').Rule.RuleModule} */
const noPageDirectInSpec = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct page navigation and interaction calls in spec files. ' +
        'Move them into a behavior function in qa/e2e/behaviors/ instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      forbidden:
        'page.{{ method }}() must not be called directly in a spec file. ' +
        'Extract it into a named behavior function in qa/e2e/behaviors/minicrm/ ' +
        'and import that behavior here. See MINCRM-401.',
    },
  },

  create(context) {
    // Methods that belong in behaviors or page objects, not in spec bodies.
    const FORBIDDEN_METHODS = new Set([
      // Navigation
      'goto',
      'reload',
      'goBack',
      'goForward',
      'waitForURL',
      // Interaction (HealMethods)
      'click',
      'fill',
      'check',
      'uncheck',
      'hover',
      'selectOption',
      // Querying (HealMethods)
      'locate',
      'waitFor',
      'textContent',
      'getAttribute',
      'count',
      'doesNotExist',
      'isNotVisible',
      // DOM waits (HealMethods added for MINCRM-401)
      'waitForPresent',
      'waitForAbsent',
      'waitForPainted',
      // Browser evaluation
      'evaluate',
      'waitForFunction',
      'waitForEvent',
      'waitForRequest',
      'waitForResponse',
    ]);

    return {
      CallExpression(node) {
        const { callee } = node;

        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'page' &&
          callee.property.type === 'Identifier' &&
          FORBIDDEN_METHODS.has(callee.property.name)
        ) {
          context.report({
            node,
            messageId: 'forbidden',
            data: { method: callee.property.name },
          });
        }
      },
    };
  },
};

export default noPageDirectInSpec;
