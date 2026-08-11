/**
 * Vite configuration for the MiniCRM client.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import istanbul from 'vite-plugin-istanbul';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Coverage/TIA frontend instrumentation (MINCRM-605). Only added when
    // COVERAGE=true — an unset env var means this plugin is never in the
    // array, so a normal `vite build`/`vite dev` is byte-identical to
    // today. Sourcemapped to original .tsx via Vite's own sourcemap chain,
    // which this plugin relies on rather than doing anything bespoke.
    process.env.COVERAGE === 'true' &&
      istanbul({
        include: 'src/**/*.{ts,tsx}',
        exclude: ['src/test/**', '**/*.test.tsx', '**/*.test.ts', 'node_modules'],
        extension: ['.ts', '.tsx'],
        requireEnv: false,
        forceBuildInstrument: process.env.COVERAGE === 'true',
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      /** @shared resolves to the shared package at the repo root */
      '@shared': path.resolve(__dirname, '../shared'),
      /** @ resolves to ./src for clean internal imports */
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // JUnit XML for dorny/test-reporter in CI; 'default' keeps console output.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/junit.xml' },
    /**
     * Single worker: parallel jsdom forks exhaust memory and cause worker-start
     * failures.
     *
     * CI pays this serialized cost too — `client-tests` in
     * .github/workflows/ci.yml is a single un-matrixed job with no --shard.
     *
     * MEASURED on a 12-core / 24 GB Mac, otherwise idle:
     *
     *   maxWorkers: 1, idle machine -> 133s, 156 files / 2308 tests, 0 failures
     *   maxWorkers: 1, machine busy -> 1055s and a spurious 30s timeout in
     *                                  SequencesPage.test.tsx (passes in 1.5s
     *                                  alone). Same config, 8x slower: that run
     *                                  overlapped another full test suite.
     *   maxWorkers: 4, idle machine ->  114s, but only 152 of 156 files ran, with
     *                                  4 errors: "[vitest-pool]: Failed to start
     *                                  forks worker" / "Timeout waiting for
     *                                  worker to respond". The 4 files whose
     *                                  workers failed to start never ran, and the
     *                                  summary still printed "152 passed (152)"
     *                                  — a green-looking result for an INCOMPLETE
     *                                  suite.
     *
     * Two conclusions. The fork-startup limit is real, so this cap stays. And the
     * suite is ~2 minutes, not the ~17 the slow run suggested — the pathological
     * numbers in this project come from running something else heavy at the same
     * time, not from the worker count (see CLAUDE.md's testing section).
     *
     * If raising this: re-measure BOTH duration and the file COUNT on an idle
     * machine, and check the run for worker-start errors. The count is the tell —
     * the summary line reports what ran, not what was supposed to run.
     */
    maxWorkers: 1,
    // 30s per test: single-worker serialization means each test waits for all
    // prior tests in the same file; complex pages (DealsPage, etc.) with multiple
    // MSW calls can take 10-20s on a loaded machine. CI runs on dedicated runners.
    testTimeout: 30000,
    // Vitest resolves hookTimeout independently of testTimeout and defaults it to
    // 10s, so the budget above does not cover setup. The MSW-heavy render work the
    // comment describes usually sits in beforeEach, which is exactly the code that
    // would otherwise fail as "Hook timed out in 10000ms".
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/components/**', 'src/pages/**'],
      // text: console summary; lcov: for tooling; json-summary: machine-readable
      // totals parsed by the CI coverage-comment step.
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
  // Both dev and E2E serve on 5173 and differ only in which API they proxy to, so the
  // banner names the target explicitly. Getting it wrong is otherwise silent: the page
  // loads normally and every login fails later against a stack whose database has no
  // matching user. E2E stays on 5173 because CI hardcodes localhost:5173 in its
  // readiness gates and E2E_BASE_URL — moving it locally would diverge from CI, which is
  // a worse trade than the ambiguity. (MINCRM-684)
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Vite blocks Host headers it does not recognise, so a friendly /etc/hosts alias
    // (e.g. `127.0.0.1 dev.minicrm.local` → http://dev.minicrm.local:5173) is refused
    // with "This host is not allowed" until it is listed here. Additive and opt-in:
    // unset, this is an empty array and behaviour is exactly as before. CI only ever
    // uses localhost:5173, so it is unaffected. Remember to add the same origin to
    // CORS_ORIGIN — the server allowlists origins explicitly, with no wildcard.
    // (MINCRM-684)
    allowedHosts: (process.env.DEV_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
