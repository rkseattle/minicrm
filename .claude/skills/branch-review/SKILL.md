---
name: branch-review
description: Run a cold, Greptile-style full review of every change on the current branch in an isolated subagent, then fix findings by root cause and propagate each fix pattern across the codebase.
argument-hint: [base-ref, defaults to main]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task
---

Full branch review. Base ref: $ARGUMENTS (default `main`).

Run this after every phase is committed and before `/ship-pr`.

Set `"stage": "branch-review"` in `.claude/state/current-plan.json` now, and update
`stage_step` on entering each step below. `/deliver`'s Step 0 resumes from those.

## Step 1 — Cold review

Launch the `greptile-reviewer` subagent.

**The delegation prompt contains only:** the branch name, the base ref, and the covering
ticket IDs. Nothing else — no summary of what the branch does, no note about which
phases were tricky, no "pay attention to X". The whole value of this pass is that the
reviewer has no implementation context. Anything you add erodes it.

## Step 2 — Fix by root cause, not by finding

For each BLOCKER and MAJOR, in order:

1. **Establish the root cause.** The reviewer names one; verify it against the code
   rather than accepting it. A finding is a symptom; the cause is what you fix.
2. **Grep for the same root cause across the whole repo** — not just the branch, not
   just the reported file. Same pattern, not same string. If the finding was a missing
   ownership clause, check every endpoint. If it was an unawaited promise on a write
   path, check every write service.
3. **Decide the scope of the fix.** Every live instance of the root cause gets fixed in
   this pass; excluding one requires `deliver`'s benign-in-context bar. State the
   exclusion in those terms or fix it.
4. **Fix using the industry-standard pattern**, matching in-repo precedent where one
   exists. Not the minimal edit that clears the finding.

MINOR findings: fix them. Defer only when the fix needs a decision you cannot make — a
product choice, a migration, a superseding ADR. Branch size is not such a decision: if
the branch has grown too large to review, that is a signal to have split it at plan time,
not a licence to leave a live defect in place now.

**Before deferring anything, and before creating any work item, follow the deferral
procedure in `deliver`'s invariants**: test the benign claim with `commit-adversary`
(refs only — file, line, root cause, your one-sentence claim), then ask Rob, then file.
Filing a ticket unprompted is the failure mode this guards against; it produces the
feeling of having handled the finding without handling it.

Work through findings in batches by root cause, not one commit per finding.

## Step 3 — Re-review

Once fixes are committed, re-run `greptile-reviewer` against the same base ref with the
same minimal prompt. Continue until the verdict is APPROVE, to a maximum of three
rounds. If it still requests changes after the third round, stop and bring the specific
disagreement to Rob rather than iterating further, declaring the stop per `deliver`'s
invariants.

**Check what each round is about before starting the next**, per `deliver`'s revert rule.
Findings against code a previous round wrote — rather than against the branch's own work —
mean that fix was the wrong shape. Revert it and take a different approach; a third round
will not converge on a design that should not exist. This is the failure mode that has cost
this repo the most: a branch whose feature landed in one commit and then spent seven more
rewriting a guard, each round closing a bypass the last one opened.

## Step 4 — Verify the acceptance criteria table

The reviewer returns an AC coverage table. Check each unmet or partially-met row
yourself against the ticket. Any AC not demonstrably satisfied by code plus a test is
not done, regardless of how the branch feels.

## Gates

Every fix commit in this skill still runs the full Definition of Done in
`.claude/gates/definition-of-done.md`, including its "Before `git add`" checks.
Nothing about being in review mode relaxes the commit gates.

## Report at the end of the stage

Same shape as a phase report: which findings were fixed and which were argued down, the
files each fix touched, how long the stage took, whether any finding moved an acceptance
criterion, and the friction worth writing into a config file.

A review finding that a written rule would have prevented is worth reporting — it was
caught late, by an agent, on work already committed. But check which of the two it is
before proposing anything: a finding no rule covers, or a finding a rule already covered
and the run did not follow. The second is far more common in this corpus, and its fix is
never new text. It is moving the existing rule to where the run was reading, or deleting a
competing copy that said something subtly different. Both of those shrink the corpus.

Propose new text only for the first kind, naming what it displaces per `deliver`'s
line-budget invariant. Do not propose a guard, hook, or check script here at all — that is
its own ticket under `deliver`'s enforcement-machinery invariant, never a branch-review
output.

## Validate before reporting

Do not report a fix as complete on reasoning alone. Run the verification — the failing
test, the endpoint via curl, `docker compose ps`, `docker compose logs <service>` —
and include the output. This has repeatedly been the difference between "fixed" and
"still broken when Rob tried it".
