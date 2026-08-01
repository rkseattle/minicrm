---
name: branch-review
description: Run a cold, Greptile-style full review of every change on the current branch in an isolated subagent, then fix findings by root cause and propagate each fix pattern across the codebase.
argument-hint: [base-ref, defaults to main]
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task
---

Full branch review. Base ref: $ARGUMENTS (default `main`).

Run this after every phase is committed and before `/ship-pr`.

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
   this pass. An instance is excluded only when it is **benign in its context** — it
   cannot produce a wrong result for any user or any test. "Different feature",
   "different workspace", "big diff", "deserves its own review surface" are not benign;
   they describe every pattern-spread fix. State the exclusion in benign terms or fix it.
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
disagreement to Rob rather than iterating further.

## Step 4 — Verify the acceptance criteria table

The reviewer returns an AC coverage table. Check each unmet or partially-met row
yourself against the ticket. Any AC not demonstrably satisfied by code plus a test is
not done, regardless of how the branch feels.

## Gates

Every fix commit in this skill still runs the full Definition of Done in
`.claude/gates/definition-of-done.md`. Refactor duplicated logic before staging.
Nothing about being in review mode relaxes the commit gates.

## Validate before reporting

Do not report a fix as complete on reasoning alone. Run the verification — the failing
test, the endpoint via curl, `docker compose ps`, `docker compose logs <service>` —
and include the output. This has repeatedly been the difference between "fixed" and
"still broken when Rob tried it".
