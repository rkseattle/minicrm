import { defineConfig, devices } from '@playwright/test';

// MINCRM-123: E2E_BASE_URL is the sole source of truth for target environment.
// Set this to the deployed frontend URL in staging/production.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const IS_CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',

  // Fail fast in CI; allow local runs to continue after failures
  fullyParallel: true,
  forbidOnly: IS_CI,

  // Retry failed tests once in CI to reduce flakiness noise
  retries: IS_CI ? 1 : 0,

  // Limit parallel workers in CI to avoid resource contention
  workers: IS_CI ? 2 : undefined,

  reporter: [
    ['html', { open: 'never' }],
    // HealingReporter — merges per-worker heal logs at run end (S2, MINCRM-124)
    ['./framework/healing/healing-reporter.ts'],
    ...(IS_CI ? [['github'] as const] : []),
  ],

  use: {
    baseURL: BASE_URL,
    headless: IS_CI ? true : undefined,

    // Capture traces on first retry to aid debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
      },
    },
    {
      name: 'mobile-web',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
});
