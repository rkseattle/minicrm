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
and `files`. They are what the status report reads from, and they exist so duration and file
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
rather than by reading it. That is what the report's Friction line covers, and noticing it
afterward does not work — by then the cost is invisible.

Industry-standard patterns only, per `deliver`'s invariant. Put the reason for any
departure from in-repo precedent in the commit message — that is where a reviewer looks,
and it does not go stale the way an inline defense does.

While implementing, catch cross-cutting impact in the same pass rather than waiting for
runtime to surface it. Any time you rename a file, change a signature, change a script
name, change an entry point, or add or remove a dependency — grep for every dependent
and update it now. Watch specifically for `Dockerfile` `CMD`, CI workflow steps,
`package.json` scripts, `index.html` references, and type-only imports, all of which
have bitten this repo before.

When a grep reveals a class of problem rather than a single instance, fix every
instance in that pass. "Only these are failing CI" is not the same as "only these are
bugs." Excluding an instance, deferring anything, or creating any work item all go
through `deliver`'s benign-in-context bar and deferral procedure.

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

Before round 3, apply `deliver`'s revert rule: if round 2's findings were mostly against
what round 1's fix introduced rather than against the phase's own code, revert that fix and
take a different approach instead of running a third round. Do not build a guard to satisfy
a finding here — `deliver`'s enforcement-machinery invariant makes that a separate ticket.

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

Report before starting the next phase, then move directly to the next one without
pausing for a reply. The format — heading, phase table, files, acceptance criteria,
gates, friction — is `.claude/gates/status-report.md`. Read it once per session.

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

- Never dismiss a failing test as a known flake. Policy: `.claude/gates/e2e-run.md`.
- If Rob says something is broken, investigate before responding. Never lead with
  reassurance — his view of the browser and the UI is authoritative, tool output can be
  stale.
- Update `docs/user-guide/` and `docs/admin-guide.md` as part of the phase that changes
  behavior, not afterward. New pages need an `index.md` entry; feature flags need a
  callout block.
