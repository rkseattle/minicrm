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

Then write the phase list to `.claude/state/current-plan.json`, which is what the `Stop`
hook reads to tell an unfinished plan from a finished one.

```json
{
  "branch": "<ticket-slug>",
  "plan": "docs/plans/<primary-ticket>.md",
  "tickets": ["MINCRM-N"],
  "phases": [{ "name": "Phase 1 — <name>", "done": false }]
}
```

One entry per phase in the approved plan, all `done: false`. `branch` is the branch just
created: the hook ignores a state file naming a branch that is not checked out, so
abandoned work stops nagging once you switch away from it. `plan` and `tickets` are
provenance for a human reading the file.

Set `"paused": true` before ending a turn deliberately, per `deliver`'s invariants, and
**remove it as the first action of the turn that resumes** — left set, it disables the
guard for every remaining phase.

If work is abandoned before `/ship-pr`, delete `.claude/state/current-plan.json` and
`.claude/state/blocked-*`; an unfinished plan nobody is working on nags the next session.

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
depart from it, put the reason in the commit message — that is where a reviewer looks for
why a change was made, and it does not go stale the way an inline defense does.

While implementing, catch cross-cutting impact in the same pass rather than waiting for
runtime to surface it. Any time you rename a file, change a signature, change a script
name, change an entry point, or add or remove a dependency — grep for every dependent
and update it now. Watch specifically for `Dockerfile` `CMD`, CI workflow steps,
`package.json` scripts, `index.html` references, and type-only imports, all of which
have bitten this repo before.

When a grep reveals a class of problem rather than a single instance, fix every
instance in that pass. "Only these are failing CI" is not the same as "only these are
bugs." Exclude an instance only when it is **benign in its context** — it cannot produce
a wrong result for any user or any test. A different feature, workspace, or ticket owner
is not benign. Before deferring, and before creating any work item, follow the deferral
procedure in `deliver`'s invariants: `commit-adversary` on the benign claim, then ask
Rob, then file.

### 2b. Read the diff before staging

Run the "Before `git add`" checks in `.claude/gates/definition-of-done.md` — extract
duplicated logic, and cut comments that restate the code or narrate history. Then stage.

### 2c. Adversarial review, before the commit

Launch the `commit-adversary` subagent.

**The delegation prompt contains only:** the git range (`git diff` against the previous
commit, or `--cached` for staged work), the covering ticket IDs, and nothing else. Do
not describe what you changed. Do not explain why. Do not tell it what to look for or
where you think the risk is. It reads the diff cold and derives its own context.

Fix every BLOCKER and MAJOR. Address PATTERN SPREAD findings in this same commit unless
they are genuinely out of scope, in which case say so explicitly and note them for the
branch review. Re-run the review on the fixed diff. Repeat to a maximum of three rounds;
if BLOCKERs persist after the third, stop and bring it to Rob, declaring the stop per
`deliver`'s invariants.

### 2d. Definition of Done, then commit

Run every gate in `.claude/gates/definition-of-done.md`, including the conditional ones
that apply to this phase's diff. All green. Read result files, never exit codes.

Commit with the ticket ID in the message, then mark this phase `"done": true` in
`.claude/state/current-plan.json`. If the file is missing — a resumed session, or this
skill re-entered on an existing branch — rebuild it from the plan document's phase list,
marking `done: true` every phase whose commit is already on the branch. Then move directly
to the next phase.

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
