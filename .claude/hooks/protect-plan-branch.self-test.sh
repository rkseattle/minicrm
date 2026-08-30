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
  # Parsed, not grepped: matching the serialized text made the harness sensitive to
  # JSON spacing, and a formatting change read as 23 behavioural failures.
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
    got=deny
  else
    got=allow
  fi
  if [ "$got" = "$want" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "  FAIL [$desc] wanted=$want got=$got"
    echo "       cmd: $cmd"
  fi
}

# Without python3 the hook allows every command by design, and each case below would
# report allow — a fully permissive guard passing its own suite 50/50. Fail loudly
# instead: silence is this guard's only real failure mode.
if ! command -v python3 >/dev/null 2>&1; then
  echo "FATAL: python3 not found — the hook would allow everything and this suite would still pass."
  exit 1
fi

echo "== plan names the checked-out branch: moving HEAD must be denied =="
write_state feature-branch
verdict deny "git checkout main"                       "checkout another branch"
verdict deny "git switch main"                         "switch another branch"
verdict deny "cd /repo && git checkout main"           "checkout after a chained cd"
verdict deny "git stash"                               "stash"
verdict deny "git reset --hard origin/main"            "hard reset"
verdict deny "git clean -fd"                           "clean"
verdict deny "git worktree add ../wt main"             "worktree add"


echo "== holes found in review: these must also be denied =="

verdict deny "git -C /repo checkout main"              "global -C before the subcommand"
verdict deny "git --git-dir=/r/.git switch main"       "global --git-dir before the subcommand"
# A -C value may be quoted and hold spaces; matching only bare tokens let the
# subcommand escape the pattern entirely.
verdict deny 'git -C "/workspace path" checkout main'  "quoted -C value with a space"
verdict deny "git -C '/workspace path' switch main"    "single-quoted -C value with a space"
verdict deny "git checkout main && git checkout feature-branch" "destructive first in a compound"
verdict deny "npm test && git checkout main"           "destructive second in a compound"
verdict deny "git stash push -m wip"                   "stash push"
verdict deny "git stash pop"                           "stash pop"

echo "== a wrapped invocation must still be seen =="
# Collapsing spaces inside ANY quoted run turned `sh -c "git checkout main"` into one
# opaque token, hiding the wrapped git command from the matcher entirely.
verdict deny 'sh -c "git checkout main"'               "sh -c wrapping a checkout"
# `-c` is git's config flag AND sh's command flag. Matching on the flag name alone
# cannot separate them: the git one must collapse, the sh one must not.
verdict deny 'git -c "user.name=John Doe" checkout main' "git -c config value with a space"
verdict deny "bash -c 'git switch main'"               "bash -c wrapping a switch"

echo "== bypasses found in review: quoting must not defeat the match =="
# Stripping every quoted run to avoid false positives also stripped the branch
# argument, so `git checkout "main"` left nothing for the ref token to match.
verdict deny 'git checkout "main"'                     "double-quoted branch"
verdict deny "git checkout 'main'"                     "single-quoted branch"
verdict deny "git rebase main"                         "rebase moves HEAD and rewrites"
verdict deny "git restore --source=main --worktree ."  "restore --source overwrites the tree"

echo "== quoting variants of one command: all are the same token list =="
# Reported as four separate P1 bypasses against the regex matcher, each a new spelling.
# A probe of five variants found three still broken after the reported one was patched,
# which is what moved the decision from regex matching to shlex tokenization.
verdict deny 'git -c user.name="John Doe" checkout main'  "value quoted, key bare"
verdict deny "git -c user.name='John Doe' checkout main"  "value single-quoted, key bare"
verdict deny 'git -c a=1 -c b="x y" checkout main'        "two -c options, second quoted"
verdict deny 'git --git-dir="/a b/.git" checkout main'    "quoted --git-dir= value"
verdict deny 'git checkout "ma"in'                        "quote opening mid-token"
verdict deny "git   checkout    main"                     "runs of whitespace"
verdict deny "git -C /r -c x=y switch main"               "two global options then switch"

echo "== separators: shlex does not split these, so the raw string must be split first =="
# `;` is the separator an agent writes most often and was completely unguarded: shlex
# glues it to the neighbouring word (`hi;`, `true;git`), so a tokenize-then-split design
# read the whole line as one non-git command.
verdict deny "echo hi; git checkout main"              "semicolon separator"
verdict deny "true;git checkout main"                  "semicolon with no spaces"
verdict deny "git status&&git checkout main"           "unspaced &&"
verdict deny "git status||git checkout main"           "unspaced ||"
verdict deny "git log|head;git clean -fd"              "pipe then semicolon"
verdict deny "npm test; git switch main"               "switch after a semicolon"

