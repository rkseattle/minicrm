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

[ "${1:-}" = "--self-test" ] && exec bash "$(dirname "$0")/protect-plan-branch.self-test.sh"

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

# Commands that move HEAD or discard the working tree wholesale.
#
# Path-scoped reverts — `git checkout -- <path>`, `git restore <path>` — are NOT here.
# They cannot move HEAD, and restoring a file the tooling touched incidentally (a
# regenerated report, a screenshot whose only change is a relative timestamp) is
# routine work this guard has no business refusing. The scope is the branch, not
# every destructive-looking verb.
#
# Global options (-C, -c, --git-dir, --work-tree) may sit between `git` and the
# subcommand, so they are skipped rather than defeating the match. `stash list` and
# `stash show` are reads and stay allowed.
# A -C or --git-dir value may be quoted and hold spaces, so each alternative accepts a
# quoted run as well as a bare token — matching only bare tokens let
# `git -C "/some path" checkout main` slip past the subcommand entirely.
GIT_GLOBAL_OPTS='([[:space:]]+(-[cC][[:space:]]*("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)|--(git-dir|work-tree|namespace)(=|[[:space:]]+)("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)))*'
# A branch switch names a ref. `--` marks everything after it as paths, and a bare
# `-` means "the previous branch", which is still a switch.
BRANCH_SWITCH="(checkout|switch)([[:space:]]+-[[:alnum:]-]+)*[[:space:]]+(-([[:space:]]|$)|[^-[:space:]][^[:space:]]*)"
# `rebase` moves HEAD and rewrites the branch. `restore --source=<ref>` overwrites the
# working tree from another ref, which is the wholesale discard this guard covers even
# though plain path-scoped `restore` is not. `worktree list` and a bare `reset`
# (unstage only) move neither HEAD nor the tree, so both stay allowed.
DESTRUCTIVE="${BRANCH_SWITCH}|rebase|restore[^;|&]*--source|reset[[:space:]]+(--hard|--merge|--keep|[^-])|clean[[:space:]]+-|worktree[[:space:]]+(add|remove|move|prune)|stash[[:space:]]+(push|pop|apply|drop|clear|branch|create|store)|stash([[:space:]]*$|[[:space:]]+-)"

DESTRUCTIVE_RE="(^|[^[:alnum:]_-])git${GIT_GLOBAL_OPTS}[[:space:]]+(${DESTRUCTIVE})"

# Match against executable text only. A commit message, a heredoc body, or a grep
# pattern can legitimately contain the words "git checkout" — reading those as
# invocations blocked the commit that documented this guard.
#
# Only the ARGUMENT OF A MESSAGE-BEARING FLAG is removed, never quoting in general:
# stripping every quoted run also strips the branch argument, which let
# `git checkout "main"` through — the guard's defense against one failure mode
# opening a hole in the one it exists for.
scannable=$(printf '%s' "$cmd" \
  | sed -E \
      -e 's/<<-?[[:space:]]*['"'"'"]?[A-Za-z_][A-Za-z0-9_]*.*$//' \
      -e 's/(-m|-F|--message|--file)[[:space:]]*'"'"'[^'"'"']*'"'"'//g' \
      -e 's/(-m|-F|--message|--file)[[:space:]]*"[^"]*"//g' \
      -e 's/(grep|rg|ack)([[:space:]]+-[[:alnum:]-]+)*[[:space:]]+'"'"'[^'"'"']*'"'"'//g' \
      -e 's/(grep|rg|ack)([[:space:]]+-[[:alnum:]-]+)*[[:space:]]+"[^"]*"//g' \
      -e 's/(echo|printf)[[:space:]]+'"'"'[^'"'"']*'"'"'//g' \
      -e 's/(echo|printf)[[:space:]]+"[^"]*"//g' \
  | perl -pe '
      # Collapse spaces ONLY inside the value of a git global option that takes a path,
      # so `git -C "/some path" checkout main` keeps the subcommand adjacent and
      # matchable. Named explicitly rather than by shape: `-c` is sh/bash\x27s command
      # flag, and collapsing THAT value turns `sh -c "git checkout main"` into one
      # opaque token the matcher cannot see into.
      s/(-C[= ]?|--git-dir[= ]|--work-tree[= ])"([^"]*)"/my ($f,$v)=($1,$2); $v =~ s{ }{_}g; "$f$v"/ge;
      s/(-C[= ]?|--git-dir[= ]|--work-tree[= ])\x27([^\x27]*)\x27/my ($f,$v)=($1,$2); $v =~ s{ }{_}g; "$f$v"/ge;
      s/["\x27]//g;
    ')
[ -n "$scannable" ] || allow

# Count destructive invocations, then count the subset that are a return to the plan's
# own branch — the recovery path a stranded session needs. Denying unless every one is
# a return means a compound cannot smuggle a checkout past the guard by also
# mentioning the branch somewhere.
# `checkout --` / `restore --` scope to paths, so drop those invocations before
# counting: they cannot move HEAD, and the flags group would otherwise read the `--`
# as an option and the first path as a branch name.
scannable=$(printf '%s' "$scannable" \
  | sed -E 's/git[[:space:]]+(checkout|restore)[[:space:]]+--[[:space:]]+[^;|&]*//g')

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
