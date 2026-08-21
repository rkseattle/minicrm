#!/usr/bin/env bash
# Asserts that the .claude/gates ↔ docs/dev pointers still resolve.
#
# The two trees deliberately hold different copies of the same requirements: docs/dev is
# the human account, .claude/gates the agent one, and each gate names its counterpart so
# a reader knows which is canonical. Those pointers are prose, and prose rots — a renamed
# or moved doc leaves the gate pointing at nothing, which is how the split silently turns
# back into two unrelated trees.
#
# Deliberately a LITERAL PATH check. It resolves the link targets a gate names; it never
# compares wording between the two files. Comparing prose does not converge (see
# check-audit-gate-parity.sh's doc loop for the same conclusion reached the hard way).
#
# Run: bash scripts/check-gate-pointer-parity.sh [--self-test]
#
# No -e: check_tree collects every finding before returning, so an early exit on the
# first would hide the rest.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# gate → the specific counterpart it must link. Checking only "links something under
# docs/" would pass a gate repointed at any unrelated page, which is the drift this
# guard exists to catch.
GATE_COUNTERPARTS=(
  ".claude/gates/definition-of-done.md|docs/dev/contributing.md"
  ".claude/gates/pre-push.md|docs/dev/contributing.md"
  ".claude/gates/new-endpoint.md|docs/dev/new-endpoint.md"
  ".claude/gates/e2e-run.md|docs/operations.md"
)

# Extracts every relative markdown link target from a file. Strips the optional title —
# [x](path "Title") is a valid link, and check-doc-links.mjs treats it as one.
link_targets() {
  grep -o -E '\]\([^)]+\)' "$1" 2>/dev/null |
    sed -E 's/^\]\(//; s/\)$//; s/[[:space:]]+"[^"]*"$//; s/#.*$//' |
    grep -v -E '^(https?:|mailto:)' |
    grep -v -E '^[[:space:]]*$' || true
}

