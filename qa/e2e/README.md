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

## Timing-Aware Sharding (MINCRM-549)

Playwright's built-in `--shard=K/N` splits tests by count, ignoring duration. This produces hot-spot workers when a few spec files are significantly longer than the rest. The timing pipeline replaces count-based sharding with **LPT (Longest Processing Time) bin-packing**, minimising the maximum worker wall time (makespan).

### How it works

1. **`TimingReporter`** (`framework/reporting/timing-reporter.ts`) appends one JSONL record per test to `test-timing.jsonl` on every local or CI run. The file accumulates history across runs and is gitignored.
2. **`compute-timing-baseline`** reads `test-timing.jsonl`, filters out `skipped`/`timedOut` records, computes the median duration per spec file across all qualifying runs, and writes `test-timing-baseline.json`. Files with fewer than 3 qualifying runs fall back to a 30 000 ms default and emit a warning.
3. **`gen-shards`** reads the baseline, discovers all functional spec files, and runs LPT bin-packing: sort files descending by estimated duration, then greedily assign each to the worker with the lowest accumulated total. Produces a `string[][]` assignment (index = worker, values = file paths).
4. **`gen-shard-config`** runs the same LPT logic and writes a `playwright.shard.<N>.config.ts` file for each shard index, overriding only `testMatch` from the base config.
5. **CI** (`e2e-timing-setup` job) generates all shard configs before the matrix runs, uploads them as an artifact, and each `e2e-functional` matrix shard downloads and uses its own config. If the baseline is absent (e.g. first run on a fresh branch), CI falls back to native `--shard=K/N`.
6. **Baseline update** (`.github/workflows/update-timing-baseline.yml`) runs after every push to `main`: downloads all shard JSONL artifacts, merges them, recomputes the baseline, and commits the updated `test-timing-baseline.json` with `[skip ci]`.

### Shard/worker count (MINCRM-662)

Shard count (`N` in `--total-shards=N`) and per-shard worker count are computed by a `capacity-probe` CI job (`qa/e2e/framework/reporting/capacity.ts`, run via `npm run e2e:capacity-plan`) instead of two hand-maintained constants. The probe measures the runner's CPU core count and derives both values — yielding **2 shards x 4 workers** on today's GitHub-hosted runners (4 vCPUs, since this is a public repository), and scaling for differently-sized runners (self-hosted, a larger nightly box) without manual retuning. If CPU count can't be determined, it falls back to 4 shards / 2 workers — the pre-probe constants, kept as a detection-failure fallback rather than as a description of any current runner. See [docs/dev/e2e-performance.md](../../docs/dev/e2e-performance.md) for the empirical findings behind the formula.

### Committed vs. gitignored

| File                           | Status         | Purpose                                                            |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| `test-timing-baseline.json`    | **Committed**  | Shared source of truth — median durations per file, consumed by CI |
| `test-timing.jsonl`            | **Gitignored** | Per-machine run history — accumulates locally, uploaded from CI    |
| `playwright.shard.*.config.ts` | **Gitignored** | Generated fresh per CI run by `e2e-timing-setup`                   |

### npm scripts (run from repo root)

```bash
# Recompute the baseline from local test-timing.jsonl history
npm run e2e:timing:baseline

# Preview LPT shard assignment for 4 workers (prints assignment + makespan to stdout)
npm run e2e:timing:shards -- --workers=4

# Generate playwright.shard.0.config.ts for shard 0 of 4 (locally, for testing)
npm run e2e:timing:gen-config -- --shard-index=0 --total-shards=4
```

### Running timing-aware shards locally

```bash
# 1. Build a baseline (requires at least 3 prior runs of the full suite)
npm run e2e:timing:baseline

# 2. Generate a shard config (e.g. shard 0 of 4)
npm run e2e:timing:gen-config -- --shard-index=0 --total-shards=4

# 3. Run only that shard
npx playwright test --config=qa/e2e/playwright.shard.0.config.ts --project=desktop
```

If `test-timing-baseline.json` does not yet exist, run the full suite a few times first so `test-timing.jsonl` accumulates enough history, then run `npm run e2e:timing:baseline` to generate it. The generated baseline should be committed so CI and other developers share the same estimates.

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
