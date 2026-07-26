---
name: deliver
description: End-to-end delivery of one or more Jira work items — plan, adversarial design review, approval gate, phased implementation with per-commit adversarial review, cold branch review, PR, and CI to green.
argument-hint: <MINCRM-N> [MINCRM-N ...]
disable-model-invocation: true
---

Deliver: $ARGUMENTS

You are the orchestrator. Each stage below is its own skill; invoke it via the Skill
tool **at the moment you reach that stage**, not up front. Loading them lazily keeps
each stage's instructions out of context until they are needed.

## Stages

1. **`/plan-work $ARGUMENTS`** — tickets, codebase survey, phased plan, adversarial
   design review, then present for approval.
   → **Hard stop.** Wait for explicit approval. A clarifying question is not approval.

2. **`/implement-phases <plan-path>`** — branch, Jira to In Progress, then every phase
   implemented, adversarially reviewed, and committed, straight through with no pause
   between phases.

3. **`/branch-review`** — cold Greptile-style review of the whole branch in an isolated
   subagent; fix by root cause and propagate each fix pattern across the codebase.

4. **`/ship-pr $ARGUMENTS`** — pre-push gate, E2E, clean tree, push, PR, Jira to
   In Review.

5. **`/ci-green`** — monitor CI and PR feedback; root-cause every failure in an
   isolated subagent; loop until fully green with no unaddressed comments.

Stages 2 through 5 run without further approval gates. Surface real decisions as they
arise; do not ask permission to continue.

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
Review after the PR opens. `jira_get_transitions` for the ID — never guess.

**Stay quiet while monitors run.** No filler turns, no polling loops, no narrating the
wait.
