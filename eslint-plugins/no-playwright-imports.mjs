/**
 * Custom ESLint rule: no-playwright-imports
 *
 * Prevents spec and behavior files from importing the Playwright testing
 * primitives (`test`, `expect`, `Page`, `Locator`, etc.) directly from
 * `@playwright/test`. These files must import `test` and `expect` from the
 * app fixtures (`@apps/minicrm/fixtures.js`) and interact with elements
 * through `healPage` rather than via a raw Playwright `Page` reference.
 *
 * Rationale:
 *   A developer could rename the `page` fixture to bypass no-page-forbidden-methods.
 *   This rule closes that gap at the import boundary: if you can't import `Page`
 *   or `Locator` from `@playwright/test`, you can't declare a parameter of those
 *   types without a compile error, making any attempted bypass visible.
 *
 * Blocked imports from `@playwright/test`:
 *   Values:  test, expect
 *   Types:   Page, Locator, Browser, BrowserContext, Frame, FrameLocator,
 *            ElementHandle, JSHandle
 *
 * Allowed imports (type-only, non-interactive):
 *   APIRequestContext, APIResponse, APIResponseBody, PlaywrightTestConfig,
 *   TestInfo, WorkerInfo, FullConfig, FullResult, Reporter, Suite, TestCase,
 *   TestResult — and anything else not in the blocked list.
 *
 * The rule applies to:
 *   qa/e2e/tests/apps/**‌/*.spec.ts   (app-level spec files)
 *   qa/e2e/behaviors/**‌/*.ts          (behavior files)
 *
 * It does NOT apply to:
 *   qa/e2e/framework/**              (framework internals wrap Playwright directly)
 *   qa/e2e/tests/framework/**        (framework self-tests need raw Playwright types)
 *
 * MINCRM-204
 */

/** @type {import('eslint').Rule.RuleModule} */
const noPlaywrightImports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevent importing Playwright testing primitives directly in spec and behavior files. ' +
        'Import test/expect from @apps/minicrm/fixtures.js instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      blockedImport:
        '"{{ name }}" must not be imported from @playwright/test in spec or behavior files. ' +
        'Import test and expect from @apps/minicrm/fixtures.js. ' +
        'Use SafePage (from @framework/types/safe-page.js) instead of Page, ' +
        'and HealingLocator instead of Locator. See MINCRM-204.',
    },
  },

  create(context) {
    /**
     * Names that are forbidden to import from `@playwright/test` in these files.
     * Includes both value imports (test, expect) and type imports for Playwright
     * primitives that give direct DOM/browser access.
     */
    const BLOCKED_NAMES = new Set([
      // Test runner primitives
      'test',
      'expect',
      // Browser-interaction types — must use SafePage / HealPage instead
      'Page',
      'Locator',
      'Browser',
      'BrowserContext',
      'Frame',
      'FrameLocator',
      'ElementHandle',
      'JSHandle',
    ]);

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@playwright/test') return;

        for (const specifier of node.specifiers) {
          // ImportDefaultSpecifier (e.g. `import playwright from '...'`) — always blocked
          // ImportNamespaceSpecifier (e.g. `import * as pw from '...'`) — always blocked
          if (
            specifier.type === 'ImportDefaultSpecifier' ||
            specifier.type === 'ImportNamespaceSpecifier'
          ) {
            const name =
              specifier.type === 'ImportNamespaceSpecifier'
                ? `* as ${specifier.local.name}`
                : specifier.local.name;
            context.report({ node: specifier, messageId: 'blockedImport', data: { name } });
            continue;
          }

          // ImportSpecifier: check whether the imported name is in the blocklist
          if (specifier.type === 'ImportSpecifier') {
            const importedName =
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : String(specifier.imported.value);

            if (BLOCKED_NAMES.has(importedName)) {
              context.report({
                node: specifier,
                messageId: 'blockedImport',
                data: { name: importedName },
              });
            }
          }
        }
      },
    };
  },
};

export default noPlaywrightImports;
