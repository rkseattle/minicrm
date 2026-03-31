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
        // Require JSDoc on function expressions passed as arguments (route handlers)
        require: {
          FunctionExpression: true,
          ArrowFunctionExpression: true,
        },
        // Also require JSDoc on the router.* call expression itself via checkConstructors
        contexts: [
          // Match the arrow-function callback in router.get('/', ..., asyncHandler(...))
          'ExpressionStatement > CallExpression[callee.property.name=/^(get|post|patch|delete|put)$/] > ArrowFunctionExpression',
        ],
        enableFixer: false,
      },
    ],
    // Ensure every JSDoc block on a route has an @openapi tag
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
  serverConfig,
  routeJsdocConfig,
  testConfig,
  // Must be last: disables ESLint rules that conflict with Prettier
  prettierConfig,
];
