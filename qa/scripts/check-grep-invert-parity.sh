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
# COMMENT AND PROSE LINES ARE STRIPPED BEFORE MATCHING
# ----------------------------------------------------
# Both non-TS callers legitimately DISCUSS this expression in prose — ci.yml's
# e2e-serial job explains in a comment which tests e2e-functional excluded, and
# the gate document narrates the command before showing it. Matching whole-file
# text would let those mentions stand in for the real thing: a run step could
# drop the expression, keep the comment, and still pass.
#
# That is not hypothetical. Verified by mutation: with whole-file matching, the
# native --shard fallback path could be changed to `--grep-invert "serial"` and
# this script still printed PASS, because a prose comment padded the count.
# check-audit-gate-parity.sh already documents the identical trap for its own
# callers; this follows its form.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# The one true value, defined in TypeScript and shared by every local caller.
CONSTANT_FILE="qa/scripts/targeted-run-plan.ts"
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

# Every site that hand-writes the expression instead of importing the constant.
# Each must contain it verbatim, quoted exactly as the tool there expects.
CALLERS=(
  ".github/workflows/ci.yml"
  ".claude/gates/e2e-run.md"
)

for file in "${CALLERS[@]}"; do
  path="${REPO_ROOT}/${file}"

  if [[ ! -f "$path" ]]; then
    echo "ERROR: ${file} does not exist — update CALLERS in $(basename "$0")."
    failed=1
    continue
  fi

  # Strip comment/prose lines FIRST — see this script's header. `#` covers YAML
  # and the Markdown gate document's narration; the fenced command block it
  # documents is not a comment and survives.
  found="$(grep --text -c -- "--grep-invert \"${canonical}\"" \
    <(grep -v -E '^[[:space:]]*#' "$path") || true)"

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
  <(grep -v -E '^[[:space:]]*#' "${REPO_ROOT}/.github/workflows/ci.yml") || true)"

if [[ "$ci_occurrences" -ne "$EXPECTED_CI_INVOCATIONS" ]]; then
  echo "ERROR: .github/workflows/ci.yml has ${ci_occurrences} real invocation(s)"
  echo "       of --grep-invert \"${canonical}\"; expected exactly"
  echo "       ${EXPECTED_CI_INVOCATIONS} (the LPT shard-config path and the"
  echo "       native --shard fallback). Comment lines are not counted."
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "PASS: non-serial --grep-invert expression is identical across all $((${#CALLERS[@]} + 1)) definitions."
