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

# Commands that move HEAD or discard tracked state. `git checkout -- <path>` and
# `git restore <path>` are deliberately included: they revert files the plan is
# midway through editing.
if printf '%s' "$cmd" | grep -qE '(^|[;&|]|&&)[[:space:]]*git[[:space:]]+(checkout|switch|reset|clean|stash|worktree)([[:space:]]|$)'; then
  # An explicit switch back to the plan's own branch is the recovery path, not a
  # violation — a session that has already been moved must be able to return.
  if printf '%s' "$cmd" | grep -qE "git[[:space:]]+(checkout|switch)[[:space:]]+(-[[:alnum:]-]+[[:space:]]+)*${want_branch}([[:space:]]|$)"; then
    allow
  fi

  cat <<JSON
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Refused: this would move HEAD off '${want_branch}', the branch an active plan in .claude/state/current-plan.json is being delivered on. A subagent sharing this working tree has already stranded the parent session this way once.\n\nRead any ref without moving HEAD:\n  git show <ref>:<path>\n  git diff <base>...<branch>\n  git log <base>..<branch>\n  git grep <pattern> <ref> -- <path>\n\nIf you genuinely need to switch, clear or pause the plan state first."}}
JSON
  exit 0
fi

allow
