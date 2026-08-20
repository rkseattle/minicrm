#!/usr/bin/env bash
# Stop hook: refuse to end a turn while an approved plan still has unfinished phases.
#
# Decides from typed state only — a phase count and whether the last transcript entry
# carried a tool_use. Never matches against message prose, which has no finite pattern
# set and so cannot be classified reliably.
#
# Every error allows the stop: blocking forever is worse than not blocking at all.
set -uo pipefail

# Two nudges is a reminder; more is a stranded session.
MAX_CONSECUTIVE_BLOCKS=2
# Bounds the backward scan. Transcripts reach millions of bytes on a single line, and
# the entry being classified is always within the last few.
MAX_SCAN_BYTES=2000000
MAX_SCAN_LINES=400

# Records that the harness actually ran this script. A stall with no line here means the
# hook was never dispatched; a line with no matching block means it ran and its verdict
# went unapplied. Nothing else distinguishes those two, and they have different fixes.
# Runs before every exit path, uses no jq (the next line may exit without it), and never
# fails the hook: a log that breaks the guard is worse than no log.
log_invocation() {
  local dir="${CLAUDE_PROJECT_DIR:-.}/.claude/state"
  local logfile="$dir/hook-invocations.log"
  [ -d "$dir" ] || return 0
  # Keep the tail bounded; this file is diagnostic, never state.
  if [ -f "$logfile" ] && [ "$(wc -l < "$logfile" 2>/dev/null || echo 0)" -gt 500 ]; then
    tail -n 200 "$logfile" > "$logfile.tmp" 2>/dev/null && mv "$logfile.tmp" "$logfile" 2>/dev/null
  fi
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$logfile" 2>/dev/null || true
}

allow() {
  log_invocation "verdict=allow"
  printf '{"continue": true}\n'
  exit 0
}

# The self-test is not a hook invocation; logging it would manufacture the very
# signature this log exists to distinguish — an "invoked" line with no verdict.
[ "${1:-}" = "--self-test" ] && exec bash "$(dirname "$0")/block-false-stop.self-test.sh" "$0"

log_invocation "invoked"

command -v jq >/dev/null 2>&1 || allow
input=$(cat) || allow

# cwd is not guaranteed to be the repo root, and a state path that misses silently
# disables the hook.
root="${CLAUDE_PROJECT_DIR:-$(jq -r '.cwd // "."' <<<"$input")}"
state="$root/.claude/state/current-plan.json"

session=$(jq -r '.session_id // "nosession"' <<<"$input")
# The id reaches the filesystem, so anything outside a safe segment is not a name.
[[ "$session" =~ ^[A-Za-z0-9_-]+$ ]] || session="nosession"
marker="$root/.claude/state/blocked-$session"

# stop_hook_active is undocumented for Stop, so the marker is what terminates the loop.
# Keyed by session so one session cannot silence another.
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && { rm -f "$marker"; allow; }

[ -f "$state" ] || { rm -f "$marker"; allow; }
[ "$(jq -r 'if (.phases|type) == "array" then "ok" else "bad" end' "$state" 2>/dev/null)" = "ok" ] || allow
[ "$(jq -r '.paused // false' "$state" 2>/dev/null)" = "true" ] && { rm -f "$marker"; allow; }

# Abandoned work is left on its branch, so a state file naming a branch that is no longer
# checked out describes phases this session is not working on. Plan files cannot serve
# here: nothing ever deletes one, so a plan-existence check would never fire.
want_branch=$(jq -r '.branch // ""' "$state" 2>/dev/null)
if [ -n "$want_branch" ]; then
  here=$(git -C "$root" symbolic-ref --short HEAD 2>/dev/null || echo "")
  [ -n "$here" ] && [ "$here" != "$want_branch" ] && { rm -f "$marker"; allow; }
fi

remaining=$(jq -r '[.phases[]? | select(.done != true)] | length' "$state" 2>/dev/null)
[[ "$remaining" =~ ^[0-9]+$ ]] || allow
[ "$remaining" -eq 0 ] && { rm -f "$marker"; allow; }

transcript=$(jq -r '.transcript_path // ""' <<<"$input")
[ -f "$transcript" ] || allow

# Marker holds "<size> <consecutive-blocks>". Size alone never terminates (each block
# prompts a reply, growing the transcript); presence alone mutes every second stall.
# Together: an unchanged transcript is the retry, and a run of blocks is capped.
size=$(wc -c < "$transcript" | tr -d ' ')
mark_size=""; mark_n=0
[ -f "$marker" ] && read -r mark_size mark_n < "$marker"
[ "$mark_size" = "$size" ] && allow
[[ "$mark_n" =~ ^[0-9]+$ ]] || mark_n=0
attempt=$((mark_n + 1))

# The transcript is mid-append, so its last line is routinely partial. The added
# newline stops `tail -r` welding that fragment onto the entry before it. A fragment
# counts as unknown rather than skipped: it may be a tool call, and judging by the
# previous entry would read an in-flight call as a stall.
#
# The "partial" arm is defensive, not behavioral: without it a fragment makes jq error
# instead of classifying, which the redirect swallows into the same allow. No corpus can
# tell the two apart by verdict, so no self-test case can either.
#
# Tool results are skipped: they are the transcript's own bookkeeping, not a turn.
# Role, not content shape, is what marks a human turn — a typed prompt is a bare string
# but an ESC interrupt, a skill prompt, and a pasted screenshot all arrive as arrays.
# tool_use is tested before text because one entry can carry both, and a turn that
# called a tool has acted.
last=$({ cat "$transcript"; printf '\n'; } \
  | { tail -r 2>/dev/null || tac 2>/dev/null; } | head -c "$MAX_SCAN_BYTES" | head -n "$MAX_SCAN_LINES" | jq -R -r -n '
  first(
    (inputs? // empty) | select(length > 0)
    | (try fromjson catch "partial") as $o | select($o != null)
    | if   ($o == "partial")                                     then "partial"
      elif (any($o.message.content[]?; .type == "tool_result")) then empty
      elif ($o.message.role == "user")                          then "human"
      elif (any($o.message.content[]?; .type == "tool_use"))    then "action"
      elif (any($o.message.content[]?; .type == "text"))        then "words"
      else empty end
  ) // "none"' 2>/dev/null)

[ "$last" = "words" ] || { rm -f "$marker"; allow; }
[ "$attempt" -gt "$MAX_CONSECUTIVE_BLOCKS" ] && allow

{ mkdir -p "$(dirname "$marker")" && printf '%s %s' "$size" "$attempt" > "$marker"; } || allow
# Logged before the emit rather than after: `allow` on a jq failure would recurse into
# log_invocation and record a contradictory second line, and a block whose jq failed
# still ran — which is what this log distinguishes.
log_invocation "verdict=block remaining=$remaining attempt=$attempt"
jq -n --arg r "$remaining" '{
  decision: "block",
  reason: ("Plan has \($r) unfinished phase(s) in .claude/state/current-plan.json. Continue with the next phase now — do not end the turn. To stop deliberately, set \"paused\": true in that file; if the plan is abandoned, delete it.")
}'
