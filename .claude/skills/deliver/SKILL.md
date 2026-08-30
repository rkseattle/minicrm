---
name: deliver
description: End-to-end delivery of one or more Jira work items — plan, adversarial design review, approval gate, phased implementation with per-commit adversarial review, cold branch review, PR, and CI to green.
argument-hint: <MINCRM-N> [MINCRM-N ...]
disable-model-invocation: true
---

Deliver: $ARGUMENTS

You are the orchestrator. Each stage is defined in its own file under
`.claude/skills/`. Those files carry `disable-model-invocation: true` because they
create branches, transition Jira, push, and open PRs — they must not fire on their own.
So **do not call them with the Skill tool; it will be blocked.**

Instead, at the moment you reach each stage, **read that stage's `SKILL.md` with the
Read tool and follow it in full as written.** Read it when you get there, not up front —
that keeps each stage's instructions out of context until they are needed.

Ignore the `argument-hint`, `allowed-tools`, and `disable-model-invocation` fields in
those files when read this way; they apply only to direct slash-command invocation. The
body is the procedure.

## Stages

1. **`.claude/skills/plan-work/SKILL.md`** — substitute $ARGUMENTS for the ticket IDs.
   Tickets, codebase survey, phased plan, adversarial design review, then present for
   approval.
   → **Hard stop.** Wait for explicit approval. A clarifying question is not approval.

2. **`.claude/skills/implement-phases/SKILL.md`** — substitute the path of the plan file
   written in stage 1. Branch, Jira to In Progress, then every phase implemented,
   adversarially reviewed, and committed, straight through with no pause between phases.

3. **`.claude/skills/branch-review/SKILL.md`** — base ref `main`. Cold Greptile-style
   review of the whole branch in an isolated subagent; fix by root cause and propagate
   each fix pattern across the codebase.

4. **`.claude/skills/ship-pr/SKILL.md`** — substitute $ARGUMENTS for the ticket IDs.
   Pre-push gate, E2E, clean tree, push, PR, Jira to In Review.

5. **`.claude/skills/ci-green/SKILL.md`** — the PR opened in stage 4. Monitor CI and PR
   feedback; root-cause every failure in an isolated subagent; loop until fully green
   with no unaddressed comments.

Stages 2 through 5 run without further approval gates. Surface real decisions as they
arise; do not ask permission to continue.

Rob can also run any stage on its own as a slash command — `/ci-green` in particular
gets re-run far more often than the full chain. If he has already run a stage manually
in this session, pick up from the next one rather than repeating it.

## Invariants across every stage

**Adversarial reviews stay blind.** Every delegation to `design-adversary`,
`commit-adversary`, `greptile-reviewer`, or `ci-failure-adversary` carries only refs —
a file path, a git range, a branch name, ticket IDs, failure evidence. Never your
reasoning, never a summary of what you changed, never a hint about where the risk is.
Their entire value is having no implementation context; anything you add spends it.
Cap every review loop at three rounds, then escalate the disagreement to Rob.

**A round that finds defects in the previous round's fix means revert, not iterate.** The
three-round cap counts rounds; it does not notice what they are about. Before starting any
round after the first, ask what the last round's findings were against: the code the branch
set out to change, or the code the previous round wrote to satisfy a finding. When it is
predominantly the latter, stop. Revert that fix and take a different approach — or bring
the disagreement to Rob if no other approach is apparent.

Two consecutive rounds finding defects in each other's output is not convergence, and a
third round will not reach it. It means the fix is the wrong shape: the reviewer is
exploring a design that should not exist rather than a defect that should be gone. Each
further round adds surface for the next one to find, which is why these loops end at the
cap rather than at APPROVE.

**Industry-standard patterns only.** Never the simplest, quickest, or easiest solution.
Follow in-repo precedent where it exists; justify every departure in writing.

**Root cause, then pattern spread.** Every fix — plan finding, review finding, test
failure, CI failure, PR comment — gets root-caused, and the codebase gets grepped for
other instances of that same cause. Fix all live instances in the same pass.

