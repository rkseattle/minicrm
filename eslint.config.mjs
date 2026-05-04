/**
 * Root ESLint flat config (ESLint 9).
 * Applies TypeScript rules to all packages, with file-pattern overrides
 * for client (React) and server (Node.js) specific rules.
 */

import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import nodePlugin from 'eslint-plugin-n';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import prettierConfig from 'eslint-config-prettier';
import requireDataTestid from './eslint-plugins/require-data-testid.mjs';
import noPageForbiddenMethods from './eslint-plugins/no-page-forbidden-methods.mjs';
import noPlaywrightImports from './eslint-plugins/no-playwright-imports.mjs';
import requireLocatorIntent from './eslint-plugins/require-locator-intent.mjs';
import requireLocatorFallback from './eslint-plugins/require-locator-fallback.mjs';
import i18nextPlugin from 'eslint-plugin-i18next';

/** Files covered by TypeScript rules */
const TS_FILES = ['**/*.ts', '**/*.tsx'];

/** Directories that are not application source */
const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  'db/migrations/**',
];

// ── Base TypeScript config (all packages) ──────────────────────────────────────
const baseConfig = {
  files: TS_FILES,
  ignores: IGNORED,
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      project: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: {
    '@typescript-eslint': tsPlugin,
  },
  rules: {
    ...tsPlugin.configs['recommended'].rules,
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  },
};

// ── Client (React + JSX accessibility) ────────────────────────────────────────
const clientConfig = {
  files: ['client/src/**/*.ts', 'client/src/**/*.tsx'],
  plugins: {
    react: reactPlugin,
    'react-hooks': reactHooksPlugin,
    'jsx-a11y': jsxA11yPlugin,
    'local': { rules: { 'require-data-testid': requireDataTestid } },
    i18next: i18nextPlugin,
  },
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    ...reactPlugin.configs.recommended.rules,
    ...reactHooksPlugin.configs.recommended.rules,
    ...jsxA11yPlugin.configs.recommended.rules,
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'local/require-data-testid': 'error',
    'i18next/no-literal-string': [
      'error',
      {
        // Allow non-translatable content in JSX:
        // MiniCRM  — product brand name, intentionally not translated
        // ⋯        — meatball menu icon (horizontal ellipsis)
        // ×        — close/remove button symbol
        // ←        — back-navigation arrow
        // ·        — separator dot
        // …        — ellipsis placeholder (e.g. empty state spans)
        // —        — em dash used as empty-value placeholder
        // *        — required-field indicator (aria-hidden)
        // :        — punctuation after a translated label
        // —...—    — em dashes wrapping a translated select placeholder
        words: {
          exclude: [
            '^MiniCRM$',
            '^⋯$',
            '^×$',
            '^←$',
            '^·$',
            '^…$',
            '^—$',
            '^\\*$',
            '^:$',
            '^—\\s',
            '\\s—$',
          ],
        },
      },
    ],
  },
};

// ── Client test files — disable data-testid and i18n literal requirements inside tests ──────────
// Test fixture strings (e.g. "Click me", "Active") are intentional and should not be translated.
const clientTestConfig = {
  files: ['client/src/**/*.test.tsx', 'client/src/**/*.test.ts'],
  rules: {
    'local/require-data-testid': 'off',
    'i18next/no-literal-string': 'off',
  },
};

// ── Server (Node.js) ───────────────────────────────────────────────────────────
const serverConfig = {
  files: ['server/src/**/*.ts'],
  plugins: {
    n: nodePlugin,
  },
  rules: {
    ...nodePlugin.configs['flat/recommended-module'].rules,
    // Allow TypeScript import extensions — tsx resolves them at runtime
    'n/no-missing-import': 'off',
    'n/no-unsupported-features/es-syntax': 'off',
  },
};

// ── Swagger/docs files ────────────────────────────────────────────────────────
// swagger-jsdoc and swagger-ui-express are production dependencies (needed at
// runtime in non-production Docker environments), so no import suppression is
// required. This config remains as a placeholder in case doc-only packages are
// added in future.
const swaggerDevConfig = {
  files: ['server/src/swagger.ts', 'server/src/scripts/generateSpec.ts'],
  rules: {},
};

