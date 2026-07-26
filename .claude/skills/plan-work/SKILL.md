---
name: plan-work
description: Research Jira work items and the codebase, produce a phased implementation plan, have it adversarially reviewed, and present it for approval. Produces no code.
argument-hint: <MINCRM-N> [MINCRM-N ...]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Task, WebSearch, WebFetch
---

Plan the work for: $ARGUMENTS

This skill produces a plan and stops. **No file in the repo is created, edited, or
staged during this skill.** No branch, no Jira transition, no commit. The approval gate
at the end is real.

## Step 1 — Fetch the tickets first, sequentially

Fetch each ticket in $ARGUMENTS and read the full description and acceptance criteria
**before launching anything else**. Do not parallelize the fetch with exploration. The
session context contains recent git commits, and launching an exploration agent before
the ticket content is known anchors it on the wrong domain — this has happened.

Read linked and blocking tickets too. Cross-story dependencies in this project are
documented in prose inside issue descriptions rather than via Jira issue links, so read
the descriptions for sequencing constraints rather than relying on link metadata.

## Step 2 — Explore the codebase

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

## Step 3 — Write the plan

Write it to `docs/plans/<primary-ticket>.md`. This is the one file this skill creates,
and it is not source code. (Kept out of `.claude/plans/`, which Claude Code uses for
its own plan-mode artifacts.)

Structure:

```markdown
# <MINCRM-N ...> — <title>

## Scope

What ships. What explicitly does not.

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

## Step 4 — Adversarial design review

Launch the `design-adversary` subagent.

**The delegation prompt contains only:** the path to the plan file, and the ticket IDs.
Nothing about why you chose the approach, nothing you learned during exploration,
nothing about what you expect it to find. It reviews the plan as written, cold.

Fix every BLOCKER and MAJOR in the plan, then re-run the review on the revised plan.
Repeat until it returns no BLOCKERs, to a maximum of three rounds. If it still returns
BLOCKERs after the third round, stop and bring the disagreement to Rob rather than
continuing to iterate.

## Step 5 — Present for approval

Present in chat, concisely:

- The phase list with one line each
- The approach and its justification, with the in-repo precedent cited
- What the adversarial review found and what changed as a result
- Open questions needing a decision

Then stop and wait. Do not begin implementation, do not create the branch, do not
transition Jira. Approval is an explicit "approved", "do it", or equivalent — a
clarifying question is not approval.
