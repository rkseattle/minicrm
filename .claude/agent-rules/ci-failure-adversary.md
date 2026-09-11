# ci-failure-adversary — MiniCRM rules

## Reading the evidence

`gh run view --log-failed`, the job's uploaded artifacts, or the results file — never a
console summary or an exit code. Unit results are `<workspace>/test-results/junit.xml`;
E2E is `qa/e2e/test-results/results.xml`.

For a healed-locator E2E failure, pull that specific run's `healing-report.json` via
`gh api .../artifacts/<id>/zip`. The local `heal-trends.json` is from a different run and
will mislead you.

## Pattern-spread targets

- A React Query cache race raises the question of every component with the same cache
  lifecycle
- A missing `await` on a transaction path raises it for every write service
- A missing ownership clause raises it for every endpoint

## Environmental exceptions

**There are none.** Every failure here is a real failure. A run that aborted before
executing anything — a `StaleDataAbortError` from a stale E2E database, a test stack built
at the wrong SHA — produced no verdict at all rather than an environmental pass: fix the
environment and re-run, but never record that as a root cause.

Specifically rejected as root causes: load-induced timeouts, "the test has failed before",
and a rerun that passed.