echo "== every shell wrapper must be seen through, in both shapes =="
# Sibling shape (`sudo git ...`) was allowed wholesale: re-tokenizing each token alone
# turned `git` into a one-token command that moves nothing.
verdict deny "sh -c 'git checkout main'"               "sh -c nested"
verdict deny "bash -c 'git checkout main'"             "bash -c nested"
verdict deny "zsh -c 'git checkout main'"              "zsh -c nested"
verdict deny "dash -c 'git checkout main'"             "dash -c nested"
verdict deny "env FOO=bar git checkout main"           "env with an assignment"
verdict deny "xargs git checkout main"                 "xargs sibling"
verdict deny "nohup git switch main"                   "nohup sibling"
verdict deny "time git checkout main"                  "time sibling"
verdict deny "sudo git checkout main"                  "sudo sibling"
verdict deny 'bash -c "echo x; git checkout main"'     "separator inside a wrapper"
verdict deny "/usr/bin/git checkout main"              "absolute path to git"

echo "== every value-taking global option must skip its value =="
verdict deny "git -c a=b checkout main"                "-c"
verdict deny "git -C /repo checkout main"              "-C"
verdict deny "git --git-dir /r/.git checkout main"     "--git-dir"
verdict deny "git --work-tree /r checkout main"        "--work-tree"
verdict deny "git --namespace ns checkout main"        "--namespace"
verdict deny "git --exec-path /x checkout main"        "--exec-path"

echo "== grouping and control flow must not hide the command =="
verdict deny "(git checkout main)"                     "subshell"
verdict deny "{ git checkout main; }"                  "brace group"
verdict deny "if true; then git checkout main; fi"     "inside an if"

echo "== refs that look like flags, and refs hidden behind another ref =="
# `-` is the previous branch. It was filtered out as a flag, leaving no refs at all.
verdict deny "git checkout -"                          "dash means previous branch"
verdict deny "git switch -"                            "dash on switch"
# A ref BEFORE `--` still moves HEAD; only the tokens after it are paths.
verdict deny "git checkout main --"                    "ref then bare --"
verdict deny "git switch main --"                      "switch ref then bare --"
# Naming the plan branch first must not launder a second ref.
verdict deny "git checkout feature-branch main"        "plan branch then another ref"

echo "== stash spellings that are all push =="
verdict deny "git stash save wip"                      "save is the push alias"
verdict deny "git stash -u"                            "bare push with a flag"
verdict deny "git stash -m wip"                        "bare push with a message"

echo "== recovery paths must stay allowed, or the guard strands the session =="
verdict allow "git rebase --abort"                     "abort a broken rebase"
verdict allow "git rebase --continue"                  "continue a rebase"
verdict allow "git clean -n"                           "clean dry run"
verdict allow "git clean --dry-run"                    "clean --dry-run"
verdict allow "git reset HEAD path/to/file.txt"        "unstage one path"
verdict allow "git reset -- path/to/file.txt"          "unstage via --"
verdict allow "git worktree lock ../wt"                "worktree lock moves nothing"

echo "== verbs that move neither HEAD nor the tree stay allowed =="
verdict allow "git worktree list"                      "worktree list is a read"
verdict allow "git reset"                              "bare reset only unstages"
# A soft reset keeps the tree but still moves HEAD to another commit, which is the
# thing this guard protects — so it is denied, unlike a bare `git reset`.
verdict deny "git reset HEAD~1 --soft"                 "soft reset still moves HEAD"

echo "== path-scoped reverts cannot move HEAD, so they stay allowed =="
# Restoring a file the tooling touched incidentally is routine; the guard protects the
# branch, not every destructive-looking verb.
verdict allow "git checkout -- client/src/app.tsx"     "discard one tracked file"
verdict allow "git restore client/src/app.tsx"         "restore one tracked file"
verdict allow "git checkout -- docs/screenshots/06.png docs/screenshots/16.png" "restore several files"

echo "== command TEXT that only mentions a git command must stay allowed =="
# The guard's first live failure: a commit whose message documented the guard was
# refused, because the message names the command the guard blocks.
verdict allow "git commit -m 'why git checkout main is refused'" "message quoting a command"
verdict allow 'echo "run git checkout main to compare"'          "echo of a command"
verdict allow "grep -rn 'git checkout' docs/"                    "grep for the phrase"

echo "== read-only stash subcommands must stay allowed =="
verdict allow "git stash list"                         "stash list"
verdict allow "git stash show -p"                      "stash show"

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
