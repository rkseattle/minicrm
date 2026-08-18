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
import noPageDirectInSpec from './eslint-plugins/no-page-direct-in-spec.mjs';
import noPlaywrightImports from './eslint-plugins/no-playwright-imports.mjs';
import requireLocatorIntent from './eslint-plugins/require-locator-intent.mjs';
import requireLocatorFallback from './eslint-plugins/require-locator-fallback.mjs';
import noWorkItemIdInComment from './eslint-plugins/no-work-item-id-in-comment.mjs';
import i18nextPlugin from 'eslint-plugin-i18next';

/** Files covered by TypeScript rules */
const TS_FILES = ['**/*.ts', '**/*.tsx'];

/** Directories that are not application source */
const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  'db/migrations/**',
  'shared/generated/**',
  // Agent scratch checkouts (git worktrees under .claude/worktrees/) are full
  // copies of this repo. Without this exclusion, `eslint .` discovers and
  // type-checks every tsconfig in every leftover worktree in the same process,
  // multiplying peak memory by the number of worktrees present and reliably
  // causing an OOM crash.
  '.claude/**',
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

// ── Coverage dashboard (React + JSX accessibility, no i18n — English-only) ────
// Standalone app — same React/a11y/data-testid conventions as
// client/, but i18next/no-literal-string is intentionally omitted: this is an
// internal developer/QA tool with no i18n system of its own (see coverage-
// dashboard's own README).
const coverageDashboardConfig = {
  files: ['coverage-dashboard/src/**/*.ts', 'coverage-dashboard/src/**/*.tsx'],
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

const coverageDashboardTestConfig = {
  files: ['coverage-dashboard/src/**/*.test.tsx', 'coverage-dashboard/src/**/*.test.ts'],
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
  settings: {
    // AsyncLocalStorage graduated from experimental in Node 16.4.0.
    // Declare the floor version so the n plugin does not incorrectly flag it.
    n: { version: '>=18.0.0' },
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
// Also enforces the two-strategy minimum and intent strings
// on every page.locate() call in spec and behavior files.
//
// Framework internals (qa/e2e/framework/**) and framework self-tests
// (qa/e2e/tests/framework/**) are intentionally excluded — they wrap Playwright
// directly and need access to its primitives.
// ── E2E spec and behavior files — enforce SafePage/HealPage usage ────────────
// no-page-direct-in-spec is included here (spec files only, via an override
// rule that is a no-op for behavior files) because ESLint 9 flat config does
// not allow two config objects with overlapping file globs to both define the
// same plugin key ("local"). All local rules are therefore registered once here
// and selectively activated: no-page-direct-in-spec is set to "error" only for
// spec files via e2eSpecDirectPageConfig below, which adds a rule override
// without re-declaring the plugin.
const e2eSpecConfig = {
  files: ['qa/e2e/tests/apps/**/*.spec.ts', 'qa/e2e/behaviors/**/*.ts'],
  plugins: {
    local: {
      rules: {
        'no-page-forbidden-methods': noPageForbiddenMethods,
        'no-page-direct-in-spec': noPageDirectInSpec,
        'no-playwright-imports': noPlaywrightImports,
        'require-locator-fallback': requireLocatorFallback,
      },
    },
  },
  rules: {
    'local/no-page-forbidden-methods': 'error',
    'local/no-playwright-imports': 'error',
    'local/require-locator-fallback': 'error',
    // Off for behaviors — only activated for spec files below.
    'local/no-page-direct-in-spec': 'off',
  },
};

// ── E2E spec files only — forbid direct page navigation/interaction calls ────
// Behaviors and page objects may call page.goto(), page.click(), page.evaluate()
// etc. directly. Spec files must not — those calls belong in a named behavior
// function so the spec reads as a sequence of intent-bearing steps.
//
// Allowed in specs: setViewportSize, mockRoute, unmockRoute, unmockAllRoutes,
// waitForTimeout, waitForLoadState, on, once, removeListener, pause.
// Everything else that belongs in a behavior is forbidden.
//
// Currently set to 'warn' because existing spec files have pre-existing
// violations that will be cleaned up incrementally. Escalate to 'error'
// once all existing violations are resolved.
//
// No `plugins` key here — the plugin is already registered in e2eSpecConfig
// above, which also covers spec files. This config only overrides the rule
// severity for the narrower file glob.
const e2eSpecDirectPageConfig = {
  files: ['qa/e2e/tests/apps/**/*.spec.ts'],
  rules: {
    'local/no-page-direct-in-spec': 'error',
  },
};

// ── E2E page object files — enforce intent strings and fallback strategies ───
// Page objects under qa/e2e/pages/ must supply a non-empty `intent` string and
// at least two strategies on every page.locate() call.
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

// ── Work-item IDs in comments — every linted file type ───────────────────────
// Registered under its own plugin key, not `local`. ESLint 9 flat config forbids
// two config objects with overlapping globs both declaring the same key, and
// `local` is already claimed by e2eSpecConfig and e2ePageObjectConfig, whose globs
// this one must overlap.
//
// The glob list is deliberately wider than every other entry here: this is the only
// rule that must reach .mjs/.cjs/.js, because eslint-plugins/, qa/scripts/, the
// workspace vite/vitest configs, and tailwind.config.cjs all carry comments and are
// otherwise unlinted. db/migrations/** stays excluded via IGNORED — its catalog
// comments are live database metadata, covered by strip-work-item-ids.ts --verify.
const commentConventionConfig = {
  files: ['**/*.ts', '**/*.tsx', '**/*.mjs', '**/*.cjs', '**/*.js'],
  ignores: IGNORED,
  plugins: {
    'local-comments': { rules: { 'no-work-item-id-in-comment': noWorkItemIdInComment } },
  },
  rules: {
    'local-comments/no-work-item-id-in-comment': 'error',
  },
};

export default [
  { ignores: IGNORED },
  baseConfig,
  commentConventionConfig,
  clientConfig,
  clientTestConfig,
  coverageDashboardConfig,
  coverageDashboardTestConfig,
  serverConfig,
  swaggerDevConfig,
  routeJsdocConfig,
  testConfig,
  e2eSpecConfig,
  e2eSpecDirectPageConfig,
  e2ePageObjectConfig,
  scriptsConfig,
  // Must be last: disables ESLint rules that conflict with Prettier
  prettierConfig,
];