// ── Route files — require @openapi JSDoc on every route handler ───────────────
// Uses eslint-plugin-jsdoc to enforce that each router.get/post/patch/delete
// call site has a preceding JSDoc block containing an @openapi tag.
const routeJsdocConfig = {
  files: ['server/src/routes/**/*.ts'],
  plugins: {
    jsdoc: jsdocPlugin,
  },
  rules: {
    'jsdoc/require-jsdoc': [
      'error',
      {
        // Require a JSDoc block on every router.get/post/patch/delete/put call statement.
        // Routes use named function refs (e.g. asyncHandler(login)), not inline arrow
        // functions, so we target the ExpressionStatement wrapping the router call itself.
        contexts: [
          'ExpressionStatement > CallExpression[callee.property.name=/^(get|post|patch|delete|put)$/]',
        ],
        enableFixer: false,
      },
    ],
    // Ensure every JSDoc block on a route contains an @openapi tag
    'jsdoc/check-tag-names': ['error', { definedTags: ['openapi'] }],
  },
};

// ── Test files (devDependency imports are valid) ───────────────────────────────
const testConfig = {
  files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
  rules: {
    'n/no-unpublished-import': 'off',
  },
};

// ── E2E spec and behavior files — enforce SafePage/HealPage usage ────────────
// Spec and behavior files must never call forbidden Playwright Page methods
// directly, and must not import Playwright test primitives (test, expect, Page,
// Locator, etc.) from @playwright/test. All element interactions must go through
// healPage.locate / click / fill. test/expect must come from app fixtures.
//
// Also enforces the two-strategy minimum (MINCRM-313) and intent strings
// (MINCRM-309) on every page.locate() call in spec and behavior files.
//
// Framework internals (qa/e2e/framework/**) and framework self-tests
// (qa/e2e/tests/framework/**) are intentionally excluded — they wrap Playwright
// directly and need access to its primitives.
const e2eSpecConfig = {
  files: ['qa/e2e/tests/apps/**/*.spec.ts', 'qa/e2e/behaviors/**/*.ts'],
  plugins: {
    local: {
      rules: {
        'no-page-forbidden-methods': noPageForbiddenMethods,
        'no-playwright-imports': noPlaywrightImports,
        'require-locator-fallback': requireLocatorFallback,
      },
    },
  },
  rules: {
    'local/no-page-forbidden-methods': 'error',
    'local/no-playwright-imports': 'error',
    'local/require-locator-fallback': 'error',
  },
};

// ── E2E page object files — enforce intent strings and fallback strategies ───
// Page objects under qa/e2e/pages/ must supply a non-empty `intent` string and
// at least two strategies on every page.locate() call. (MINCRM-309, MINCRM-313)
//
// Framework layer and apps/ helpers are excluded — they are not page objects
// and have different constraints.
const e2ePageObjectConfig = {
  files: ['qa/e2e/pages/**/*.ts'],
  plugins: {
    local: {
      rules: {
        'require-locator-intent': requireLocatorIntent,
        'require-locator-fallback': requireLocatorFallback,
      },
    },
  },
  rules: {
    'local/require-locator-intent': 'error',
    'local/require-locator-fallback': 'error',
  },
};

// ── Scripts (seed-demo, remove-demo, etc.) — use scripts tsconfig ─────────────
const scriptsConfig = {
  files: ['scripts/**/*.ts'],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      project: './tsconfig.scripts.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
};

export default [
  { ignores: IGNORED },
  baseConfig,
  clientConfig,
  clientTestConfig,
  serverConfig,
  swaggerDevConfig,
  routeJsdocConfig,
  testConfig,
  e2eSpecConfig,
  e2ePageObjectConfig,
  scriptsConfig,
  // Must be last: disables ESLint rules that conflict with Prettier
  prettierConfig,
];