**Enforcement machinery is never built inside a feature branch.** Fixing an instance is
this branch's job; building the guard that would catch the next one is not. If a finding
argues for new machinery — a hook, a check script, a CI job or filter, a lint rule, a
self-test harness — fix the instance and every live instance of its root cause, then
propose the guard to Rob as its own ticket. Do not build it here.

The reason is measured, not theoretical. A guard written under review pressure is written
without a plan and without a design review, and then the review rounds turn on the guard:
MINCRM-734 shipped its feature in one commit and spent seven more rewriting a branch guard
four times, each round closing a bypass the previous round opened. The Stop hook reached
503 lines across nine rounds the same way. Both were built mid-branch to prevent something
cheaper than what they cost.

This binds regardless of how small the guard looks or how confident the finding is. "It's
twenty lines" is how both of those started. A guard is a program with its own failure
modes, and its only failure mode is silence — which is exactly what a rushed one produces.

**And a guard usually drags `ci.yml` with it, which costs the full E2E suite.** Every
`.github/workflows/**` edit widens TIA selection to everything; 93 such edits have left
that file at 3,499 lines with 16 single-purpose filter outputs. When a guard does earn its
own ticket, the plan must reach an existing filter rather than adding one — the ordered
list is in `.claude/gates/definition-of-done.md` under "Do not edit `ci.yml`".

**Fixing is the default; deferring is the exception that needs permission.** An instance
of a root cause this work already fixes is excluded only when it is **benign in its
context** — it cannot produce a wrong result for any user or any test. "It's a different
feature", "it's a different workspace", "it's a big diff", "it deserves its own review
surface" are _not_ benign — they describe every pattern-spread fix ever made. State the
exclusion in benign terms or fix it.

**Never create a Jira work item without asking first.** Filing a ticket feels like
handling the problem and is not; a ticket you file when you could have fixed the thing is
deferral with extra steps. Before creating any issue, follow this order:

1. **Test the deferral adversarially.** Launch `commit-adversary` with only: the file and
   line, the root cause, and your one-sentence benign claim. No branch context, no
   rationale, no mention that you would rather not do the work. If it disagrees, fix the
   instance and do not file anything.
2. **If it agrees, ask Rob** — the finding, why it is benign, the cost of fixing it now
   versus later, and your recommendation. Wait for an explicit answer.
3. **Only then create the ticket**, with Acceptance Criteria per CLAUDE.md.

This applies to every stage and to tickets of any kind — follow-ups, spin-offs, "while we
were in there" observations. Recording a finding in the PR body or in chat needs no
permission; creating a work item does.

**Deleting or closing someone else's work item needs permission too**, and for the
opposite reason: it is not reversible from here, and a ticket you delete is a decision
someone else can no longer see. Ask, and say what happens to the work it tracked. Moving
a ticket through its normal workflow states — In Progress, In Review — is a routine step
and needs no permission.

**No failure is ever a known flake.** Full policy, including what does not count as a
failure at all: `.claude/gates/e2e-run.md`.

**Gates are unconditional.** Definition of Done before every commit
(`.claude/gates/definition-of-done.md`). Pre-push checklist and E2E before every push
(`.claude/gates/pre-push.md`, `.claude/gates/e2e-run.md`). Read result files, never
exit codes or console output.

**Jira transitions are real steps.** In Progress before the first line of code, In
Review after the PR opens. Look up the issue's available transitions via the
Atlassian MCP first — never guess a transition ID.

**Report full status at every phase and stage boundary.** Finishing a phase or a stage
is never just a line saying it is done. The report carries: which phases are complete and
which remain, the files each one modified, how long each took, the acceptance criteria met
so far with the evidence for each, and the friction worth fixing in these config files.
`.claude/gates/status-report.md` defines the format; stages 3 through 5 report the same things
scaled to what they do — a stage that fixes review findings still says which files
it touched, how long it ran, and which ACs it moved. A boundary crossed without a status
report is the single most common way a run becomes unreviewable: the information exists
only while the phase is fresh, and reconstructing it afterward from `git log` loses the
timing and the friction entirely.

