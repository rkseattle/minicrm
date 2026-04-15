# qa/e2e

Playwright end-to-end test suite for MiniCRM.

## Structure

```
apps/        App-specific fixtures, helpers, and test-data managers
behaviors/   Reusable behavior modules (auth, contacts, …)
framework/   Product-agnostic framework code (healing locator, REST/gRPC clients, reporters)
pages/       Page-object models
tests/       Spec files — mirrors the structure above
```

## Smoke-Level Coverage

Smoke-level (sanity) E2E coverage is provided by the BVT suite, which is merged into the functional suite (MINCRM-193). The BVTs run in Phase 3 of CI alongside all functional tests and cover the critical end-to-end journeys (auth, contact CRUD, deal pipeline, task flow, user management) with self-healing locators, proper test-data teardown, and CI artifact reporting.

BVT specs live under `qa/e2e/tests/apps/minicrm/functional/smoke/` and are tagged `@bvt @smoke @functional`. To run them locally:

```bash
npx playwright test --config=qa/e2e/playwright.config.ts --grep @bvt qa/e2e/tests/apps/minicrm/functional/smoke/
```

## Running Tests

```bash
# All tests (uses playwright.config.ts defaults)
npx playwright test --config=qa/e2e/playwright.config.ts

# Desktop project only
npx playwright test --config=qa/e2e/playwright.config.ts --project=desktop

# Smoke tests only
npx playwright test --config=qa/e2e/playwright.config.ts --grep @smoke qa/e2e/tests/apps/minicrm/functional/smoke/

# Framework integration test only
npx playwright test --config=qa/e2e/playwright.config.ts qa/e2e/tests/apps/minicrm/functional/framework/bvt-framework.spec.ts
```

Copy `qa/e2e/.env.example` to `qa/e2e/.env` and fill in the required values before running against a live environment.

## Debugging Failures

### Artifact Types

| Artifact                | Content                                                                   | Best for                                                          |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Trace** (`.zip`)      | Full timeline: DOM snapshots, network requests, console logs, source maps | Complex multi-step failures — replay the entire test step by step |
| **Screenshot** (`.png`) | Static image captured at the moment of failure                            | Quick visual checks — open instantly, no tooling required         |
| **Video** (`.mp4`)      | Full recording of the browser session                                     | Timing-sensitive or animation-related failures                    |

### In CI

Artifacts are uploaded after every run (including failed runs) as a GitHub Actions artifact named `playwright-artifacts-<job>-<run_id>`. Retention is 14 days.

To view a trace from a CI failure:

1. Open the GitHub Actions run and download the `playwright-artifacts-*` artifact.
2. Unzip it and locate the `.zip` trace file under `test-results/`.
3. Open it in Playwright Trace Viewer:
   ```bash
   npx playwright show-trace path/to/trace.zip
   ```
4. Alternatively, open the full HTML report:
   ```bash
   npx playwright show-report path/to/playwright-report
   ```

The `healing-report.json` (self-healing locator summary) is also included in the same artifact bundle under `test-results/`.

When at least one selector heal occurred, a dedicated `healing-report-<project>-<run_id>` artifact is also uploaded (MINCRM-149). This artifact contains only `healing-report.json` and provides a single-click download link in the PR comment — no need to extract the full `playwright-artifacts` bundle.

**What `healing-report.json` contains:**

| Field         | Description                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `totalHeals`  | Number of selector heals across all tests in the run                                                                                             |
| `aiHeals`     | Subset of heals resolved by the AI tier (requires `AI_HEALING=true`)                                                                             |
| `staticHeals` | Subset resolved by static strategy fallback (testId → role → label → text → css → xpath)                                                         |
| `events`      | Array of individual heal events — each records the test name, original strategy, healed-to strategy, timestamp, and whether the AI tier was used |

**When it appears:** Only when `totalHeals > 0`. On a clean run with zero heals the file is empty (or absent) and no dedicated artifact is uploaded. The PR comment will contain no healing report link.

**How to interpret:** Each event in `events` names the original strategy that failed (e.g. `testId: "submit-button"`) and the fallback that succeeded (e.g. `role: "button" / name: "Save"`). A heal indicates a `data-testid` attribute was missing or changed — the test passed via fallback but the selector should be restored to keep tests resilient.

### Locally

By default, traces are disabled locally (no cost, no disk usage on passing runs).

To enable full trace capture for a single local run without editing `playwright.config.ts`:

```bash
PLAYWRIGHT_TRACE=on npx playwright test --config=qa/e2e/playwright.config.ts
```

Traces are written to `qa/test-results/` (excluded from git via `.gitignore`).

### Expected Artifact Sizes

These are approximate per-test sizes on the MiniCRM suite:

- **Trace**: 1–5 MB (larger for tests with many network requests or heavy DOM)
- **Screenshot**: 50–200 KB
- **Video**: 1–10 MB (depends on test duration)

If artifact sizes are significantly larger, check for unintentional waits or long test durations.
