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

**Stay quiet while monitors run.** No filler turns, no polling loops, no narrating the
wait.

## If a stage file is missing or unreadable

Stop and say which one. Do not reconstruct the procedure from memory — the gates and
review protocols are the point of the workflow.
