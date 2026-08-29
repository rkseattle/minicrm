---
name: ship-pr
description: Run the full pre-push gate including E2E, push the branch, open the PR, and transition the covered Jira tickets to In Review.
argument-hint: <MINCRM-N> [MINCRM-N ...]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

Ship the branch covering: $ARGUMENTS

Run only after `/branch-review` has returned APPROVE.

## Step 1 — Rebase onto the parent, then local CI equivalence

Read `.claude/gates/pre-push.md` and run the checklist in order. Everything CI will run,
runs here first. All green before anything is pushed.

The checklist opens with a rebase onto the parent branch, and it is first for a reason:
CI tests your branch merged with the parent, so a gate run on the pre-rebase tree is not
testing what CI will test. Rebase before Step 2's E2E as well — pulling in parent commits
after a passing E2E run invalidates it, and that run is expensive to repeat.

## Step 2 — E2E

**The push in Step 4 runs it.** The `pre-push` hook resolves the diff to the affected
specs and attests that they executed against this HEAD. Do not run Playwright by hand
here and then bypass the hook — see `.claude/gates/pre-push.md`'s bypass section for why,
and `.claude/gates/e2e-run.md` for the cadence rules that still apply.

Two things are still yours to do before pushing, because the hook cannot:

- **Rebuild and recreate the test server** (`docker-compose.test.yml build server`, then
  `up -d server`, with `GIT_COMMIT_SHA` exported first). A stale container silently runs
  old server code, and the resulting failures look like test bugs. The hook warns when the
  running stack's SHA is not HEAD, but it cannot rebuild for you.
- **Confirm the client is serving** on :5175 (`npm run e2e:client`).

Read the counts from `qa/e2e/test-results/results.xml`, never the console and never the
exit code. If output truncates, read the file — do not re-run.

One run. If it fails, root-cause and fix, then validate that fix by running **the specs
the fix affects** — and push again with `SKIP_TIA_PREPUSH=1` rather than sitting through a
second full suite. That is the documented path, not a shortcut: "After the hook's own E2E
run fails" in `.claude/gates/pre-push.md` sets out the procedure and its bounds. Never
re-run to see whether a failure goes away, never dismiss one as a known flake,
pre-existing, or unrelated, and never compare against `main` to wave it off. If you cannot
find the root cause, say so explicitly and ask how to proceed, declaring the stop per
`deliver`'s invariants.

## Step 3 — Clean the working tree

`git status`. Restore every tracked file with local modifications that is not part of
the intended commit set — `qa/e2e/heal-trends.json`, test results, generated outputs.
Pushing these contaminates history. When unsure whether a change was intentional, ask.

## Step 4 — Push and open the PR

**Detach the push.** The hook runs E2E inside it, so this command can take an hour — the
manual procedure in `e2e-run.md` sets `PW_GLOBAL_TIMEOUT_MS=3600000` for the same run, and
the hook widens to the full suite whenever the diff touches module-scope code it cannot map
to a function. A foreground `Bash` call cannot outlive that tool's 600s ceiling, and a
`run_in_background` task dies with the session. Both kill the run mid-suite. `nohup`
survives both:

```bash
export GIT_COMMIT_SHA=$(git rev-parse HEAD)
nohup git push -u --force-with-lease origin <branch> > /tmp/push.log 2>&1 &
```

Then arm a `Monitor` that watches for the remote branch appearing, and stay quiet until it
reports. Read the counts from `qa/e2e/test-results/results.xml` when it lands.

**A killed run is not a failed run.** No `results.xml` means the suite produced no verdict
to accept, so starting it again is not a rerun under `e2e-run.md`'s never-rerun rule — that
rule governs runs that finished and told you something. Confirm HEAD is unchanged, then
start it again, detached.

```bash
gh pr create --title "<ALL ticket IDs> — <summary>" --body "<body>"
```

`--force-with-lease` because Step 1's rebase rewrote the branch, so a branch that was
already pushed will reject a fast-forward push. Never bare `--force`: `--force-with-lease`
aborts when the remote moved under you instead of overwriting whatever landed there.

**No `SKIP_TIA_PREPUSH=1` on the first push.** This push is where the E2E gate runs: the
hook selects the affected specs, executes them, and attests they ran against this HEAD.
Expect it to take a while, and let it. The bypass is not for a run you would rather not
sit through.

**If the hook's E2E run fails**, that is the gate doing its job. Root-cause and fix the
failure, run the specs the fix affects to confirm it, then push again _with_
`SKIP_TIA_PREPUSH=1` — the full suite already ran against this branch and reported exactly
those failures, so re-running all of it re-executes hundreds of specs whose verdict has not
changed. The procedure and its bounds are "After the hook's own E2E run fails" in
`.claude/gates/pre-push.md`; follow it there rather than improvising here.

**A run that never executed is not a failed run.** A `StaleDataAbortError` from a stale
E2E database, or a test stack built at the wrong SHA, produces no verdict — fix the
environment and let the hook run normally. There is nothing to preserve and nothing to
bypass.

If the lease check rejects the push, the remote branch has commits your local copy does
not — someone else pushed, or an earlier run of this skill did. Do not re-force past it.
Fetch, look at what is there, and reconcile.

Once the PR exists, the phase state no longer describes live work — clear it. The file is
per-checkout, and a checkout has one HEAD, so any concurrent session here is on this same
branch and this same plan; a session on another branch has its own worktree and its own
state:

```bash
find .claude/state -type f -delete
```

Title lists every covered ticket ID in full — `MINCRM-542, MINCRM-565` — never
abbreviated, never partial.

Body:

- What ships, in prose
- Ticket links
- Per-ticket acceptance criteria and how each is satisfied
- Testing performed: what the hook selected (targeted or full-suite, and why), and the
  counts read from `results.xml`
- Migrations, feature flags, and any manual deployment step
- Anything deliberately deferred, with the reason. Every entry here must already have
  cleared the deferral procedure in `deliver`'s invariants — `commit-adversary` on the
  benign claim, then Rob's explicit agreement. The PR body records a decision already
  made; it is not where a deferral gets decided, and "listed in the PR" is not a
  substitute for fixing.

## Step 5 — Jira

Transition every covered ticket to **In Review**. Look up the issue's available
transitions via the Atlassian MCP first and use the ID it returns — never guess one.

## Step 6 — Hand off

Report the PR URL and the ticket transitions. Then run `/ci-green` to watch the run
through to completion.
