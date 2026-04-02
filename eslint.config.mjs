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
  },
};

// ── Client test files — disable data-testid requirement inside tests ───────────
const clientTestConfig = {
  files: ['client/src/**/*.test.tsx', 'client/src/**/*.test.ts'],
  rules: {
    'local/require-data-testid': 'off',
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

export default [
  { ignores: IGNORED },
  baseConfig,
  clientConfig,
  clientTestConfig,
  serverConfig,
  swaggerDevConfig,
  routeJsdocConfig,
  testConfig,
  // Must be last: disables ESLint rules that conflict with Prettier
  prettierConfig,
];
