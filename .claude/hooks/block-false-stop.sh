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

allow() {
  printf '{"continue": true}\n'
  exit 0
}

[ "${1:-}" = "--self-test" ] && exec bash "$(dirname "$0")/block-false-stop.self-test.sh" "$0"


command -v jq >/dev/null 2>&1 || { printf '{"continue": true}\n'; exit 0; }

input=$(cat) || { printf '{"continue": true}\n'; exit 0; }

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
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && allow

[ -f "$state" ] || { rm -f "$marker"; allow; }
[ "$(jq -r 'if (.phases|type) == "array" then "ok" else "bad" end' "$state" 2>/dev/null)" = "ok" ] || allow
[ "$(jq -r '.paused // false' "$state" 2>/dev/null)" = "true" ] && allow

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
[ "$attempt" -gt "$MAX_CONSECUTIVE_BLOCKS" ] && allow

# The transcript is mid-append, so its last line is routinely partial. The added
# newline stops `tail -r` welding that fragment onto the entry before it. A fragment
# counts as unknown rather than skipped: it may be a tool call, and judging by the
# previous entry would read an in-flight call as a stall.
#
# tool_use is tested before text because one entry can carry both, and a turn that
# called a tool has acted.
last=$({ cat "$transcript"; printf '\n'; } \
  | { tail -r 2>/dev/null || tac 2>/dev/null; } | head -c "$MAX_SCAN_BYTES" | head -n "$MAX_SCAN_LINES" | jq -R -r -n '
  first(
    (inputs? // empty) | select(length > 0)
    | (try fromjson catch "partial") as $o | select($o != null)
    | if   ($o == "partial")                                    then "partial"
      elif ($o.message.content|type) == "string"                then "human"
      elif (any($o.message.content[]?; .type == "tool_use"))    then "action"
      elif (any($o.message.content[]?; .type == "text"))        then "words"
      else empty end
  ) // "none"' 2>/dev/null)

[ "$last" = "words" ] || { rm -f "$marker"; allow; }

mkdir -p "$(dirname "$marker")" && printf '%s %s' "$size" "$attempt" > "$marker"
jq -n --arg r "$remaining" '{
  decision: "block",
  reason: ("Plan has \($r) unfinished phase(s). Continue with the next phase now — do not end the turn. If you need a decision from the user, ask it as an explicit question.")
}'
