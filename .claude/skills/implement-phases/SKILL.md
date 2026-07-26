---
name: implement-phases
description: Execute an approved phased plan — create the branch, transition Jira to In Progress, then implement, adversarially review, and commit each phase in turn without pausing between them.
argument-hint: <path-to-plan.md>
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task
---

Implement the approved plan at: $ARGUMENTS

Requires an approved plan. If no plan has been approved in this session, stop and run
`/plan-work` instead.

## Step 1 — Set up once

```bash
git checkout main && git pull
git checkout -b <ticket-slug>
```

Branch from `main` unless instructed otherwise. Then transition every covered ticket to
**In Progress**. Look up the issue's available transitions via the Atlassian MCP
first and use the ID it returns — never guess one.

Read `.claude/gates/definition-of-done.md` now. It applies to every commit in this
skill and does not need re-reading between phases.

## Step 2 — Run all phases straight through

Once the plan is approved, run every phase to completion **without stopping to ask
whether to proceed to the next one**. The phased structure exists for commit
granularity and reviewability, not as approval gates. Report progress and blockers as
they occur and keep going.

Stop mid-plan only for a genuine decision: ambiguous scope the plan did not settle, a
judgment call with real tradeoffs, or a discovery that invalidates the plan. "Phase N
is done" is not such a decision.

For each phase:

### 2a. Implement

Industry-standard patterns only. Never the simplest, quickest, or easiest solution that
happens to work here. Where the repo has an established precedent, follow it; where you
depart from it, the departure must be justifiable to a reviewer who cannot ask you why.

While implementing, catch cross-cutting impact in the same pass rather than waiting for
runtime to surface it. Any time you rename a file, change a signature, change a script
name, change an entry point, or add or remove a dependency — grep for every dependent
and update it now. Watch specifically for `Dockerfile` `CMD`, CI workflow steps,
`package.json` scripts, `index.html` references, and type-only imports, all of which
have bitten this repo before.

When a grep reveals a class of problem rather than a single instance, fix every
instance in that pass. "Only these are failing CI" is not the same as "only these are
bugs." Exclude an instance only when it is genuinely exempt, and say why.

### 2b. Refactor before staging

Read the diff. Does any block of logic appear more than once — in this diff, or once
here and once already in the repo? Extract the helper first. Then stage.

### 2c. Adversarial review, before the commit

Launch the `commit-adversary` subagent.

**The delegation prompt contains only:** the git range (`git diff` against the previous
commit, or `--cached` for staged work), the covering ticket IDs, and nothing else. Do
not describe what you changed. Do not explain why. Do not tell it what to look for or
where you think the risk is. It reads the diff cold and derives its own context.

Fix every BLOCKER and MAJOR. Address PATTERN SPREAD findings in this same commit unless
they are genuinely out of scope, in which case say so explicitly and note them for the
branch review. Re-run the review on the fixed diff. Repeat to a maximum of three rounds;
if BLOCKERs persist after the third, stop and bring it to Rob.

### 2d. Definition of Done, then commit

Run every gate in `.claude/gates/definition-of-done.md`, including the conditional ones
that apply to this phase's diff. All green. Read result files, never exit codes.

Commit with the ticket ID in the message. Then move directly to the next phase.

## Step 3 — Report

When all phases are committed, report the commit list with one line each and hand off.
Do not push. Do not open a PR. `/ship-pr` covers that, after `/branch-review`.

## Standing rules

- Never dismiss a failing test as a known flake, pre-existing, or unrelated. Root-cause
  every failure. A rerun that passes is not a resolution.
- If Rob says something is broken, investigate before responding. Never lead with
  reassurance — his view of the browser and the UI is authoritative, tool output can be
  stale.
- Update `docs/user-guide/` and `docs/admin-guide.md` as part of the phase that changes
  behavior, not afterward. New pages need an `index.md` entry; feature flags need a
  callout block.
