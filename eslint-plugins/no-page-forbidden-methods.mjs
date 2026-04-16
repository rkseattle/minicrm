/**
 * Custom ESLint rule: no-page-forbidden-methods
 *
 * Enforces that E2E spec files do not call forbidden Playwright Page methods
 * directly on the `page` fixture. All element location and interaction must
 * go through healPage.locate / healPage.click / healPage.fill so that
 * self-healing strategies are applied uniformly.
 *
 * Allowed page methods (navigation and browser-state primitives):
 *   goto, url, waitForURL, waitForLoadState, waitForTimeout, reload,
 *   goBack, goForward, keyboard, mouse, title, context, viewportSize,
 *   evaluate, waitForEvent, waitForFunction, waitForRequest, waitForResponse,
 *   screenshot, pdf, viewportSize, setViewportSize, addInitScript,
 *   exposeFunction, route, on, once, removeListener, close, pause,
 *   bringToFront, emulateMedia, setExtraHTTPHeaders, addCookies,
 *   clearCookies, addScriptTag, addStyleTag, setContent, content,
 *   mainFrame, frames, frame, workers, serviceWorker, opener, isClosed,
 *   skip, title (test.info) -- these are NOT page method calls
 *
 * MINCRM-204
 */

/** @type {import('eslint').Rule.RuleModule} */
const noPageForbiddenMethods = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling forbidden Playwright Page methods directly in E2E spec files. ' +
        'Use healPage.locate / healPage.click / healPage.fill instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      forbidden:
        'page.{{ method }}() is forbidden in spec files. ' +
        'Use healPage.locate([{type:"testId",value:"..."}]).resolve(testName) for assertions, ' +
        'healPage.click([...]) for clicks, and healPage.fill(value,[...]) for input. ' +
        'See MINCRM-204 for the full migration guide.',
    },
  },

  create(context) {
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
      'click',
      'fill',
      'type',
      'check',
      'uncheck',
      'selectOption',
      'hover',
      'focus',
      'tap',
      'dispatchEvent',
      'innerHTML',
      'innerText',
      'inputValue',
      'textContent',
      'getAttribute',
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
