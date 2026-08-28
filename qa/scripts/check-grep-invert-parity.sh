#!/usr/bin/env bash
# =============================================================================
# check-grep-invert-parity.sh (MINCRM-706)
#
# Asserts that the non-serial `--grep-invert` expression is character-identical
# everywhere it is written: CI's e2e-functional job, the shared TypeScript
# constant local runs use, and the documented local command.
#
# WHAT BREAKS SILENTLY WITHOUT THIS
# ---------------------------------
# The expression decides WHICH SPECS RUN. If CI's copy and the local copy drift,
# the two run different sets and the local gate stops predicting CI — which is
# the whole reason MINCRM-706 shared the constant in the first place.
#
# A unit test cannot cover this. qa/e2e/tests/framework/targeted-run-plan.spec.ts
# can assert the constant equals a literal, but it cannot see ci.yml: editing the
# workflow leaves that test green while local and CI diverge. Per CLAUDE.md, a
# test that pins a value defined in another file has to read the other file, or
# it goes on passing while the implementations drift apart. Only a source-level
# check spans a YAML workflow, a .ts constant, and a Markdown command block.
#
# WHY NOT AN IMPORT
# -----------------
# The three sites are a GitHub Actions workflow, a TypeScript module, and a
# Markdown gate document. No import can span them.
#
# KNOWN PROSE MENTIONS, DELIBERATELY UNCHECKED
# --------------------------------------------
# The expression also appears in explanatory text at docs/dev/e2e-authoring.md,
# .github/workflows/tia-record-mode.yml, and ci.yml's e2e-serial comment. Those
# are descriptions, not invocations, and runnable_lines() exists to keep them
# from satisfying this check. They can still go stale — sweep them by hand if
# the constant ever changes.
#
# ONLY REAL COMMANDS COUNT — SEE runnable_lines()
# -----------------------------------------------
# Both non-TS callers legitimately DISCUSS this expression in prose — ci.yml's
# e2e-serial job explains in a comment which tests e2e-functional excluded, and
# the gate document narrates the command before showing it. Matching whole-file
# text would let those mentions stand in for the real thing: a run step could
# drop the expression, keep the comment, and still pass.
#
# That is not hypothetical, and it bit this script twice. With whole-file
# matching, the native --shard fallback could be changed to `--grep-invert
# "serial"` and this printed PASS, because a prose comment padded the count. The
# first fix stripped `#` lines only — which still passed when the gate
# document's fenced command drifted and ordinary Markdown body text (not
# `#`-prefixed, so untouched) mentioned the expression.
#
# Hence runnable_lines() dispatches on file type rather than applying one
# heuristic: a fence state machine for Markdown, comment-stripping for YAML.
# check-audit-gate-parity.sh documents the same trap for its own callers.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The one true value, defined in TypeScript and shared by every local caller.
CONSTANT_FILE="shared/testing/specRunnability.ts"
CONSTANT_NAME="NON_SERIAL_GREP_INVERT"

# `|| true` is load-bearing under `set -euo pipefail`: a non-matching grep exits
# 1, pipefail propagates it, and set -e would abort before the diagnostic below
# could name what went missing — a rename being the likeliest real trigger.
declaration="$(grep --text -E "^[[:space:]]*export const ${CONSTANT_NAME} = " \
  "${REPO_ROOT}/${CONSTANT_FILE}" | head -1 || true)"

if [[ -z "$declaration" ]]; then
  echo "ERROR: could not find '${CONSTANT_NAME}' in ${CONSTANT_FILE}"
  echo "       If it was renamed, update CONSTANT_NAME in $(basename "$0")."
  exit 1
fi

