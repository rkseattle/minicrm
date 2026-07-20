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
    // Single worker: parallel jsdom forks on a loaded dev Mac exhaust memory and
    // cause random timeouts and worker-start failures. CI shards (1 worker × 4 shards)
    // so this does not affect CI throughput. Increase for faster local iteration
    // if the machine is not under load.
    maxWorkers: 1,
    // 30s per test: single-worker serialization means each test waits for all
    // prior tests in the same file; complex pages (DealsPage, etc.) with multiple
    // MSW calls can take 10-20s on a loaded machine. CI runs on dedicated runners.
    testTimeout: 30000,
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
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
