# E2E Performance & Shard Sizing (MINCRM-662)

Reference notes on how the E2E suite's parallelism is sized, and the
empirical findings that informed the capacity-probe design in
`qa/e2e/framework/reporting/capacity.ts`.

## Background: what CI does today

CI splits the ~1000-test functional suite into `TOTAL_SHARDS` parallel jobs
(one runner VM per shard), each running `--workers=N` Playwright workers.
Shard/worker counts were previously two hand-maintained constants tuned once
for a 2-vCPU runner (`.github/workflows/ci.yml`): 4 shards x 2 workers = 8
parallel test slots. Today the capacity probe derives them instead, and on
GitHub-hosted `ubuntu-latest` (4 vCPUs) it produces **2 shards x 4 workers** —
the same 8 slots, distributed differently. `qa/e2e/scripts/gen-shard-config.ts`
assigns spec files to shards via LPT (Longest Processing Time) bin-packing
using `qa/e2e/test-timing-baseline.json`, so each shard's wall-clock time is
roughly balanced regardless of file ordering.

MINCRM-662 replaced the two hardcoded constants with a capacity probe
(`getCapacityPlan()` in `capacity.ts`) that derives both values from a
measured per-runner CPU count, reproducing the original 4 x 2 pair at a 2-vCPU
input and scaling for differently-sized runners (self-hosted, a larger nightly
box) without manual retuning. Those original values survive only as
`FALLBACK_PLAN`, used when CPU count cannot be determined.

## Empirical findings that shaped the design

The following was measured locally on 2026-07-22 (Apple M4 Pro, 12 cores,
24GB host RAM, Docker Desktop VM capped at 7.75GB) while investigating why
`--workers=1` locally could not complete the full local run inside
Playwright's `globalTimeout`.

### `--workers=1` cannot finish the full suite inside `globalTimeout`

411 of 1016 tests completed in the full 20-minute `globalTimeout` window
(~20.6 tests/min), extrapolating to ~49 minutes for the full suite — over
double the budget. Root cause is architectural, not a resource shortfall:
`globalTimeout` is sized for one CI shard's slice of the suite, not the whole
suite run as a single local invocation.
This finding is independent of this specific machine's capability — a 12-core
machine ran into the same wall a smaller CI runner would, because the mismatch
is between the timeout budget and the amount of work assigned to one worker,
not raw compute.

### `--workers=4` is faster but not _reliably_ within budget

Two identical back-to-back local runs (same command, same machine, same
suite) produced 18.7 minutes and 40.3 minutes wall clock respectively,
despite near-identical aggregate test-time (~18-19 min if perfectly
load-balanced). Playwright's default file-to-worker assignment is
round-robin/FIFO, not duration-aware, so it can unluckily cluster several
slow spec files (e.g. gdpr, pipeline-dnd, onboarding, search) onto one worker
while others sit comparatively idle — and that clustering varies run to run.
**A plain `--workers=N` invocation with no LPT-based shard config does not
reliably solve the timeout problem** — this is exactly the class of problem
`gen-shard-config.ts`'s LPT bin-packing exists to solve, and it should be
used for any full-suite run (local or CI), not a bare `playwright test`
invocation.

### The E2E server, not client CPU, is the real capacity ceiling

`minicrm-test-server` — the containerized API server — stayed pegged at
~87-108% CPU for the entire `--workers=4` run. It is a single-threaded Node
process (`tsx server.ts`, no clustering), so it saturates one core regardless
of how many Playwright workers send it concurrent requests. Host CPU (12
cores, peak load ~6/12) and Docker memory (peak <5% of 7.75GB) were never
binding constraints in either run measured.

**Implication for capacity planning:** raw client-side CPU core count is an
_upper bound_ on useful worker parallelism, not a guarantee that more workers
will proportionally speed up a run — the server-side ceiling means workers
beyond a small number mostly queue against the same saturated process. This
is why `computeCapacityPlan()` caps workers-per-shard (`WORKERS_CAP = 4`)
instead of scaling workers linearly with detected CPU count.

### Scope of these findings

This data covers the **non-serial functional suite** only. The `@serial`
suite (tests that mutate shared `system_settings` rows, see
[e2e-authoring.md](e2e-authoring.md)) is a different, smaller test
population by design and was not separately measured — do not assume the
same tuning applies there without measuring it directly.

## Recommendation for local full-suite runs

1. Do not rely on a plain `--workers=N` invocation to reliably finish inside
   `globalTimeout` — confirmed by measurement to vary by more than 2x between
   identical consecutive runs, regardless of worker count.
2. Use the same LPT-based sharding CI uses
   (`qa/e2e/scripts/gen-shard-config.ts`, driven by
   `qa/e2e/test-timing-baseline.json`) for local full-suite runs instead of a
   bare `playwright test` invocation.
3. The per-project documented local command
   (see `.claude/gates/e2e-run.md`) already uses `--workers=1` for
   both non-serial and serial local suites deliberately (MINCRM-557) rather
   than optimizing for local wall-clock time — that tradeoff is intentional,
   not an oversight. Note this is **not** parity with CI, which runs 4 workers
   per shard: a local run is unsharded, so every spec is visible to every
   worker, and the single-threaded test server caps throughput anyway — ~6%
   between 1 and 2 workers, measured in `scripts/pre-push-tia.ts` and
   `qa/e2e/playwright.config.ts`'s `globalTimeout` comment.
