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

**Industry-standard patterns only.** Never the simplest, quickest, or easiest solution.
Follow in-repo precedent where it exists; justify every departure in writing.

**Root cause, then pattern spread.** Every fix — plan finding, review finding, test
failure, CI failure, PR comment — gets root-caused, and the codebase gets grepped for
other instances of that same cause. Fix all live instances in the same pass.

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

**No failure is ever a known flake.** Not pre-existing, not unrelated, not flaky. A
rerun that passes is not a resolution. If the root cause is undeterminable, say so and
ask.

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
`implement-phases` step 2e defines the format; stages 3 through 5 report the same things
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

**Stay quiet while monitors run.** No filler turns, no polling loops, no narrating the
wait.

**Declare a deliberate stop.** Any stage may end a turn to ask Rob something — a genuine
decision, a deferral, persistent BLOCKERs, an ambiguous E2E scope. Whenever that happens
with phases still unfinished, set `"paused": true` in `.claude/state/current-plan.json`
first, and clear it as the first action of the turn that resumes. The `Stop` hook cannot
tell a question from a stall, by design: distinguishing them would mean classifying
prose. Declaring the stop is what separates them.

## If a stage file is missing or unreadable

Stop and say which one. Do not reconstruct the procedure from memory — the gates and
review protocols are the point of the workflow.
