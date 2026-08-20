---
name: ci-green
description: Monitor a PR's CI run and review feedback until every job passes and no unaddressed comments remain, root-causing each failure in an isolated subagent and propagating fix patterns across the codebase.
argument-hint: [PR number, defaults to the current branch's PR]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task
---

Drive PR $ARGUMENTS to fully green with no outstanding feedback.

## Step 1 — Arm the monitor, then stop talking

Start monitoring the CI run. Once a background monitor is armed, **say nothing until it
reports an actual event.** No "I'll wait for the next notification", no "still
running", no `sleep` loops, no polling status checks. The monitor pushes notifications
on its own; narrating the wait is pure noise.

If there is genuinely other useful work available — reading existing PR feedback,
investigating a doc gap — do that work instead of narrating.

## Step 2 — Distinguish hung from running

`Waiting for status to be reported` on a required check is not "still running". It
means no CI run is attached to the current HEAD commit — commonly a `[skip ci]` commit
becoming HEAD with no follow-up trigger. Before forming any opinion about CI state,
check all three:

```bash
gh pr checks <pr>
gh run list --branch <branch>
git log origin/<branch> --oneline -5
```

If Rob says CI is stuck or something is broken, investigate first and report what you
find. Never lead with reassurance. He has been right and the tooling wrong on this
more than once.

## Step 3 — Handle each failure

For every failing job:

1. Retrieve the real evidence. `gh run view --log-failed`, the job's uploaded
   artifacts, or the test results file — never a console summary or an exit code. For a
   healed-locator E2E failure, pull that specific run's `healing-report.json` via
   `gh api .../artifacts/<id>/zip`; the local `heal-trends.json` is from a different
   run and will mislead you.
2. Root-cause it. No failure is dismissed as a known flake, flaky, pre-existing, or
   unrelated — the test's history is irrelevant. Never re-run a job to see whether a
   failure goes away, and never compare against `main` to wave one off. If the root
   cause is genuinely not determinable, say so explicitly and ask how to proceed. No
   `paused` declaration is needed here — `ship-pr` clears the phase state when it opens
   the PR, so the Stop hook is inert for this stage.
3. Write the fix using the industry-standard pattern for the failure mode.
4. **Verify it in an isolated subagent before committing.** Launch
   `ci-failure-adversary` with only the failure evidence and the git ref of the fix —
   no explanation of your reasoning, no argument for why the fix is correct. It decides
   whether the fix addresses the root cause and whether the same root cause exists
   elsewhere in the codebase.
5. Act on its verdict. `SYMPTOM ONLY` or `UNVERIFIED` means the fix is not done. Fix
   every additional site it reports as a live defect in this same commit.
6. Run the full Definition of Done, then commit.
7. Push per `.claude/gates/pre-push.md` — including its step 1 rebase onto the parent
   branch. An open PR is exactly where the parent drifts: `main` moves while the run is
   red, and a fix pushed onto a stale base can go green locally and stay red in CI
   against the merged result. Rebasing rewrites the branch, so this push is
   `--force-with-lease`.

If a fix touched E2E-relevant code, validate narrowly — run only the affected specs
with `--grep`, once. Do not re-run the whole suite to check a narrow fix.

## Step 4 — PR review feedback

Fetch from **both** endpoints. The main review body is posted as an issue comment, so
checking only the pulls endpoint misses all the prose feedback:

```bash
gh api repos/rkseattle/minicrm/pulls/<pr>/comments    # inline diff comments
gh api repos/rkseattle/minicrm/issues/<pr>/comments   # top-level review body
```

Then, in this order:

1. **Fix the code first.** Never reply to a comment before the fix exists. Each fix
   goes through `ci-failure-adversary` the same way a CI failure does — root cause,
   pattern spread, then commit. Replying "good catch, filed as MINCRM-N" is a deferral:
   it needs the procedure in `deliver`'s invariants first — `commit-adversary` on the
   benign claim, then Rob's explicit agreement — before any ticket exists to cite.
2. **Reply to every inline thread**, naming what changed and in which commit:
   ```bash
   gh api repos/rkseattle/minicrm/pulls/<pr>/comments/<id>/replies \
     --method POST -f body="Fixed in commit <sha>. <one-line explanation>."
   ```
   Replies to Greptile comments start with `@greptile:` followed by a space.
3. **Top-level summary only if something is genuinely new** and not already covered by
   the inline replies. If every finding was handled inline, skip it — restating them
   wastes Rob's time.

Never run a fresh `/code-review` when asked to address existing feedback.

## Step 5 — Loop

Push, re-arm the monitor, stay silent. Repeat steps 2–4 until every check passes and no
comment is unaddressed. Then report: final check status, the commits added, and one
line per issue fixed with its root cause.
