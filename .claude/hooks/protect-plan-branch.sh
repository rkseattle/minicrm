#!/usr/bin/env bash
# PreToolUse(Bash) hook: refuse a command that would move HEAD off the branch an
# active plan is being delivered on.
#
# A review subagent shares the working tree with the session that spawned it. One
# `git checkout main` to "look at" a ref leaves the parent on the wrong branch, and its
# next commit lands somewhere nobody intended. That happened; this makes it impossible
# rather than discouraged.
#
# Decides from typed state only — the branch named in current-plan.json and the branch
# git reports — never from the prose of the command. Every error allows the command:
# a hook that blocks on its own bug is worse than no hook.
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "${1:-}" = "--self-test" ] && exec bash "$HOOK_DIR/protect-plan-branch.self-test.sh"

allow() { printf '{"continue": true}\n'; exit 0; }

command -v jq >/dev/null 2>&1 || allow

input=$(cat 2>/dev/null) || allow
[ -n "$input" ] || allow

cmd=$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null) || allow
[ -n "$cmd" ] || allow

root="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // "."' <<<"$input" 2>/dev/null)}"
state="$root/.claude/state/current-plan.json"

# No active plan means no branch to protect.
[ -f "$state" ] || allow

want_branch=$(jq -r '.branch // ""' "$state" 2>/dev/null) || allow
[ -n "$want_branch" ] || allow

# Only guard while that branch is the one checked out. A plan naming a branch nobody
# is on is abandoned work, and blocking there would strand the session.
current=$(git -C "$root" branch --show-current 2>/dev/null) || allow
[ "$current" = "$want_branch" ] || allow

# The decision itself is Python: it tokenizes the command with shlex instead of
# matching a regex against the raw string. Quoting was the entire difficulty here —
# `-c user.name="John Doe"`, `-c "user.name=John Doe"` and `-c 'user.name=John Doe'`
# are one command spelled three ways, and a regex needs a branch for each. Four
# separate bypasses were reported against the regex version, one per quoting form.
# After tokenizing they are the same token list and the whole class disappears.
command -v python3 >/dev/null 2>&1 || allow

# stderr is surfaced, not swallowed: a syntax error in branch_guard.py degrades this
# hook to allow-everything, and discarding the traceback makes that indistinguishable
# from a command the guard deliberately permitted.
err=$(mktemp) || allow
trap 'rm -f "$err"' EXIT
decision=$(printf '%s' "$input" | python3 "$HOOK_DIR/branch_guard.py" "$want_branch" 2>"$err") || {
  [ -s "$err" ] && sed 's/^/[branch-guard] /' "$err" >&2
  allow
}
[ -n "$decision" ] || allow
printf '%s\n' "$decision"
