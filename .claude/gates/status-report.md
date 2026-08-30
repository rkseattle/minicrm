# Status report — required at every phase and stage boundary

The human account of the delivery workflow is
[docs/dev/contributing.md](../../docs/dev/contributing.md). This file is the agent copy
of one part of it: the report format, which has no human equivalent.

Used by `implement-phases` step 2e at every phase boundary, and by `branch-review`,
`ship-pr`, and `ci-green` at every stage boundary, scaled to what that stage does — a
stage that fixes review findings still says which files it touched, how long it ran, and
which ACs it moved.

Report before starting the next phase — every phase, including the last one, and
including a phase that changed one line. This is not a summary of the work; it is where
Rob sees where the run is, what it cost, and what to fix in the config. Then move
directly on without pausing for a reply.

A boundary crossed without a report is the most common way a run becomes unreviewable:
the information exists only while the phase is fresh, and reconstructing it afterward
from `git log` loses the timing and the friction entirely.

Six parts, in this order.

## 1. The heading

`Phase <n> of <total> complete — <phase name>`.

## 2. The phase table

Every phase in the plan, not just the finished ones, so remaining work is visible
without scrolling back:

```
| Phase | Status | Duration | Files |
|---|---|---|---|
| 1 UserMenu component | done | 18m | 4 |
| 2 Drop Profile nav link | done | 6m | 3 |
| 3 E2E specs | done | 41m | 7 |
| 4 User guide | pending | — | — |
| 5 Visual baselines | pending | — | — |
```

Duration is `finished_at - started_at` from `.claude/state/current-plan.json`, rounded to
the minute — never an estimate. It is wall-clock, so it includes time spent waiting on a
review round or a test run; that is the number worth knowing. A phase whose timestamps are
missing reports `unknown`.

## 3. Files modified this phase

The full list from `git show --stat --name-only <commit>`, with the commit SHA — never
from memory of what you edited, which misses files a lint autofix or a regenerated
lockfile touched. Not a count, not "and 4 others": the list is what makes a wrong-file
mistake visible while it is still one commit from the top. Group by workspace when it
runs past a dozen.

## 4. Acceptance criteria

Every AC on the covered tickets, with its state after this phase. All of them every time,
not just the ones that moved:

```
| AC | Criterion | Met | Evidence |
|---|---|---|---|
| AC1 | Header shows one user menu | yes | UserMenu.test.tsx:renders trigger |
| AC2 | Profile Settings reachable from it | yes | nav.behaviors.ts:openUserMenu |
| AC3 | Keyboard-navigable per WCAG | no | no axe assertion yet — phase 3 |
```

`met` is `yes` only with evidence in the row, and the evidence must name something that
fails if the behavior regresses — code existing that ought to satisfy it is not evidence.
Never mark an AC met because the phase "addressed" it.

An AC that no phase has touched shows `no` and says which phase is meant to cover it. An
AC the plan does not cover anywhere is the report's most useful output: call it out
explicitly rather than letting it sit unremarked in the table. That is a plan gap, and it
is cheapest to find now.

## 5. Gates

One line naming what ran and what came back, with the counts read from the result files.
`commit-adversary` gets its round count and the verdict that ended it.

## 6. Friction

The one part that is not bookkeeping. What cost time in this phase that a config change
would have prevented, and the specific file the change belongs in: `CLAUDE.md`, a gate, a
stage skill, or a memory file. One or two lines.

The bar is **repeatable and preventable**. A gate that failed on something no written rule
covers qualifies; a typo does not. So does a rule that exists but was not found from where
you were reading — that is a cross-reference problem and names its own fix.

**A friction item names what it would replace, or states that it adds nothing.** The most
common resolution is not a new rule: it is moving an existing one to where you were
actually reading, narrowing one that fired wrongly, or deleting one that sent you the
wrong way. Those are the valuable items — they leave the corpus the same size or smaller.
An item proposing genuinely new text says what it displaces, per `deliver`'s line-budget
invariant.

Write `none` when the phase genuinely ran clean, and do not treat a clean phase as a
section you failed to fill. An item whose honest answer is "nothing to change, this was a
one-off" is not a friction item — an invented one is worse than an empty section, because
a list of real friction is only useful if everything on it is real.

Do not apply the fix now. Phase reports collect; `implement-phases` step 3 proposes, and
Rob decides.
