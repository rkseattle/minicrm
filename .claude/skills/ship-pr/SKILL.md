---
name: ship-pr
description: Run the full pre-push gate including E2E, push the branch, open the PR, and transition the covered Jira tickets to In Review.
argument-hint: <MINCRM-N> [MINCRM-N ...]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

Ship the branch covering: $ARGUMENTS

Run only after `/branch-review` has returned APPROVE.

## Step 1 — Local CI equivalence

Read `.claude/gates/pre-push.md` and run the checklist in order. Everything CI will run,
runs here first. All green before anything is pushed.

## Step 2 — E2E

Read `.claude/gates/e2e-run.md` and run the gate. Key points, since this is where the
run usually goes wrong:

- `date` in its own Bash call, first.
- Rebuild and recreate `server-e2e` — a stale container silently runs old server code
  and produces failures that look like test bugs.
- `rm -rf qa/e2e/test-results/` so stale output cannot influence the verdict.
- Scope the `--grep` to the domains this branch touched. If you are not confident the
  blast radius is contained, ask before narrowing.
- Non-serial and serial as two separate runs, `--workers=1` each.
- Read `qa/e2e/test-results/results.xml` for the counts. Not the console. Not the exit
  code. If output truncates, read the file — do not re-run.

One run. If it fails, root-cause and fix, then run **once** against just the affected
specs. Never re-run to see whether a failure goes away. Never dismiss one as a known
flake, pre-existing, or unrelated, and never compare against `main` to wave it off. If
you cannot find the root cause, say so explicitly and ask how to proceed.

## Step 3 — Clean the working tree

`git status`. Restore every tracked file with local modifications that is not part of
the intended commit set — `qa/e2e/heal-trends.json`, test results, generated outputs.
Pushing these contaminates history. When unsure whether a change was intentional, ask.

## Step 4 — Push and open the PR

```bash
git push -u origin <branch>
gh pr create --title "<ALL ticket IDs> — <summary>" --body "<body>"
```

Title lists every covered ticket ID in full — `MINCRM-542, MINCRM-565` — never
abbreviated, never partial.

Body:

- What ships, in prose
- Ticket links
- Per-ticket acceptance criteria and how each is satisfied
- Testing performed, including the E2E scope and the counts read from `results.xml`
- Migrations, feature flags, and any manual deployment step
- Anything deliberately deferred, with the reason

## Step 5 — Jira

Transition every covered ticket to **In Review**. Call `jira_get_transitions` for the
transition ID first — never guess it.

## Step 6 — Hand off

Report the PR URL and the ticket transitions. Then run `/ci-green` to watch the run
through to completion.
