/**
 * Vite configuration for the MiniCRM client.
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
    // Cap at 2 workers: parallel jsdom forks on a loaded dev Mac starve each
    // other and cause random 5s test timeouts. CI shards (2 workers × 4 shards)
    // so this does not affect CI. Increase for faster local iteration if needed.
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['src/components/**', 'src/pages/**'],
      // text: console summary; lcov: for tooling; json-summary: machine-readable
      // totals parsed by the CI coverage-comment step.
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
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
