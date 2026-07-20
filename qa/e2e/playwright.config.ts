import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// MINCRM-123: E2E_BASE_URL is the frontend origin Playwright navigates to.
// E2E_API_URL is the backend API origin used by RestClient and globalSetup.
// Set these to the deployed frontend/API URLs in staging/production.
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

  // MINCRM-605/607: Coverage reset safety net — best-effort, no-ops when
  // coverage instrumentation is not configured.
  globalTeardown: './globalTeardown.ts',

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

  // MINCRM-554: Retries are disabled unconditionally. Prerequisites MINCRM-551
  // (networkidle replacement) and MINCRM-552 (@serial tagging) are merged, so the
  // root causes of pre-existing flakiness are gone. Keeping retries > 0 would mask
  // any new non-determinism by letting tests pass on retry and accumulate as "flaky"
  // below the gate threshold rather than failing visibly and being fixed promptly.
  retries: 0,

  // In CI, default to 4 workers; override via PW_WORKERS env var for future tuning.
  // MINCRM-217: sharded runs pass --workers=4 on the CLI which takes precedence,
  // but this value drives non-sharded local CI invocations via the config.
  // MINCRM-557: cap local runs at 2 workers (CI uses 4 per shard; local machines get
  // half to reduce concurrency on shared state). Playwright defaults to half the
  // available logical CPUs when workers is undefined (e.g. 6 on a 12-thread machine).
  // With 2 Playwright projects (desktop + mobile-web) that means up to 12 concurrent
  // test contexts sharing the same minicrm_e2e database. LPT file partitioning prevents
  // this in CI (one shard owns each file), but locally all files are available to every
  // worker — global-settings-mutating specs race.
  workers: IS_CI ? parseInt(process.env['PW_WORKERS'] ?? '4', 10) : 2,

  reporter: [
    ['html', { open: 'never', outputFolder: path.join(E2E_DIR, 'playwright-report') }],
    // HealingReporter — merges per-worker heal logs at run end (S2, MINCRM-124)
    ['./framework/healing/healing-reporter.ts'],
    // MINCRM-369: PerfReporter — merges per-worker perf samples into perf-report.json.
    ['./framework/performance/perf-reporter.ts'],
    ...(IS_CI ? [['github'] as const] : []),
    // MINCRM-135: JUnit XML output anchored to qa/e2e/test-results/ via absolute path.
    ['junit', { outputFile: path.join(E2E_DIR, 'test-results', 'results.xml') }],
    // MINCRM-332: Step summary reporter writes rich pass/fail/skip markdown to
    // $GITHUB_STEP_SUMMARY in CI; no-ops locally when that env var is unset.
    ...(IS_CI ? [['./framework/reporting/step-summary-reporter.ts'] as const] : []),
    // MINCRM-549: Timing reporter — appends per-test duration records to
    // test-timing.jsonl (gitignored). Always-on so local runs accumulate history
    // used by the LPT shard assignment pipeline.
    ['./framework/reporting/timing-reporter.ts'],
    // MINCRM-605/607: Coverage reporter — dumps final backend coverage when
    // E2E_COVERAGE_GRANULARITY=per-run. Unconditional (not IS_CI-gated) so
    // local COVERAGE=true runs also produce dumps for manual exploratory use.
    // No-ops immediately unless that env var is set to 'per-run'.
    ['./framework/reporting/coverage-reporter.ts'],
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

    // MINCRM-134: Retain traces only for failing tests in CI. With retries=0
    // (MINCRM-554), 'on-first-retry' would never fire (no retry exists), and 'on'
    // captures traces for every passing test too, bloating artifact storage.
    // 'retain-on-failure' records during the run but discards passing-test traces.
    // Set PLAYWRIGHT_TRACE=on to force traces locally without editing this file.
    trace: process.env.CI
      ? 'retain-on-failure'
      : process.env.PLAYWRIGHT_TRACE === 'on'
        ? 'on'
        : 'off',
  },

  // Global timeouts (ms).
  // 60 s per test: createTestRep (5 API calls) + loginViaBrowser + actual test work
  // needs headroom beyond the previous 30 s under 4-worker local parallelism. (MINCRM-415)
  timeout: 60_000,
  // MINCRM-554: Cap the entire run at 20 minutes. A healthy suite finishes in
  // ~15 minutes; exceeding this signals a hung test rather than a slow one. CI shards
  // also respect this limit but are expected to complete well within 20 minutes per shard.
  globalTimeout: 20 * 60 * 1000,
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
    // MINCRM-369: Dedicated performance project. Runs only tests tagged @perf.
    // Kept separate from functional tests so perf failures are unambiguous and
    // do not slow down the main functional suite.
    // Run with: npm run test:perf --workspace=minicrm-qa
    {
      name: 'perf',
      grep: /@perf/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: ADMIN_STORAGE_STATE,
      },
    },
  ],
});
