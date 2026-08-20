# Contributing

What to run before you commit, before you push, and what CI will check that you did.

---

## Before every commit

In order, all green:

```bash
npm run typecheck        # all workspaces plus the root scripts
npm run lint             # eslint across the repo
bash scripts/npm-audit-gate.sh
npm run unit_test        # server, client, coverage-dashboard — in series
```

Then the QA static checks, plus any conditional gates the diff triggers —
`.env*.example` parity, compose isolation, the comments-only guard, markdown lint,
`actionlint`. Both lists, with the reason each check exists, are in
[.claude/gates/definition-of-done.md](../../.claude/gates/definition-of-done.md); they
are not copied here, because a second copy of that list is a second thing to drift.

**The audit is unconditional.** Advisories land against versions already in the
lockfile, so "I changed no dependencies" is exactly when drift goes unnoticed. The bar
is zero high or critical, with no allowlist. Run
`bash scripts/npm-audit-gate.sh` rather than bare `npm audit` — the script fails closed
when the registry returns no verdict, where `npm audit` reports success.

**Run the unit suites in series, and nothing heavy beside them.** `npm run unit_test`
already sequences the three workspaces. They are CPU-bound, so competing for cores does
not slow them down gracefully — it fails them, as timeouts in files unrelated to your
change.

**Delete stale result files before a run, then read the files rather than the console.**
Each workspace writes `test-results/junit.xml`, and `coverage/coverage-summary.json`
under `test:coverage`. A truncated run reports zero failures, and so does a stale file
left from a previous run.

---

## Before every push

1. **Rebase onto the parent branch first.** Every gate below certifies a specific tree,
   so a rebase after running them describes code you are no longer pushing — the usual
   cause of a branch that is green locally and red in CI.

   ```bash
   git fetch origin
   git rebase origin/<parent>   # main, unless this branch was cut from another
   ```

   A stacked branch rebases onto its own parent, not past it — `git merge-base` confirms
   which when you are unsure.

   Resolve conflicts by reading both sides. Taking `--ours` or `--theirs` wholesale
   silently drops someone's work. After a rebase, push with `--force-with-lease`, never
   bare `--force` — the lease refuses when the remote moved under you.

2. **Re-run the commit gates** if the rebase moved anything.

3. **Run E2E once**, scoped to the domains the branch touched. The procedure is in the
   [Operations Guide](../operations.md#running-the-e2e-suite).

4. **Check `git status`** and restore artifacts you did not mean to change — test
   results, healing reports, coverage output.

What the pre-push hook itself runs, and when bypassing it is legitimate, is in
[CI](ci.md#local-gates-before-you-push).

---

## Opening a pull request

- Branch from `main`.
- Conventional Commits prefix on the title (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- List every covered ticket ID in full — `MINCRM-542, MINCRM-565 — …`, never abbreviated.
- Reference the ticket in each commit message, never in a source comment.

`ci-gate` is the only required check. What it requires, and how to reproduce each job
locally, is in [CI](ci.md).

---

## Adding an endpoint

Work through the [New Endpoint Checklist](new-endpoint.md) — layering, authorization,
audit-in-transaction, and error mapping each have a rule that CI or review will enforce.

---

## Failing tests

No failure is a known flake. Not pre-existing, not unrelated, not flaky — whether a test
has failed before has no bearing on whether it is failing now, and a rerun that passes
is not a resolution. Root-cause it, or say explicitly that you could not and ask.

---

## Where the rest of this lives

`.claude/` holds the agent-facing copies of these procedures: the gate files add
session-level pacing (when to run E2E on a multi-commit branch, what to do between
phases) that has no meaning for a person working normally. Where a rule binds both, this
page is the human account and the gate points here.