# Accept either quote style, so a Prettier config change cannot turn a real
# mismatch into a nonsense diagnostic built from the whole source line.
if [[ "$declaration" =~ =[[:space:]]*[\'\"]([^\'\"]+)[\'\"]\; ]]; then
  canonical="${BASH_REMATCH[1]}"
else
  echo "ERROR: could not parse a quoted string literal from ${CONSTANT_NAME}:"
  echo "       ${declaration}"
  echo "       This guard compares a literal; if the constant became a computed"
  echo "       expression, the comparison it performs is no longer meaningful."
  exit 1
fi

failed=0

# Reduces a caller to the lines that are REAL COMMANDS, discarding anything that
# merely talks about one. How prose is spelled differs by file type, so this
# dispatches on it rather than applying one heuristic everywhere — an earlier
# revision stripped only `#` lines, which silently let ordinary Markdown body
# text stand in for the gate document's actual command.
runnable_lines() {
  local path="$1"
  case "$path" in
    *.md)
      # Markdown: only fenced code blocks are commands. Body prose is NOT
      # `#`-prefixed, so comment-stripping does not touch it — the fence state
      # machine is what separates narration from the command it documents.
      # `#` lines INSIDE a fence are shell comments and are dropped too.
      awk '
        /^[[:space:]]*```/ { in_fence = !in_fence; next }
        in_fence && $0 !~ /^[[:space:]]*#/ { print }
      ' "$path"
      ;;
    *)
      # YAML and shell: `#` begins a comment.
      grep -v -E '^[[:space:]]*#' "$path"
      ;;
  esac
}

# --self-test exercises runnable_lines(), the one piece of real logic here: it
# decides whether a line is a command or prose ABOUT a command, and every silent
# failure this guard has had came from getting that wrong. Asserts COUNTS, not
# exit status — a checker that stops flagging is indistinguishable from a clean
# tree if you only look at "did it pass".
#
# Must-NOT-flag cases matter as much as must-flag ones: a runnable_lines() that
# returned everything would catch all drift and be useless, because the prose
# mentions this repo deliberately keeps would fail it forever.
if [[ "${1:-}" == "--self-test" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  st_failures=0

  expect_count() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$actual" -ne "$expected" ]]; then
      echo "  FAIL: ${label} — expected ${expected} runnable line(s), got ${actual}"
      st_failures=$((st_failures + 1))
    else
      echo "  ok: ${label} (${actual})"
    fi
  }

  # Markdown: a fenced command counts; narration and an in-fence shell comment
  # do not. This is the exact shape docs/operations.md and the gate document use.
  cat > "$tmp/case.md" <<FIXTURE
Narration mentioning --grep-invert "${canonical}" in body prose.

\`\`\`bash
# a shell comment about --grep-invert "${canonical}"
npm run test -- --grep-invert "${canonical}"
\`\`\`

More prose about --grep-invert "${canonical}".
FIXTURE
  expect_count "markdown: fenced command counts, prose does not" 1 \
    "$(grep --text -c -- "--grep-invert \"${canonical}\"" \
      <(runnable_lines "$tmp/case.md") || true)"

  # A Markdown file that only TALKS about the expression must yield zero — this
  # is what keeps the deliberately-unchecked prose mentions from passing as real.
  cat > "$tmp/prose-only.md" <<FIXTURE
The suite excludes --grep-invert "${canonical}" from the first pass.
FIXTURE
  expect_count "markdown: prose-only file yields nothing" 0 \
    "$(grep --text -c -- "--grep-invert \"${canonical}\"" \
      <(runnable_lines "$tmp/prose-only.md") || true)"

  # YAML: a run step counts, a `#` comment does not. The e2e-serial job's comment
  # explaining what e2e-functional excluded is precisely this case.
  cat > "$tmp/case.yml" <<FIXTURE
# comment about --grep-invert "${canonical}"
      - run: npx playwright test --grep-invert "${canonical}"
FIXTURE
  expect_count "yaml: run step counts, comment does not" 1 \
    "$(grep --text -c -- "--grep-invert \"${canonical}\"" \
      <(runnable_lines "$tmp/case.yml") || true)"

  if [[ "$st_failures" -ne 0 ]]; then
    echo "SELF-TEST FAILED: ${st_failures} case(s)."
    exit 1
  fi
  echo "SELF-TEST PASS: runnable_lines() separates commands from prose."
  exit 0
fi

# Every site that hand-writes the expression instead of importing the constant.
# Each must contain it verbatim, quoted exactly as the tool there expects.
CALLERS=(
  ".github/workflows/ci.yml"
  ".claude/gates/e2e-run.md"
  "docs/operations.md"
)

for file in "${CALLERS[@]}"; do
  path="${REPO_ROOT}/${file}"

  if [[ ! -f "$path" ]]; then
    echo "ERROR: ${file} does not exist — update CALLERS in $(basename "$0")."
    failed=1
    continue
  fi

  found="$(grep --text -c -- "--grep-invert \"${canonical}\"" \
    <(runnable_lines "$path") || true)"

  if [[ "$found" -eq 0 ]]; then
    echo "ERROR: ${file} does not pass --grep-invert \"${canonical}\" in a real"
    echo "       command. (A comment mentioning the expression is not one.)"
    echo "       ${CONSTANT_FILE}'s ${CONSTANT_NAME} is the canonical value."
    echo "       Local runs and CI must exclude the same specs (MINCRM-706)."
    failed=1
  fi
done

# ci.yml runs the expression exactly twice — the LPT shard-config path and the
# native --shard fallback. Both must carry it, or a run that falls back to
# native sharding silently includes the visual-regression spec.
#
# -ne, not -lt: a THIRD real invocation is also a finding. It means a new run
# step hardcoded the expression instead of being covered by these two, and this
# guard should not pass silently on a site nobody has reviewed.
EXPECTED_CI_INVOCATIONS=2
ci_occurrences="$(grep --text -c -- "--grep-invert \"${canonical}\"" \
  <(runnable_lines "${REPO_ROOT}/.github/workflows/ci.yml") || true)"

if [[ "$ci_occurrences" -ne "$EXPECTED_CI_INVOCATIONS" ]]; then
  echo "ERROR: .github/workflows/ci.yml has ${ci_occurrences} real invocation(s)"
  echo "       of --grep-invert \"${canonical}\"; expected exactly"
  echo "       ${EXPECTED_CI_INVOCATIONS} (the LPT shard-config path and the"
  echo "       native --shard fallback). Comment lines are not counted."
  echo "       If a new invocation is legitimate, review it and then bump"
  echo "       EXPECTED_CI_INVOCATIONS in $(basename "$0")."
  failed=1
fi

# docs/operations.md documents the run ONCE. CALLERS above only fails on zero, so
# without this the file could grow a second, drifted command block and still pass
# — the reader would then meet two commands and no way to tell which is current.
#
# -ne for the same reason as the CI bound: a second real invocation is a finding,
# not a pass, whichever direction it drifts.
EXPECTED_DOCS_INVOCATIONS=1
docs_occurrences="$(grep --text -c -- "--grep-invert \"${canonical}\"" \
  <(runnable_lines "${REPO_ROOT}/docs/operations.md") || true)"

if [[ "$docs_occurrences" -ne "$EXPECTED_DOCS_INVOCATIONS" ]]; then
  echo "ERROR: docs/operations.md has ${docs_occurrences} real invocation(s) of"
  echo "       --grep-invert \"${canonical}\"; expected exactly"
  echo "       ${EXPECTED_DOCS_INVOCATIONS}. Two command blocks mean a reader"
  echo "       cannot tell which one is current. Comment lines are not counted."
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "PASS: non-serial --grep-invert expression is identical across all $((${#CALLERS[@]} + 1)) definitions."
