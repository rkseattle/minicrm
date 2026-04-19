/**
 * Custom ESLint rule: no-page-forbidden-methods
 *
 * Enforces that E2E spec files do not call raw Playwright Page methods
 * directly on the `page` fixture. Since MINCRM-210, `page` is a PageFacade
 * (SafePage & HealMethods), so healing methods like click(), fill(), locate()
 * etc. are valid on `page`. Only raw Playwright locator/query methods that
 * bypass the healing layer remain forbidden.
 *
 * Allowed page methods (healing layer + navigation and browser-state primitives):
 *   locate, click, fill, waitFor, textContent, getAttribute, count, selectOption,
 *   check, uncheck, hover, doesNotExist, isNotVisible (HealMethods)
 *   goto, url, waitForURL, waitForLoadState, waitForTimeout, reload,
 *   goBack, goForward, keyboard, mouse, title, context, viewportSize,
 *   evaluate, waitForEvent, waitForFunction, waitForRequest, waitForResponse,
 *   screenshot, setViewportSize, route, on, once, removeListener, close, pause,
 *   bringToFront, emulateMedia, setExtraHTTPHeaders, mainFrame, frames
 *
 * MINCRM-204, MINCRM-210
 */

/** @type {import('eslint').Rule.RuleModule} */
const noPageForbiddenMethods = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling raw Playwright Page locator methods directly in E2E spec files. ' +
        'Use page.locate([...]).resolve() for assertions, page.click([...]) for clicks, ' +
        'and page.fill(value, [...]) for input.',
      recommended: false,
    },
    schema: [],
    messages: {
      forbidden:
        'page.{{ method }}() is forbidden in spec files. ' +
        'Use page.locate([{type:"testId",value:"..."}]).resolve() for assertions, ' +
        'page.click([...]) for clicks, and page.fill(value,[...]) for input. ' +
        'See MINCRM-204 for the full migration guide.',
    },
  },

  create(context) {
    // Only raw Playwright locator/query methods that bypass the healing layer.
    // HealMethods (click, fill, check, uncheck, selectOption, hover, textContent,
    // getAttribute, locate, count, waitFor, doesNotExist, isNotVisible) are
    // allowed because page is now a PageFacade that routes them through
    // the healing layer. (MINCRM-210)
    const FORBIDDEN_METHODS = new Set([
      'getByTestId',
      'getByRole',
      'getByLabel',
      'getByText',
      'getByPlaceholder',
      'getByAltText',
      'getByTitle',
      'locator',
      'waitForSelector',
      'type',
      'focus',
      'tap',
      'dispatchEvent',
      'innerHTML',
      'innerText',
      'inputValue',
      'isVisible',
      'isEnabled',
      'isChecked',
      'isDisabled',
      'isEditable',
      'isHidden',
    ]);

    return {
      CallExpression(node) {
        const { callee } = node;

        // Match: page.someMethod(...)
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

export default noPageForbiddenMethods;
