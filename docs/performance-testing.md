# Performance Testing — Approach & Recommendation

**Spike:** MINCRM-369  
**Status:** Decided — PoC implemented, follow-on story written

---

## Problem

The existing E2E suite has no mechanism for asserting anything about performance.
A query that regresses from 200 ms to 2000 ms, a page load that doubles in LCP,
or an API endpoint that degrades under realistic data volume will all pass every
functional test. For a CRM that accumulates thousands of contacts and deals,
performance regressions are a real product risk with no automated safety net.

---

## Investigation Summary

### HAR capture

Playwright can record a full HTTP Archive (HAR) file via `recordHar` on the browser context.
HAR entries include `timings.receive`, `timings.wait`, and `timings.send`.

**Verdict: not recommended.** Playwright's `response.timing()` method provides the same
data (`requestStart`, `responseStart`, `responseEnd`) directly on every Response object,
without the overhead of writing and parsing a multi-megabyte HAR file. `page.on('response')`

- `response.timing()` is simpler, more precise, and produces no artifacts to manage.

### Core Web Vitals via CDP

Playwright exposes the Chrome DevTools Protocol via `page.evaluate()`.
`PerformanceObserver` and `navigation.timing` are accessible from the page context
and can capture LCP, CLS, TTFB, and INP.

**Verdict: recommended, with one refinement.** Rather than calling `PerformanceObserver`
ad-hoc in each test, inject a compact accumulator script via `page.addInitScript()` before
the first navigation. This ensures LCP and CLS observers are registered prior to content
loading (the browser finalizes LCP at the first user interaction or 5 s timeout; an observer
registered after load misses it). The accumulator writes results to `window.__webVitals`,
which `page.evaluate()` reads after load. The `web-vitals` npm library uses the same pattern;
we inline the relevant subset to avoid a runtime network dependency.

### Regression gate vs. absolute threshold

A **regression gate** (compare against a baseline JSON committed to the repo) sounds
appealing but has two failure modes in practice:

1. **Stale baselines.** A fast dev machine writes the baseline; a slow CI container can
   never match it, causing permanent spurious failures. Every "fix" is a baseline update
   PR, not a code fix.

2. **Rubber-stamp PRs.** Reviewers approve baseline PRs without scrutiny because the diff
   is always "numbers got slightly faster/slower."

**Verdict: absolute thresholds win.** Set them conservatively (well above expected values
in a loaded CI container) so they catch order-of-magnitude regressions (200 ms → 2000 ms)
without failing on normal CI variance. Thresholds are overridable via environment variables
without code changes, which lets CI tighten them progressively as confidence builds.

| Metric      | Default Threshold | Rationale                                                      |
| ----------- | ----------------- | -------------------------------------------------------------- |
| LCP         | 5 000 ms          | Google "needs improvement" is 4 s; +1 s for cold CI containers |
| CLS         | 0.50              | Google "needs improvement" is 0.25; ×2 for CI tolerance        |
| TTFB (page) | 2 000 ms          | Catches server hangs or missing DB indexes                     |
| INP         | 1 000 ms          | Google "needs improvement" is 500 ms; ×2 for CI tolerance      |
| API TTFB    | 3 000 ms          | Catches query regressions (200 ms → 2000 ms)                   |

### Separation from functional tests

Mixing performance assertions into functional tests has two costs:

1. **Ambiguous failures.** "Did the feature break, or was CI just slow?" is unanswerable
   from a single combined test result.

2. **Suite slowdown.** Performance measurement requires `waitForLoadState('networkidle')`,
   which adds latency even on fast machines.

**Verdict: dedicated `perf` Playwright project.** A `perf` project uses `grep: /@perf/`
to run only `@perf`-tagged tests; the functional projects (`desktop`, `mobile-web`) ignore
them. The `perf` project runs in CI as a separate job, uploads `perf-report.json` as an
artifact, and fails independently of functional results.

---

## Chosen Architecture

```
framework/performance/
  perf-metrics.ts       ← Web Vitals injection + response timing collection
  perf-thresholds.ts    ← Absolute threshold defaults + violation checker
  perf-registry.ts      ← Per-worker PerfSample accumulator (mirrors HealingRegistry)
  perf-reporter.ts      ← Playwright reporter: merges samples → perf-report.json
  perf-fixture.ts       ← measurePerf() fixture: one call captures + asserts + records
  index.ts              ← barrel

tests/apps/minicrm/perf/
  contacts-list.perf.ts ← PoC: LCP + API TTFB for contacts list page load
```

**CI integration:** add a `perf` job to `.github/workflows/` that:

1. Runs `npm run test:perf --workspace=minicrm-qa`
2. Uploads `qa/e2e/test-results/perf-report.json` as an artifact
3. Fails the job if any `@perf` test fails (threshold violation)

The `perf` job runs after functional tests pass, on the same environment. It does not
gate merges in the short term — the goal in the follow-on story is to calibrate thresholds
and determine whether perf should be a merge gate.

---

## Proof of Concept

`qa/e2e/tests/apps/minicrm/perf/contacts-list.perf.ts` demonstrates the full flow:

1. `measurePerf({ scenario, navigateTo, apiUrlFilter })` injects Web Vitals, navigates
   to `/contacts`, waits for network idle, collects vitals + API timings, checks thresholds,
   and records a `PerfSample` to `perf-report.json`.
2. Two tests cover the scenario: one asserting zero threshold violations, one asserting
   structural correctness of the captured data (non-negative values, at least one API call).

Run locally:

```bash
npm run test:perf --workspace=minicrm-qa
```

---

## What This Does Not Cover

- **Lighthouse CI** (`lhci autorun`): Lighthouse wraps all Web Vitals in a battle-tested
  runner with budget assertions, PR check integration, and a hosted dashboard. It is the
  industry standard for page-level performance CI. The follow-on story should evaluate
  adding `lhci` for pages where a full Lighthouse score is valuable (dashboard, pipeline
  board) and keeping the `response.timing()` approach for API latency assertions.

- **Load testing / concurrency:** The current approach measures single-user latency.
  Load testing (k6, Artillery) is out of scope for this spike but is a real risk for
  list endpoints under 10 000+ rows.

- **Server-side timing headers:** `Server-Timing` response headers expose per-query
  breakdown (DB time, serialization time) separate from network overhead. Adding them
  to slow endpoints would make API TTFB assertions more actionable.

---

## Follow-on Story

See MINCRM-379 (written as part of this spike): "Implement performance CI job and
calibrate thresholds from baseline run."

Estimated: 2 days.

Acceptance Criteria:

- GitHub Actions `perf` job runs `npm run test:perf` after functional tests pass
- `perf-report.json` uploaded as a CI artifact
- Thresholds calibrated from at least 3 baseline runs on the CI environment
- Decision documented on whether perf should gate merges (default: no, advisory only)
- `@perf` test coverage extended to at least 3 scenarios: contacts list, deals pipeline, dashboard
