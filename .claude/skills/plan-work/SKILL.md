---
name: plan-work
description: Research Jira work items and the codebase, produce a phased implementation plan, have it adversarially reviewed, and present it for approval. Produces no code.
argument-hint: <MINCRM-N ...> or <pr-group-label>
disable-model-invocation: true
allowed-tools: Read, Write, Grep, Glob, Bash, Task, WebSearch, WebFetch
---

Plan the work for: $ARGUMENTS

This skill produces a plan and stops. **No file in the repo is created, edited, or
staged during this skill**, other than the plan document itself. No branch, no Jira
transition, no commit. The approval gate at the end is real.

## Step 1 — Resolve the arguments to a ticket set

$ARGUMENTS may be ticket IDs, a PR-group label, or a mix. Resolve before fetching.

**Matches `MINCRM-\d+`** → a ticket ID. Use directly.

**Anything else** → treat as a PR-group label (`iam-pr-03`, `ai-pr-14`,
`pr-tia-9-platform-governance`). Resolve it:

```
project = MINCRM AND labels = "<label>" ORDER BY created ASC
```

**If that returns nothing, do not conclude the label is unused.** In this Jira, `~` is
fuzzy text matching against a text index, not glob — `labels ~ "iam-pr*"` will not
match `iam-pr-03`. An empty exact match almost always means the slug you were given is
a prefix or fragment of the real label. Recover by widening, not by giving up:

1. `project = MINCRM AND labels ~ "<distinctive-fragment>"` — a single word from the
   middle of the slug works better than the leading token
2. If still empty, list broadly — `project = MINCRM ORDER BY created DESC` — and read
   the actual label strings off recent issues
3. Re-run the exact `labels = "<full-slug>"` match once you have the real string

Report the resolved label if it differed from what you were given.

**Then, before going further:**

- Report the resolved ticket set — IDs and summaries — so the scope is visible.
- **If a label resolves to more than 3 items, stop and flag it.** The working limit for
  a single handoff is 3; a larger group should be split into separate PR groups before
  planning, not planned as one unit. Propose a split and wait.
- Order the set by the label's implied sequence. PR-group labels in this project are
  numbered to match expected implementation order, so `iam-pr-02` precedes `iam-pr-03`
  and that ordering is meaningful for phase sequencing.

## Step 2 — Fetch the tickets, sequentially

Fetch each resolved ticket and read the full description and acceptance criteria
**before launching anything else**. Do not parallelize the fetch with exploration. The
session context contains recent git commits, and launching an exploration agent before
the ticket content is known anchors it on the wrong domain — this has happened.

Read linked and blocking tickets too. Cross-story dependencies in this project are
documented in prose inside issue descriptions rather than via Jira issue links, so read
the descriptions for sequencing constraints rather than relying on link metadata.

## Step 3 — Explore the codebase

Now, and only now, survey the code. Delegate breadth to `Explore` subagents so the
survey does not consume the main context; run several in parallel across distinct
questions. Give each one ticket-derived scope, not commit-derived scope.

Establish:

- Where the affected domain currently lives — routes, controllers, services, client
  API modules, page objects, behaviors, specs
- The established in-repo pattern for the thing being built. If the repo already solves
  this problem somewhere, the plan follows that solution.
- Blast radius: every caller, import, config key, script, Dockerfile line, and CI step
  that references what will change
- Existing test coverage and where new coverage lands
- Relevant ADRs under `docs/adr/` and dev docs under `docs/dev/`

Read the actual code. Do not plan from file names.

## Step 4 — Write the plan

Write it to `docs/plans/<primary-ticket>.md`. This is the one file this skill creates,
and it is not source code. (Kept out of `.claude/plans/`, which Claude Code uses for
its own plan-mode artifacts.)

Structure:

```markdown
# <MINCRM-N ...> — <title>

## Scope

What ships. What explicitly does not.
Covering tickets, and the PR-group label if the work was resolved from one.

## Acceptance criteria coverage

| Ticket | AC | Phase |

## Approach

The chosen approach, and why it is the industry-standard one for this problem —
name the pattern (optimistic locking, outbox, capability check at the boundary,
whatever applies). Where an in-repo precedent exists, cite it as `file:line`.
Where this departs from precedent, say so and justify it.

## Rejected alternatives

Each with the reason it loses. If the simplest approach is rejected, say why.

## Phases

### Phase N — <name>

- Files touched
- Change summary
- Tests added or updated
- Commit message
  Each phase must be independently committable and leave the branch coherent.

## Risks and open questions
```

Rules the plan must respect: services own all DB access; controllers shape only; Zod at
the boundary; audit entry in the same transaction on the same client; automation
triggers and assignment notifications fired after commit and never awaited; ownership in
the WHERE clause on PATCH/DELETE; ORDER BY allowlist; explicit PG error mapping;
varchar + CHECK over new enums; corrective migrations only, each with a real `down`.

Never the simplest, quickest, or easiest solution. If you catch yourself writing "wait",
"actually", or "let me look at this differently" more than once, stop and think it
through rather than iterating in the open.

**Scope exclusions are decided here, with Rob, not later on your own.** If exploration
finds instances of a root cause the plan otherwise fixes, the plan's "What explicitly
does not ship" must list each one and justify it as **benign in context** — it cannot
produce a wrong result for any user or any test. A different feature, page, or workspace
is not a justification. `design-adversary` will evaluate each exclusion on that bar.

This is the right moment to split work: if covering every instance would make one branch
too large to review, propose sequenced tickets in the plan and let Rob choose. Do not
create those tickets yet — deciding mid-implementation to file a follow-up instead of
fixing is the failure this exists to prevent.

## Step 5 — Adversarial design review

Launch the `design-adversary` subagent.

**The delegation prompt contains only:** the path to the plan file, and the ticket IDs.
Nothing about why you chose the approach, nothing you learned during exploration,
nothing about what you expect it to find. It reviews the plan as written, cold.

Fix every BLOCKER and MAJOR in the plan, then re-run the review on the revised plan.
Repeat until it returns no BLOCKERs, to a maximum of three rounds. If it still returns
BLOCKERs after the third round, stop and bring the disagreement to Rob rather than
continuing to iterate.

## Step 6 — Present for approval

Present in chat, concisely:

- The resolved ticket set, and the label it came from if applicable
- The phase list with one line each
- The approach and its justification, with the in-repo precedent cited
- What the adversarial review found and what changed as a result
- Open questions needing a decision

Then stop and wait. Do not begin implementation, do not create the branch, do not
transition Jira. Approval is an explicit "approved", "do it", or equivalent — a
clarifying question is not approval.
