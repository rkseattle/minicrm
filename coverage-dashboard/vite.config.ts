/**
 * Vite configuration for the standalone Coverage/TIA reporting dashboard.
 * (MINCRM-628/629)
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
 * Commit SHA baked into the bundle for SessionRecorderPage to tag manually
 * recorded coverage sessions with. (MINCRM-688)
 *
 * Resolved here, at build time, because a browser bundle has no other way to
 * learn it: unlike the server (which can shell out) or the E2E harness (which
 * inherits GIT_COMMIT_SHA from its parent process), this app only ever sees
 * values Vite inlines. An explicit GIT_COMMIT_SHA wins so a container or CI
 * build that has no .git can still supply one; otherwise `git rev-parse HEAD`
 * covers the ordinary case of building from a checkout.
 *
 * Empty string on failure rather than a thrown error or a fabricated
 * placeholder: a session tagged with a wrong-but-plausible SHA is worse than
 * one openly tagged 'unknown', and SessionRecorderPage turns the empty value
 * into a visible on-screen notice. A dashboard build must not fail because a
 * SHA could not be resolved.
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

export default defineConfig({
  plugins: [react()],
  define: {
    // JSON.stringify so the value is inlined as a string literal, not as a
    // bare identifier Vite would treat as an expression.
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(resolveBuildSha()),
  },
  resolve: {
    alias: {
      /** @shared resolves to the shared package at the repo root — schemas
       * only, per this app's "no shared codebase" constraint (MINCRM-628) */
      '@shared': path.resolve(__dirname, '../shared'),
      /** @ resolves to ./src for clean internal imports */
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results/junit.xml' },
    maxWorkers: 1,
    testTimeout: 30000,
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
    // this app is deployed/run independently alongside it (MINCRM-628's
    // "own repo/build/deploy" AC), not as a route within minicrm-client.
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
