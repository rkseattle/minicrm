#!/usr/bin/env bash
# Self-test for protect-plan-branch.sh.
#
# Asserts per-case verdicts, not exit status: the hook exits 0 on every path by design,
# so an exit-code assertion would pass against a hook that allows everything. Each case
# names the verdict it must produce, and the must-ALLOW cases are the ones that catch a
# guard grown so broad it strands the session.
set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/protect-plan-branch.sh"
pass=0
fail=0

# Isolated repo so the test never depends on, or touches, the real one.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" config user.email t@example.com
git -C "$tmp" config user.name t
echo x > "$tmp/f"
git -C "$tmp" add f
git -C "$tmp" commit -qm init
git -C "$tmp" checkout -qb feature-branch
mkdir -p "$tmp/.claude/state"

write_state() { printf '{"branch": "%s", "phases": []}\n' "$1" > "$tmp/.claude/state/current-plan.json"; }

# verdict <expected: deny|allow> <command> <description>
verdict() {
  local want="$1" cmd="$2" desc="$3"
  local out got
  out=$(printf '{"cwd":"%s","tool_input":{"command":%s}}' "$tmp" "$(jq -Rn --arg c "$cmd" '$c')" \
        | CLAUDE_PROJECT_DIR="$tmp" bash "$HOOK" 2>/dev/null)
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then got=deny; else got=allow; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "  FAIL [$desc] wanted=$want got=$got"
    echo "       cmd: $cmd"
  fi
}

echo "== plan names the checked-out branch: moving HEAD must be denied =="
write_state feature-branch
verdict deny "git checkout main"                       "checkout another branch"
verdict deny "git switch main"                         "switch another branch"
verdict deny "cd /repo && git checkout main"           "checkout after a chained cd"
verdict deny "git stash"                               "stash"
verdict deny "git reset --hard origin/main"            "hard reset"
verdict deny "git clean -fd"                           "clean"
verdict deny "git worktree add ../wt main"             "worktree add"
verdict deny "git checkout -- client/src/app.tsx"      "discard a tracked file"

echo "== the same state: reading a ref must still be allowed =="
verdict allow "git diff main...feature-branch"         "diff two refs"
verdict allow "git show main:client/src/app.tsx"       "show a file at a ref"
verdict allow "git log main..feature-branch --oneline" "log a range"
verdict allow "git grep useMenuButton main -- client"  "grep a ref"
verdict allow "git status --short"                     "status"
verdict allow "npm run typecheck"                      "a non-git command"
verdict allow "git checkout feature-branch"            "returning to the plan's branch"
verdict allow "git switch feature-branch"              "switching back to the plan's branch"

echo "== no plan, or a plan for another branch: never block =="
rm -f "$tmp/.claude/state/current-plan.json"
verdict allow "git checkout main"                      "no plan state at all"
write_state some-other-branch
verdict allow "git checkout main"                      "plan names a branch not checked out"

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ] || exit 1
echo "OK: protect-plan-branch denies HEAD-moving commands and allows every read."
