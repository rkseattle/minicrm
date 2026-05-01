import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// MINCRM-123: E2E_BASE_URL is the sole source of truth for target environment.
// Set this to the deployed frontend URL in staging/production.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const IS_CI = Boolean(process.env.CI);

// MINCRM-135: Anchor output paths to __dirname (qa/e2e/) so they are
// predictable regardless of the working directory when npx playwright runs.
const E2E_DIR = __dirname;

// MINCRM-192: Pre-authenticated admin session written by globalSetup.
// Auth-specific specs opt out via test.use({ storageState: undefined }).
const ADMIN_STORAGE_STATE = path.join(E2E_DIR, '.auth', 'admin.json');

export default defineConfig({
  testDir: './tests',

  // MINCRM-192: Run globalSetup once before all workers to save the admin session.
  globalSetup: './globalSetup.ts',

  // Point to qa/tsconfig.json so Playwright's transform resolves @framework/* path aliases.
  // MINCRM-126
  tsconfig: path.resolve(__dirname, '../tsconfig.json'),

  // Anchor test artifact output (traces, screenshots, videos) to qa/e2e/test-results/
  outputDir: path.join(E2E_DIR, 'test-results'),

  // MINCRM-319: Visual regression snapshot storage.
  // Snapshots are stored under qa/e2e/snapshots/<test-file>/<browser>/ so they
  // are versioned alongside the tests that own them and stay separate from
  // transient test-results/ artifacts.
  snapshotDir: path.join(E2E_DIR, 'snapshots'),

  // Fail fast in CI; allow local runs to continue after failures
  fullyParallel: true,
  forbidOnly: IS_CI,

  // Retry failed tests once in CI to reduce flakiness noise
  retries: IS_CI ? 1 : 0,

  // In CI, default to 4 workers; override via PW_WORKERS env var for future tuning.
  // MINCRM-217: sharded runs pass --workers=4 on the CLI which takes precedence,
  // but this value drives non-sharded local CI invocations via the config.
  workers: IS_CI ? parseInt(process.env['PW_WORKERS'] ?? '4', 10) : undefined,

  reporter: [
    ['html', { open: 'never', outputFolder: path.join(E2E_DIR, 'playwright-report') }],
    // HealingReporter — merges per-worker heal logs at run end (S2, MINCRM-124)
    ['./framework/healing/healing-reporter.ts'],
    ...(IS_CI ? [['github'] as const] : []),
    // MINCRM-135: JUnit XML output anchored to qa/e2e/test-results/ via absolute path.
    ['junit', { outputFile: path.join(E2E_DIR, 'test-results', 'results.xml') }],
    // MINCRM-217: blob reporter for sharded CI runs only; MINCRM-218 aggregation job
    // uses `playwright merge-reports` to combine blob outputs across all shards.
    ...(process.env['SHARD_INDEX']
      ? [['blob', { outputDir: path.join(E2E_DIR, 'blob-report') }] as const]
      : []),
  ],

  use: {
    baseURL: BASE_URL,
    headless: IS_CI ? true : undefined,

    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // MINCRM-134: on-first-retry in CI; off locally by default.
    // Set PLAYWRIGHT_TRACE=on to force traces locally without editing this file.
    trace: process.env.CI ? 'on-first-retry' : process.env.PLAYWRIGHT_TRACE === 'on' ? 'on' : 'off',
  },

  // Global timeouts (ms)
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        // MINCRM-192: Load pre-authenticated admin session for all tests.
        // Auth-specific specs opt out via test.use({ storageState: undefined }).
        storageState: ADMIN_STORAGE_STATE,
      },
    },
    {
      name: 'mobile-web',
      use: {
        ...devices['Pixel 5'],
        // MINCRM-192: Load pre-authenticated admin session for all tests.
        // Auth-specific specs opt out via test.use({ storageState: undefined }).
        storageState: ADMIN_STORAGE_STATE,
      },
    },
  ],
});
