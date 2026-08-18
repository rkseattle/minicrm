/**
 * Self-tests for the `no-work-item-id-in-comment` ESLint rule.
 *
 * Lives in coverage-dashboard rather than server: server/vitest.config.ts wires a
 * globalSetup that refuses to run without DB_PORT, which would couple an AST-only
 * rule test to the Docker Postgres stack. This workspace is jsdom with no
 * globalSetup and participates in `npm run unit_test` identically.
 *
 * Assertions are on finding COUNT and message content, not on exit status — a guard
 * whose only failure mode is silence has to prove it speaks.
 */
import { RuleTester } from 'eslint';
import rule from '../../../eslint-plugins/no-work-item-id-in-comment.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// RuleTester.run registers describe/it itself, so it must be called at module top
// level — calling it inside an it() throws "Calling the suite function inside test
// function is not allowed".
ruleTester.run('no-work-item-id-in-comment', rule, {
  valid: [
    // The -ok: suppression markers are opt-out tokens matched by the QA guard
    // scripts, so the spelling is an API rather than a reference for the reader.
    { code: '// MINCRM-686-ok: cleared by deleteAllViaApi in beforeEach\nconst a = 1;' },
    { code: '// MINCRM-368-ok: beforeAll is required here\nconst a = 1;' },
    // @openapi blocks compile into the served API document.
    {
      code: '/**\n * @openapi\n * /x:\n *   get:\n *     summary: thing (MINCRM-562)\n */\nconst a = 1;',
    },
    // String literals holding an issue key as data — the Coverage/TIA feature
    // stores and queries them.
    { code: "const issueKey = 'MINCRM-609';" },
    { code: "const label = 'e.g. MINCRM-123';" },
    // A comment with no ID, and a bare project key with no number.
    { code: '// Kept under MAX_SAFE_INTEGER so pg can bind it\nconst a = 1;' },
    { code: '// MINCRM has no number here\nconst a = 1;' },
  ],
  invalid: [
    {
      code: '// Kept under MAX_SAFE_INTEGER so pg can bind it (MINCRM-658)\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MINCRM-658' } }],
    },
    {
      code: '/* MINCRM-100 */\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment' }],
    },
    {
      code: '/**\n * Implements MINCRM-284.\n */\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment' }],
    },
    {
      code: 'const a = 1; // trailing (LAR-54)',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'LAR-54' } }],
    },
    {
      code: '// MININT-9 counts too\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MININT-9' } }],
    },
    // One report per comment, not per ID occurrence.
    {
      code: '// see MINCRM-1, MINCRM-2, MINCRM-3\nconst a = 1;',
      errors: 1,
    },
    // Two separate comments produce two reports.
    {
      code: '// MINCRM-1\n// MINCRM-2\nconst a = 1;',
      errors: 2,
    },
    // An -ok marker exempts only its own comment, not the next one.
    {
      code: '// MINCRM-686-ok: fine\n// MINCRM-500 not fine\nconst a = 1;',
      errors: 1,
    },
    // Exemptions are per-occurrence, not per-comment: an unrelated ID sharing a
    // comment with an -ok marker is still reported, and the reported ID is that
    // one rather than the marker.
    {
      code: '// MINCRM-686-ok: cleared in beforeEach; see also MINCRM-500\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MINCRM-500' } }],
    },
    // A docblock that merely mentions @openapi in prose is ordinary commentary,
    // not contract text — matching the tag anywhere let a file header exempt every
    // ID beneath it (routes/sso.ts, routes/teams.ts, routes/mfa.ts).
    {
      code: '/**\n * Team routes — CRUD for teams. (MINCRM-537)\n * Contains only @openapi JSDoc and route declarations.\n */\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MINCRM-537' } }],
    },
    // Consecutive files each report their own ID, so state cannot leak between runs.
    {
      code: '// MINCRM-11\nconst a = 1;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MINCRM-11' } }],
    },
    {
      code: '// MINCRM-22\nconst b = 2;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MINCRM-22' } }],
    },
    {
      code: '// MINCRM-33\nconst c = 3;',
      errors: [{ messageId: 'workItemIdInComment', data: { id: 'MINCRM-33' } }],
    },
  ],
});