# Prints one finding per line; callers count them. Exit status alone cannot distinguish
# which check fired, so a self-test asserting only status can pass with a check deleted.
check_tree() {
  local root="$1"
  local entry gate want path resolved target linked

  for entry in "${GATE_COUNTERPARTS[@]}"; do
    gate="${entry%%|*}"
    want="${entry##*|}"
    path="${root}/${gate}"

    if [[ ! -f "$path" ]]; then
      echo "missing-gate: ${gate} does not exist — update GATE_COUNTERPARTS."
      continue
    fi

    if [[ ! -f "${root}/${want}" ]]; then
      echo "missing-counterpart: ${want} is gone, but ${gate} points at it."
    fi

    linked=0
    while IFS= read -r target; do
      [[ -z "$target" ]] && continue
      resolved="$(cd "$(dirname "$path")" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")"
      [[ "$resolved" == "${root}/${want}" ]] && linked=1
    done < <(link_targets "$path")

    if [[ "$linked" -eq 0 ]]; then
      echo "wrong-counterpart: ${gate} does not link ${want}."
    fi
  done

  # Enumerate rather than trust the list: a gate added without an entry would otherwise
  # be invisible, which is the same drift this guard exists to catch, one level up.
  local found entry_gate
  for found in "$root"/.claude/gates/*.md; do
    [[ -e "$found" ]] || continue
    gate=".claude/gates/$(basename "$found")"
    linked=0
    for entry in "${GATE_COUNTERPARTS[@]}"; do
      entry_gate="${entry%%|*}"
      [[ "$entry_gate" == "$gate" ]] && linked=1
    done
    if [[ "$linked" -eq 0 ]]; then
      echo "unlisted-gate: ${gate} has no GATE_COUNTERPARTS entry."
    fi
  done
}

count_findings() {
  local out
  out="$(check_tree "$1")"
  [[ -z "$out" ]] && { echo 0; return; }
  printf '%s\n' "$out" | wc -l | tr -d ' '
}

self_test() {
  local tmp failures=0 n
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand tmp now, not at trap time
  trap "rm -rf '$tmp'" EXIT

  mkdir -p "$tmp/.claude/gates" "$tmp/docs/dev"
  printf '# gate\n\nSee [contributing](../../docs/dev/contributing.md).\n' \
    > "$tmp/.claude/gates/definition-of-done.md"
  printf '# gate\n\nSee [contributing](../../docs/dev/contributing.md "The human account").\n' \
    > "$tmp/.claude/gates/pre-push.md"
  printf '# gate\n\nSee [checklist](../../docs/dev/new-endpoint.md).\n' \
    > "$tmp/.claude/gates/new-endpoint.md"
  printf '# gate\n\nSee [operations](../../docs/operations.md).\n' \
    > "$tmp/.claude/gates/e2e-run.md"
  printf '# contributing\n' > "$tmp/docs/dev/contributing.md"
  printf '# checklist\n' > "$tmp/docs/dev/new-endpoint.md"
  printf '# operations\n' > "$tmp/docs/operations.md"
  printf '# unrelated\n' > "$tmp/docs/dev/schema.md"

  expect() {
    local want="$1" label="$2" got
    got="$(count_findings "$tmp")"
    if [[ "$got" != "$want" ]]; then
      echo "SELF-TEST FAIL: ${label} — expected ${want} finding(s), got ${got}:"
      check_tree "$tmp" | sed 's/^/    /'
      failures=1
    fi
  }

  expect 0 "clean fixture"

  # A gate repointed at a real but unrelated doc: the counterpart still exists, so only
  # the wrong-counterpart check can catch this. Distinguishes it from mere resolution.
  printf '# gate\n\nSee [schema](../../docs/dev/schema.md).\n' \
    > "$tmp/.claude/gates/definition-of-done.md"
  expect 1 "gate repointed at an unrelated doc"
  printf '# gate\n\nSee [contributing](../../docs/dev/contributing.md).\n' \
    > "$tmp/.claude/gates/definition-of-done.md"

  # A counterpart moved away. The gate still links that path, so only the existence
  # check fires — which is why it is a separate check rather than folded into the link
  # resolution.
  mv "$tmp/docs/dev/new-endpoint.md" "$tmp/docs/dev/renamed.md"
  expect 1 "counterpart moved away"
  mv "$tmp/docs/dev/renamed.md" "$tmp/docs/dev/new-endpoint.md"

  # A gate that links nothing at all.
  printf '# gate\n\nNo pointer here.\n' > "$tmp/.claude/gates/pre-push.md"
  expect 1 "gate with no pointer"
  printf '# gate\n\nSee [contributing](../../docs/dev/contributing.md).\n' \
    > "$tmp/.claude/gates/pre-push.md"

  # A deleted gate.
  rm "$tmp/.claude/gates/e2e-run.md"
  expect 1 "deleted gate"
  printf '# gate\n\nSee [operations](../../docs/operations.md).\n' \
    > "$tmp/.claude/gates/e2e-run.md"

  # A gate added without an entry — invisible to a list-driven check.
  printf '# new\n\nNo pointer.\n' > "$tmp/.claude/gates/brand-new.md"
  expect 1 "gate added with no entry"
  rm "$tmp/.claude/gates/brand-new.md"

  if [[ "$failures" -ne 0 ]]; then
    exit 1
  fi
  n="${#GATE_COUNTERPARTS[@]}"
  echo "SELF-TEST PASS: ${n} pairs; clean=0, repointed=1, moved=1, unlinked=1, deleted=1, unlisted=1."
}

case "${1:-}" in
  --self-test)
    self_test
    exit 0
    ;;
  '') ;;
  *)
    # A typo'd flag must not silently run the real check and print PASS.
    echo "Unknown argument: $1" >&2
    echo "Usage: $(basename "$0") [--self-test]" >&2
    exit 2
    ;;
esac

findings="$(check_tree "$REPO_ROOT")"
if [[ -n "$findings" ]]; then
  printf '%s\n' "$findings"
  echo
  echo "FAIL: a gate no longer points at its docs/ counterpart."
  echo "Each gate names the human account of its rules; see docs/dev/index.md for the split."
  exit 1
fi

echo "PASS: all ${#GATE_COUNTERPARTS[@]} gates link the counterpart naming which copy is canonical."
