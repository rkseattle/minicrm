/**
 * Vite configuration for the standalone Coverage/TIA reporting dashboard.
 *
 * No istanbul coverage-instrumentation plugin here, unlike client/vite.config.ts
 * — this app is itself a coverage/TIA reporting TOOL, not an instrumented
 * subject of the coverage system it reports on.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Commit SHA inlined for SessionRecorderPage to tag manually recorded coverage
 * sessions with.
 *
 * Resolved in this config because a browser bundle has no other way to learn
 * it: unlike the server (which can shell out) or the E2E harness (which
 * inherits GIT_COMMIT_SHA from its parent process), this app only ever sees
 * values Vite inlines. An explicit GIT_COMMIT_SHA wins so a container or CI
 * build with no .git can still supply one; otherwise `git rev-parse HEAD`
 * covers the ordinary case of running from a checkout.
 *
 * Applies to `serve` as well as `build`, deliberately: nothing in this repo
 * builds the coverage dashboard — no CI job, no Dockerfile — and its README
 * documents `npm run dev` as the way to run it. Gating this on
 * `command === 'build'` therefore left the value undefined on the only path
 * anyone uses, so every manually recorded session was tagged 'unknown' and the
 * page's degradation notice was permanently on. A warning that is always
 * showing carries no signal, which is worse than the silent failure it
 * replaced.
 *
 * Empty string on failure rather than a thrown error or a fabricated
 * placeholder: a session tagged with a wrong-but-plausible SHA is worse than
 * one openly tagged 'unknown', and SessionRecorderPage turns the empty value
 * into a visible on-screen notice. Starting the dashboard must not fail
 * because a SHA could not be resolved.
 */
function resolveBuildSha(): string {
  const explicit = process.env.GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (explicit) return explicit;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// Not validated here against SAFE_BUILD_SHA_PATTERN, deliberately: importing a
// .tsx page module into a Vite config to reuse one regex would pull React into
// config evaluation, and duplicating the pattern would add a FOURTH copy for
// check-sha-pattern-parity.sh to keep in step. SessionRecorderPage validates
// whatever lands in import.meta.env before using it, so a malformed value
// still degrades to 'unknown' with the on-screen notice — this function only
// has to avoid inventing a value, which returning '' on failure achieves.

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Both `build` and `serve` — see resolveBuildSha's docblock for why gating on
  // the build command alone made this dead code. Skipped only under vitest,
  // where every test stubs VITE_BUILD_SHA per case, so inlining a real value
  // would be overwritten immediately and cost a git subprocess per run.
  define:
    mode === 'test'
      ? {}
      : {
          // JSON.stringify so the value is inlined as a string literal, not as
          // a bare identifier Vite would treat as an expression.
          'import.meta.env.VITE_BUILD_SHA': JSON.stringify(resolveBuildSha()),
        },
  resolve: {
    alias: [
      /**
       * Rewrites a `.js` schema specifier to the `.ts` source. A directory alias resolves
       * it to the gitignored tsc side-emit sitting next to the schema, which is frozen at
       * whenever a build last ran and exists only on developer machines.
       */
      {
        find: /^@shared\/(.*)\.js$/,
        replacement: path.resolve(__dirname, '../shared') + '/$1.ts',
      },
      /** @shared resolves to the shared package at the repo root — schemas
       * only, per this app's "no shared codebase" constraint */
      { find: '@shared', replacement: path.resolve(__dirname, '../shared') },
      /** @ resolves to ./src for clean internal imports */
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/junit.xml' },
    maxWorkers: 1,
    testTimeout: 30000,
    // Vitest resolves hookTimeout independently of testTimeout and defaults it to
    // 10s, so setup work is not covered by the budget above. Matches the client
    // workspace, which has the same jsdom + single-worker shape.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/components/**', 'src/pages/**'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    // 5174, not 5173 — the minicrm-client dev server already owns 5173, and
    // this app is deployed and run independently alongside it, with its own
    // repo, build and deploy, not as a route within minicrm-client.
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}));
