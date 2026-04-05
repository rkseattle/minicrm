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

## Running Tests

```bash
# All tests (uses playwright.config.ts defaults)
npx playwright test --config=qa/e2e/playwright.config.ts

# Desktop project only
npx playwright test --config=qa/e2e/playwright.config.ts --project=desktop

# Specific spec file
npx playwright test --config=qa/e2e/playwright.config.ts qa/e2e/tests/apps/minicrm/bvt.spec.ts
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