**Process feedback is proposed, never applied on your own initiative.** Friction collected
during a run is reported at the end with the file and the exact wording it would need —
then you stop and ask. The reasoning is the same as for work items: a config file that
grows unprompted stops being read, and these files only work because everything in them
earned its place. `none` is a valid and common finding.

**These files have a line budget, and it is already spent.** Every run is asked for
friction and no run is asked what to remove, so the corpus ratchets in one direction —
which is why it now stands at ~2,900 lines that are read on every run. Each file has a cap:

| File                          | Cap |
| ----------------------------- | --- |
| `CLAUDE.md`                   | 400 |
| `gates/pre-push.md`           | 360 |
| `gates/e2e-run.md`            | 280 |
| `gates/definition-of-done.md` | 275 |
| `gates/status-report.md`      | 130 |
| Any skill `SKILL.md`          | 300 |
| Any agent definition          | 130 |

The caps sit just above today's sizes deliberately: the next addition to a near-full file
has to displace something. **A proposal that would breach a cap must name what comes out**
— the rule it replaces, narrows, or makes redundant — and that removal is part of the same
proposal, not a follow-up. If nothing can come out, the proposal is that the rule matters
more than what is already there; say so and let Rob weigh them against each other.

Prefer replacing to appending in every case, cap or no cap. A new rule covering the same
ground as an existing one produces two rules that drift, and the drift is invisible until
a run follows the stale one. Raising a cap is a decision for Rob, and it is the answer only
when the file genuinely covers more ground than it used to.

**Stay quiet while monitors run.** No filler turns, no polling loops, no narrating the
wait.

**Reversibility decides whether to ask, not phrasing.** A message ending in a question
mark is not automatically a discussion, and one phrased as an instruction is not
automatically licence for an irreversible act. Ask what the work would actually do:

- **Cheap to undo — act, and say what you did.** A local edit, a new file, a scratch
  script, an uncommitted experiment. `git checkout` reverses all of it in seconds, so
  answering the question _and_ doing the work costs one round trip instead of two. A
  question about the repo usually wants the answer demonstrated, not described.
- **Costly or impossible to undo — stop and ask.** A push, a force-push, a PR, a Jira
  write, a deleted branch, a destructive DB command, anything reaching a system outside
  this checkout. These stop even when the message reads as an instruction, because the
  cost of being wrong is not symmetrical with the cost of asking.

The middle case — a commit — follows the work: commit freely on a feature branch, ask
before committing to `main`.

**Prefer a stated assumption to a blocking question.** When a choice has an obvious
default and the resulting work is cheap to redo, take the default, say in one line which
assumption you made, and keep going. A correction then costs an amend rather than a
round trip. Reserve a blocking question — ending the turn with nothing delivered — for
when proceeding wrongly would be unsafe, would be expensive to unwind, or would waste
substantial work if the guess is wrong.

Do everything that does not depend on the answer first. A question that blocks one phase
rarely blocks all of them, and arriving with four phases done and one question is a far
better turn than arriving with the question alone.

**Batch open decisions into one turn.** When several genuinely need Rob, ask them
together — one `AskUserQuestion` with every open choice, each carrying a recommendation
and its consequence — rather than serializing them across turns. Two questions asked
separately cost two round trips and make a run look stalled twice.

**Declare a deliberate stop.** Any stage may end a turn to ask Rob something — a genuine
decision, a deferral, persistent BLOCKERs, an ambiguous E2E scope. Whenever that happens
with phases still unfinished, set `"paused": true` in `.claude/state/current-plan.json`
first, and clear it as the first action of the turn that resumes. The `Stop` hook cannot
tell a question from a stall, by design: distinguishing them would mean classifying
prose. Declaring the stop is what separates them.

That hook only guards stops _inside_ a plan, and most turns are not inside one — 70
invocations, zero blocks, across the sessions it has been live. So it is a backstop for a
control that has to be behavioral: nothing catches a false pause taken outside a plan
except not taking it. A sentence naming the next action is never the last thing in a
turn — either its tool call goes in the same message, or the sentence is not written.

## If a stage file is missing or unreadable

Stop and say which one. Do not reconstruct the procedure from memory — the gates and
review protocols are the point of the workflow.
