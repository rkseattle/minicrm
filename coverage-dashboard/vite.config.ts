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
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
