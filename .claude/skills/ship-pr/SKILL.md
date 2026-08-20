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

Read `.claude/gates/e2e-run.md` and run the gate. Key points, since this is where the
run usually goes wrong:

- `date` in its own Bash call, first.
- Rebuild and recreate the test server (`docker-compose.test.yml`) — a stale container silently runs old server code
  and produces failures that look like test bugs.
- `rm -rf qa/e2e/test-results/` so stale output cannot influence the verdict.
- Scope the `--grep` to the domains this branch touched. If you are not confident the
  blast radius is contained, ask before narrowing — declaring the stop per `deliver`'s
  invariants, since the phase state is still live until Step 4.
- Non-serial and serial as two separate runs, `--workers=1` each.
- Read `qa/e2e/test-results/results.xml` for the counts. Not the console. Not the exit
  code. If output truncates, read the file — do not re-run.

One run. If it fails, root-cause and fix, then run **once** against just the affected
specs. Never re-run to see whether a failure goes away. Never dismiss one as a known
flake, pre-existing, or unrelated, and never compare against `main` to wave it off. If
you cannot find the root cause, say so explicitly and ask how to proceed, declaring the
stop per `deliver`'s invariants.

## Step 3 — Clean the working tree

`git status`. Restore every tracked file with local modifications that is not part of
the intended commit set — `qa/e2e/heal-trends.json`, test results, generated outputs.
Pushing these contaminates history. When unsure whether a change was intentional, ask.

## Step 4 — Push and open the PR

```bash
SKIP_TIA_PREPUSH=1 git push -u --force-with-lease origin <branch>
gh pr create --title "<ALL ticket IDs> — <summary>" --body "<body>"
```

`--force-with-lease` because Step 1's rebase rewrote the branch, so a branch that was
already pushed will reject a fast-forward push. Never bare `--force`: `--force-with-lease`
aborts when the remote moved under you instead of overwriting whatever landed there.

`SKIP_TIA_PREPUSH=1` because Step 2 just ran the E2E gate by hand, and the `pre-push`
hook would otherwise run its own selection over an identical tree — twenty-plus minutes
to re-derive a verdict you already have. Preferred over `--no-verify`, which skips the
hook silently; the env var is the hook's own escape hatch and logs each use to
`.git/tia-prepush-bypass.log`.

Only valid when Step 2 ran **both halves** with zero failures in `results.xml` **and**
HEAD has not moved since — check `git rev-parse HEAD`, never assume. If anything was
committed, amended, or rebased after those runs (a fix for something they surfaced
counts), the result is void: drop the flag, or re-run the gate. See "Not re-running E2E
in the push hook" in `.claude/gates/pre-push.md` for the full conditions and what the
bypass gives up. Never use it to get around a failure or a run you'd rather not sit
through.

If the lease check rejects the push, the remote branch has commits your local copy does
not — someone else pushed, or an earlier run of this skill did. Do not re-force past it.
Fetch, look at what is there, and reconcile.

Once the PR exists, the phase state no longer describes live work — clear it:

```bash
rm -f .claude/state/current-plan.json .claude/state/blocked-*
```

Title lists every covered ticket ID in full — `MINCRM-542, MINCRM-565` — never
abbreviated, never partial.

Body:

- What ships, in prose
- Ticket links
- Per-ticket acceptance criteria and how each is satisfied
- Testing performed, including the E2E scope and the counts read from `results.xml`
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
