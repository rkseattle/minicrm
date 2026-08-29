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

`acceptance_criteria` is copied from the plan's **Acceptance criteria coverage** table —
one entry per row, keeping that table's `AC<n>` IDs so the plan, the state file, and every
status report name the same criterion. Copy the rows; do not re-derive them from the
tickets, which would produce a second list free to drift from the one the plan was
approved against.

```json
"acceptance_criteria": [
  { "id": "AC1", "ticket": "MINCRM-N", "text": "<AC text>", "met": false, "evidence": "" }
]
```

If the field is absent — an older state file, or a plan predating this — rebuild it from
the plan's coverage table before the first phase report, assigning IDs in table order.
Do not paraphrase the text: an AC reworded into something easier to satisfy is how a run
reports green against criteria nobody agreed to. If the plan has no coverage table
either, say so in the report and ask rather than writing the criteria yourself.

Each phase gains four more fields as it runs — `started_at`, `finished_at`, `commit`,
and `files`. They are what step 2e reports from, and they exist so duration and file
lists are read back rather than recalled: a phase that spans a compaction boundary is
otherwise unreportable, and an estimated duration is worse than none. Write
`started_at` as the first action of each phase and the rest at its commit:

```json
{
  "name": "Phase 1 — <name>",
  "done": true,
  "started_at": "2026-08-29T15:12:04Z",
  "finished_at": "2026-08-29T15:53:41Z",
  "commit": "ab8c4cd",
  "files": ["client/src/components/UserMenu.tsx"]
}
```

Both timestamps come from `date -u '+%Y-%m-%dT%H:%M:%SZ'`, never from a timestamp in
context. `files` and `commit` come from `git show --stat --name-only` on the commit just
made — never from memory of what you edited, which misses files a lint autofix touched.

Set `"paused": true` before ending a turn deliberately, per `deliver`'s invariants, and
**remove it as the first action of the turn that resumes** — left set, it disables the
guard for every remaining phase.

If work is abandoned before `/ship-pr`, clear the state with
`find .claude/state -type f -delete`; an unfinished plan nobody is working on nags the
next session.

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

Record `started_at` for this phase in `.claude/state/current-plan.json` before the first
edit — `date -u '+%Y-%m-%dT%H:%M:%SZ'`.

While the phase runs, keep a note of anything that cost real time and was avoidable: a
gate that failed for a reason a rule could have prevented, an adversarial round spent on
something already written down somewhere, a convention discovered by being corrected
rather than by reading it. That is what 2e's Friction line reports, and noticing it
afterward does not work — by then the cost is invisible.

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
`.claude/state/current-plan.json` and fill in `finished_at`, `commit`, and `files` from
the commit just made. If the file is missing — a resumed session, or this skill re-entered
on an existing branch — rebuild it from the plan document's phase list, marking
`done: true` every phase whose commit is already on the branch, and backfill `commit` and
`files` from `git log`. Leave the timestamps of a rebuilt phase absent rather than
inventing them; report its duration as `unknown`.

Then update `acceptance_criteria`: set `met: true` on every AC this phase satisfied, and
put in `evidence` the specific thing that demonstrates it — a test name, a file and
symbol, a gate that now passes. An AC is met when something checkable shows it, not when
the code that ought to satisfy it exists. If nothing checkable exists yet, the AC stays
`false` and its evidence is what is still missing.

### 2e. Phase status report

Report before starting the next phase — every phase, including the last one, and
including a phase that changed one line. This is not a summary of the work; it is where
Rob sees where the run is, what it cost, and what to fix in the config. Then move
directly to the next phase without pausing for a reply.

Six parts, in this order:

**1. The heading** — `Phase <n> of <total> complete — <phase name>`.

**2. The phase table** — every phase in the plan, not just the finished ones, so
remaining work is visible without scrolling back:

```
| Phase | Status | Duration | Files |
|---|---|---|---|
| 1 UserMenu component | done | 18m | 4 |
| 2 Drop Profile nav link | done | 6m | 3 |
| 3 E2E specs | done | 41m | 7 |
| 4 User guide | pending | — | — |
| 5 Visual baselines | pending | — | — |
```

Duration is `finished_at - started_at`, rounded to the minute. It is wall-clock, so it
includes time spent waiting on a review round or a test run — that is the number worth
knowing. A phase whose timestamps are missing reports `unknown`, never an estimate.

**3. Files modified this phase** — the full list from `git show --stat --name-only
<commit>`, with the commit SHA. Not a count, not "and 4 others": the list is what makes a
wrong-file mistake visible while it is still one commit from the top. Group by workspace
when it runs past a dozen.

**4. Acceptance criteria** — every AC on the covered tickets, with its state after this
phase. All of them every time, not just the ones that moved:

```
| AC | Criterion | Met | Evidence |
|---|---|---|---|
| AC1 | Header shows one user menu | yes | UserMenu.test.tsx:renders trigger |
| AC2 | Profile Settings reachable from it | yes | nav.behaviors.ts:openUserMenu |
| AC3 | Keyboard-navigable per WCAG | no | no axe assertion yet — phase 3 |
```

`met` is `yes` only with evidence in the row. An AC that no phase has touched shows `no`
and says which phase is meant to cover it; an AC the plan does not cover anywhere is the
report's most useful output, so call it out explicitly rather than letting it sit
unremarked in the table — that is a plan gap, and it is cheapest to find now.

Never mark an AC met because the phase "addressed" it. The question is whether something
would fail if the behavior regressed.

**5. Gates** — one line naming what ran and what came back, with the counts read from the
result files. `commit-adversary` gets its round count and the verdict that ended it.

**6. Friction** — the one part that is not bookkeeping. What cost time in this phase that
a config change would have prevented, and the specific file the change belongs in:
`CLAUDE.md`, a gate, a stage skill, or a memory file. One or two lines. Write `none` when
the phase genuinely ran clean — an invented item is worse than an empty one, because a
list of real friction is only useful if everything on it is real.

The bar for a friction item is that it is **repeatable and preventable**. A gate that
failed on something no written rule covers qualifies; a typo does not. So does a rule
that exists but was not found from where you were reading — that is a cross-reference
problem and names its own fix.

Do not apply the fix now. Phase reports collect; step 3 proposes.

## Step 3 — Report

When all phases are committed, report:

1. **The cumulative phase table** — all phases `done`, with per-phase durations and the
   run total.
2. **The commit list** — one line each, SHA and subject.
3. **All files modified across the branch**, from `git diff --stat main...HEAD`, grouped
   by workspace. This is the last point before `/branch-review` where an unintended file
   is cheap to catch.
4. **Final acceptance criteria table** — every AC with its evidence. This is the
   handoff artifact: `/ship-pr` builds the PR body from it, and any AC still `no` must be
   stated as such before the branch review rather than discovered in it. All ACs met is a
   claim about the ticket being deliverable — make it explicitly, or say which are not.
5. **Process feedback** — every Friction item from every phase, deduplicated, each with
   the file it belongs in and the exact proposed wording. Then **stop and ask** before
   applying any of them. Do not edit `CLAUDE.md`, a gate, a skill, or a memory file on
   your own initiative here; the same reasoning as `deliver`'s rule on work items applies,
   and a config file that grows on every run stops being read. An item Rob declines is
   dropped, not re-proposed next run.

   Report `none` when no phase found friction. A run that genuinely went clean is a real
   outcome, and manufacturing an item to fill the section is how a config file
   accumulates rules nobody needed.

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
