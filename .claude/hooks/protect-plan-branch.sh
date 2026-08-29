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
# `git restore <path>` are included: they revert files the plan is midway through
# editing. Global options (-C, -c, --git-dir, --work-tree) may sit between `git` and
# the subcommand, so they are skipped rather than defeating the match. `stash list`
# and `stash show` are reads and stay allowed.
GIT_GLOBAL_OPTS='([[:space:]]+(-[cC][[:space:]]*[^[:space:]]+|--(git-dir|work-tree|namespace)(=[^[:space:]]+|[[:space:]]+[^[:space:]]+)))*'
DESTRUCTIVE="checkout|switch|restore|reset|clean|worktree|stash[[:space:]]+(push|pop|apply|drop|clear|branch|create|store)|stash([[:space:]]*$|[[:space:]]+-)"

DESTRUCTIVE_RE="(^|[^[:alnum:]_-])git${GIT_GLOBAL_OPTS}[[:space:]]+(${DESTRUCTIVE})"

# Match against executable text only. A commit message, a heredoc body, or any quoted
# string can legitimately contain the words "git checkout" — a guard that reads those
# as invocations blocks the commit that documents the guard, which is how this one
# first failed. Everything from a heredoc operator to end of input is dropped, as are
# single- and double-quoted runs.
scannable=$(printf '%s' "$cmd" \
  | sed -e 's/<<-\{0,1\}[[:space:]]*[A-Za-z_'"'"'"][A-Za-z0-9_]*.*$//' \
        -e "s/'[^']*'//g" \
        -e 's/"[^"]*"//g')
[ -n "$scannable" ] || allow

# Count destructive invocations, then count the subset that are a return to the plan's
# own branch — the recovery path a stranded session needs. Denying unless every one is
# a return means a compound cannot smuggle a checkout past the guard by also
# mentioning the branch somewhere.
destructive_count=$(printf '%s' "$scannable" | grep -oE "$DESTRUCTIVE_RE" | wc -l | tr -d ' ')
[ "$destructive_count" -eq 0 ] && allow

return_re="git${GIT_GLOBAL_OPTS}[[:space:]]+(checkout|switch)[[:space:]]+(-[[:alnum:]-]+[[:space:]]+)*${want_branch}([[:space:]]|$)"
return_count=$(printf '%s' "$scannable" | grep -oE "$return_re" | wc -l | tr -d ' ')

if [ "$destructive_count" -gt "$return_count" ]; then
  cat <<JSON
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Refused: this would move HEAD off '${want_branch}', the branch an active plan in .claude/state/current-plan.json is being delivered on. A subagent sharing this working tree has already stranded the parent session this way once.\n\nRead any ref without moving HEAD:\n  git show <ref>:<path>\n  git diff <base>...<branch>\n  git log <base>..<branch>\n  git grep <pattern> <ref> -- <path>\n\nIf you genuinely need to switch, clear or pause the plan state first."}}
JSON
  exit 0
fi

allow
