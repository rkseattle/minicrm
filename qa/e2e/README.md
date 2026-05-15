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

## Page Object Authoring Checklist

Every `page.locate()` call in a page object (`pages/minicrm/*.ts`) must satisfy both rules
or the ESLint `local/require-locator-intent` and `local/require-locator-fallback` rules will
fail the lint phase:

1. **Two strategies minimum** — the strategy array must contain at least two entries.
   Primary is always `testId`; add a `role`, `label`, `text`, or `css` attribute fallback.
2. **`intent` string required** — the second argument must be `{ intent: 'description' }`
   (5–10 words describing what the locator is finding). This activates the AI healing tier
   when all static strategies are exhausted.

```ts
// CORRECT
const button = await this.page
  .locate(
    [
      { type: 'testId', value: 'new-contact-button' },
      { type: 'role', value: 'button', options: { name: /new contact/i } },
    ],
    { intent: 'button to open the new contact form' },
  )
  .resolve();

// WRONG — single strategy, no intent
const button = await this.page.locate([{ type: 'testId', value: 'new-contact-button' }]).resolve();
```

Spec files (`tests/apps/minicrm/**/*.spec.ts`) must also satisfy the two-strategy minimum
for any `page.locate()` call. Dynamic row-scoped IDs (e.g. `deal-card-${id}`) may use a
single `testId` strategy when no stable role-based fallback exists — add a comment explaining why.

## Lint Gates

Two shell scripts enforce architectural contracts on every PR. Both run in the `e2e-framework-purity` CI job and can be run locally before pushing.

### Framework purity (`lint:framework-purity`)

Fails if any file under `qa/e2e/framework/` imports an application-domain string (contact names, route paths, etc.). The framework layer must remain product-agnostic so it can be reused across projects.

```bash
npm run lint:framework-purity --workspace=minicrm-qa
# or directly:
bash qa/scripts/check-framework-purity.sh
```

### Behavior-layer contract (`lint:behavior-layer`) — MINCRM-367

Fails if any spec file under `qa/e2e/tests/apps/` imports directly from `@pages/*`. Spec files must route all UI interactions through named behavior functions in `qa/e2e/behaviors/minicrm/` — never reference Page Objects directly.

```bash
npm run lint:behavior-layer --workspace=minicrm-qa
# or directly:
bash qa/scripts/check-behavior-layer.sh
```

**How to fix a violation:**

1. Identify the Page Object method called in the spec.
2. Add a behavior wrapper in `qa/e2e/behaviors/minicrm/<domain>.behaviors.ts` that calls the PO method and exports it with a clear, intent-bearing name.
3. Import the behavior in the spec instead of the PO, and remove the `@pages/*` import.

## Smoke-Level Coverage

Smoke-level (sanity) E2E coverage is provided by 10 smoke-tagged tests spread across the functional suite (MINCRM-193). These tests cover the critical end-to-end journeys — auth login/logout, contact create/list/edit, deal create/advance/close-Won, task create/complete, and user invite/first-login — and run first in Phase 3 CI. The framework integration test lives at `functional/framework/bvt-framework.spec.ts`.

Smoke tests are tagged `@smoke @functional` and live alongside their domain suites. To run them locally:

```bash
npx playwright test --config=qa/e2e/playwright.config.ts --grep @smoke
```

## Running Tests

```bash
# All tests (uses playwright.config.ts defaults)
npx playwright test --config=qa/e2e/playwright.config.ts

# Desktop project only
npx playwright test --config=qa/e2e/playwright.config.ts --project=desktop

# Smoke tests only (10 targeted tests across domain suites)
npx playwright test --config=qa/e2e/playwright.config.ts --grep @smoke

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

| Field                | Description                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `totalHeals`         | Number of selector heals across all tests in the run                                                                                             |
| `aiHeals`            | Subset of heals resolved by the AI tier (requires `AI_HEALING=true`)                                                                             |
| `staticHeals`        | Subset resolved by static strategy fallback (testId → role → label → text → css → xpath)                                                         |
| `aiHealCount`        | Count of AI heal events this run (alias of `aiHeals`; used for threshold checks)                                                                 |
| `estimatedTokenCost` | Sum of token costs across all AI heal events in this run (0 when no AI heals occurred)                                                           |
| `events`             | Array of individual heal events — each records the test name, original strategy, healed-to strategy, timestamp, and whether the AI tier was used |

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
