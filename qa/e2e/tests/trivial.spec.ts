import { test, expect } from '@playwright/test';

// MINCRM-123: Trivial sanity test that validates both Playwright projects
// can be invoked and the test runner is functional. Runs under both
// `desktop` and `mobile-web` projects.
test('playwright projects are configured and runnable', () => {
  expect(true).toBe(true);
});
