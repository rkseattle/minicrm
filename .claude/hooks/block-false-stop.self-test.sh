#!/usr/bin/env bash
# Self-test for block-false-stop.sh. Separate file so the hook stays within the
# 60-line ceiling that exists to stop it growing the way its predecessor did.
#
# Asserts exact counts, not exit status: a guard that silently stops flagging is
# indistinguishable from a clean run if you only check whether it passed.
set -uo pipefail

hook_under_test="${1:?usage: block-false-stop.self-test.sh <path-to-hook>}"

self_test() {
  local tmp st_failures=0 st_total=0 hook
  hook="$(cd "$(dirname "$hook_under_test")" && pwd)/$(basename "$hook_under_test")"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  mkdir -p "$tmp/.claude/state"

  # Transcript corpora. Every one interleaves skipped entry types (tool_result,
  # attachment) so a scan that halts at the first non-classifiable line is caught.
  local noise='{"type":"attachment"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}'

  printf '%s\n{"type":"user","message":{"role":"user","content":"hi"}}\n%s\n' \
    "$noise" "$noise" > "$tmp/human.jsonl"
  printf '%s\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"a","name":"Bash","input":{}}]}}\n%s\n' \
    "$noise" "$noise" > "$tmp/action.jsonl"
  printf '%s\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n%s\n' \
    "$noise" "$noise" > "$tmp/words.jsonl"
  # One real entry carries both; tool_use must win, or a turn that acted reads as idle.
  printf '%s\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"},{"type":"tool_use","id":"b","name":"Bash","input":{}}]}}\n%s\n' \
    "$noise" "$noise" > "$tmp/mixed.jsonl"
  printf '%s\n' "$noise" > "$tmp/none.jsonl"
  # Human turns are not always bare strings: an ESC interrupt and a skill prompt arrive
  # as an array of text blocks, a pasted screenshot as image+text. Content shape alone
  # cannot tell them from an assistant stall — only role can.
  printf '%s\n{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}\n%s\n' \
    "$noise" "$noise" > "$tmp/humanarray.jsonl"
  printf '%s\n{"type":"user","message":{"role":"user","content":[{"type":"image","source":{}},{"type":"text","text":"see this"}]}}\n%s\n' \
    "$noise" "$noise" > "$tmp/humanimage.jsonl"
  # A Stop hook fires mid-append, so the final line is routinely a partial fragment.
  printf '%s\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n{"type":"assistant","message":{"role":"assis' \
    "$noise" > "$tmp/truncated.jsonl"
  # The mirror image: a tool call half-written when the hook fired. Classifying on the
  # entry before it would call an in-flight tool call a stall.
  printf '%s\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Running it"}]}}\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_u' \
    "$noise" > "$tmp/fragaction.jsonl"
  # A complete final entry with no trailing newline. Without normalization `tail -r`
  # welds it onto the line before, corrupting an entry that was never truncated.
  printf '%s\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"a"}]}}\n{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stalled here"}]}}' \
    "$noise" > "$tmp/nonewline.jsonl"

  printf '{"phases":[{"name":"a","done":true}]}\n'  > "$tmp/.claude/state/zero.json"
  printf '{"phases":[{"name":"a","done":false},{"name":"b"}]}\n' > "$tmp/.claude/state/two.json"
  printf '{"phases":"oops"}\n'                      > "$tmp/.claude/state/malformed.json"
  printf '{"phases":{"a":{"done":false}}}\n'         > "$tmp/.claude/state/objphases.json"
  printf '{"phases":[{"name":"a"}],"paused":true}\n' > "$tmp/.claude/state/paused.json"
  # A real repo, so the branch check has something to read.
  git -C "$tmp" init -q -b feature/live 2>/dev/null
  printf '{"branch":"feature/live","phases":[{"name":"a","done":false}]}\n' \
    > "$tmp/.claude/state/ownbranch.json"
  printf '{"branch":"feature/abandoned","phases":[{"name":"a","done":false}]}\n' \
    > "$tmp/.claude/state/otherbranch.json"
  printf '{"branch":5,"phases":[{"name":"a","done":false}]}\n' \
    > "$tmp/.claude/state/numbranch.json"

  fire() {  # fire <session> <state-file|-> <transcript> [extra-json] -> block|allow
    rm -f "$tmp/.claude/state/current-plan.json"
    [ "$2" != "-" ] && cp "$tmp/.claude/state/$2" "$tmp/.claude/state/current-plan.json"
    printf '{"session_id":"%s","cwd":"%s","transcript_path":"%s"%s}' "$1" "$tmp" "$3" "${4:-}" \
      | CLAUDE_PROJECT_DIR="$tmp" bash "$hook" | jq -r '.decision // "allow"'
  }

  # verdict <expected> <label> <state-file|-> <transcript> [extra-json]
  verdict() {
    local expect="$1" label="$2" sf="$3" tr="$4" extra="${5:-}" got
    st_total=$((st_total + 1))
    [ "${keep_marker:-}" = "1" ] || rm -f "$tmp/.claude/state"/blocked-*
    got=$(fire s1 "$sf" "$tr" "$extra")
    if [ "$got" = "$expect" ]; then
      echo "  ok: ${label} (${got})"
    else
      echo "  FAIL: ${label} — expected ${expect}, got ${got:-<unparseable>}"
      st_failures=$((st_failures + 1))
    fi
  }

  # Transcript-independent rows: absent, malformed, paused, and zero-remaining state all
  # short-circuit before the transcript is read. Enumerated against every transcript
  # anyway, to prove the short-circuit holds for each input rather than assuming it.
  local t
  for t in human humanarray humanimage action words mixed none truncated fragaction nonewline; do
    verdict allow "state absent / $t"    -             "$tmp/$t.jsonl"
    verdict allow "malformed / $t"       malformed.json "$tmp/$t.jsonl"
    verdict allow "0 remaining / $t"     zero.json      "$tmp/$t.jsonl"
    verdict allow "paused / $t"          paused.json    "$tmp/$t.jsonl"
  done

  # The only rows that reach the classifier.
  verdict allow "2 remaining / human"      two.json "$tmp/human.jsonl"
  verdict allow "human interrupt (array)"  two.json "$tmp/humanarray.jsonl"
  verdict allow "human paste (image+text)" two.json "$tmp/humanimage.jsonl"
  verdict allow "2 remaining / action"     two.json "$tmp/action.jsonl"
  verdict block "2 remaining / words"      two.json "$tmp/words.jsonl"
  verdict allow "2 remaining / mixed"      two.json "$tmp/mixed.jsonl"
  verdict allow "2 remaining / none"       two.json "$tmp/none.jsonl"
  verdict allow "2 remaining / truncated"  two.json "$tmp/truncated.jsonl"
  verdict allow "2 remaining / fragaction" two.json "$tmp/fragaction.jsonl"
  verdict block "2 remaining / nonewline"  two.json "$tmp/nonewline.jsonl"

  verdict allow "object-valued .phases"    objphases.json "$tmp/words.jsonl"
  verdict block "state names this branch"  ownbranch.json   "$tmp/words.jsonl"
  verdict allow "state names another branch" otherbranch.json "$tmp/words.jsonl"
  verdict allow "non-string branch"        numbranch.json   "$tmp/words.jsonl"
  verdict allow "missing transcript"       two.json "$tmp/nonexistent.jsonl"
  verdict allow "stop_hook_active"         two.json "$tmp/words.jsonl" ',"stop_hook_active":true'

  # Marker lifecycle. It is the recursion guard that actually holds, since
  # stop_hook_active is undocumented for Stop, so its three states are all checked.
  check() {
    st_total=$((st_total + 1))
    if [ "$2" = "$3" ]; then echo "  ok: $1"
    else echo "  FAIL: $1 — expected $3, got $2"; st_failures=$((st_failures + 1)); fi
  }
  rm -f "$tmp/.claude/state"/blocked-*
  fire s1 two.json "$tmp/words.jsonl" >/dev/null
  check "marker written on block" "$([ -f "$tmp/.claude/state/blocked-s1" ] && echo yes || echo no)" yes

  keep_marker=1 verdict allow "retry of the same stop → allow" two.json "$tmp/words.jsonl"

  # A model that keeps replying grows the transcript, so a size-only guard would block
  # forever. The ceiling is what bounds it.
  rm -f "$tmp/.claude/state"/blocked-*
  cp "$tmp/words.jsonl" "$tmp/grow.jsonl"
  local seq=""
  for _ in 1 2 3 4; do
    seq="$seq$(fire s1 two.json "$tmp/grow.jsonl") "
    printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"again"}]}}\n' \
      >> "$tmp/grow.jsonl"
  done
  check "growing transcript stops blocking (bounded)" "$seq" "block block allow allow "

  # The cap must not be permanent. Real work clears the marker, so a later stall is
  # judged fresh — otherwise two blocks disable the hook for the rest of the session.
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"w","name":"Bash","input":{}}]}}\n' \
    >> "$tmp/grow.jsonl"
  check "work after the cap clears the marker" "$(fire s1 two.json "$tmp/grow.jsonl")" allow
  check "marker gone after progress" \
    "$([ -f "$tmp/.claude/state/blocked-s1" ] && echo kept || echo cleared)" cleared
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"stalled again"}]}}\n' \
    >> "$tmp/grow.jsonl"
  check "stall after post-cap progress blocks again" \
    "$(fire s1 two.json "$tmp/grow.jsonl")" block
  rm -f "$tmp/.claude/state"/blocked-*

  # These paths returned without clearing, so a capped marker survived a pause/resume.
  : > "$tmp/.claude/state/blocked-s1"
  fire s1 paused.json "$tmp/words.jsonl" >/dev/null
  check "paused clears a stale marker" \
    "$([ -f "$tmp/.claude/state/blocked-s1" ] && echo kept || echo cleared)" cleared
  : > "$tmp/.claude/state/blocked-s1"
  fire s1 two.json "$tmp/words.jsonl" ',"stop_hook_active":true' >/dev/null
  check "stop_hook_active clears a stale marker" \
    "$([ -f "$tmp/.claude/state/blocked-s1" ] && echo kept || echo cleared)" cleared
  rm -f "$tmp/.claude/state"/blocked-*

  # The marker write is the hook's only I/O; if it fails the block has no guard at all.
  chmod 555 "$tmp/.claude/state"
  check "unwritable state dir fails open" "$(fire s1 two.json "$tmp/words.jsonl" 2>/dev/null)" allow
  chmod 755 "$tmp/.claude/state"
  rm -f "$tmp/.claude/state"/blocked-*

  # The failure a presence-only marker hides: a real stall right after an unrelated
  # block must still be caught, not silently alternated away.
  cp "$tmp/words.jsonl" "$tmp/advanced.jsonl"
  printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"still going"}]}}\n' \
    >> "$tmp/advanced.jsonl"
  keep_marker=1 verdict block "later stall, transcript advanced → block" two.json "$tmp/advanced.jsonl"
  keep_marker=

  # A traversing session_id must not place a file outside .claude/state/.
  rm -rf "$tmp/pwned" "$tmp/.claude/pwned"
  fire "../../../pwned/x" two.json "$tmp/words.jsonl" >/dev/null
  check "session_id cannot escape .claude/state" \
    "$([ -e "$tmp/pwned/x" ] || [ -e "$tmp/.claude/pwned/x" ] && echo escaped || echo contained)" contained

  # A finished plan clears its marker rather than leaving one behind forever.
  rm -f "$tmp/.claude/state"/blocked-*
  fire s9 two.json "$tmp/words.jsonl" >/dev/null
  fire s9 zero.json "$tmp/words.jsonl" >/dev/null
  check "completed plan clears its marker" \
    "$([ -f "$tmp/.claude/state/blocked-s9" ] && echo kept || echo cleared)" cleared

  rm -f "$tmp/.claude/state"/blocked-*
  : > "$tmp/.claude/state/blocked-OTHER"
  check "another session's marker still blocks" "$(fire s1 two.json "$tmp/words.jsonl")" block
  rm -f "$tmp/.claude/state"/blocked-*

  # No CLAUDE_PROJECT_DIR: the path must resolve from the payload's cwd instead.
  cp "$tmp/.claude/state/two.json" "$tmp/.claude/state/current-plan.json"
  check "resolves state via payload cwd" \
    "$(cd / && printf '{"session_id":"s2","cwd":"%s","transcript_path":"%s"}' "$tmp" "$tmp/words.jsonl" \
       | bash "$hook" | jq -r '.decision // "allow"')" block

  local expected=70
  if [ "$st_total" -ne "$expected" ]; then
    echo "SELF-TEST FAILED: ran ${st_total} cases, expected exactly ${expected}."
    return 1
  fi
  if [ "$st_failures" -ne 0 ]; then
    echo "SELF-TEST FAILED: ${st_failures} case(s)."
    return 1
  fi
  echo "SELF-TEST PASS: all ${st_total} cases classified correctly."
  return 0
}

self_test
exit $?
