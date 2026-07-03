#!/usr/bin/env bash
# Run each NLI eval suite independently so prompts and vars don't cross-contaminate.
# Exits non-zero if any suite fails. Results written per-suite to .output/.
#
# A suite's pass/fail is judged against its own declared `threshold:` (e.g.
# nli-semantic.yaml and nli-rbac.yaml use 0.9 to absorb LLM-judge variance on
# binary rubrics — see their file headers). Suites with no threshold field
# (nli-intent, nli-pii) are fully deterministic and implicitly require 100%.
#
# `promptfoo eval`'s own exit code does NOT honor `threshold` — it is nonzero
# on ANY single test failure regardless of the config's threshold value, so
# a suite at e.g. 23/24 (95.8%, above its own 90% threshold) still exits
# nonzero and would be misreported as failed if this script relied on it.
# This script instead reads successes/failures from each suite's own JSON
# output and compares against its declared threshold. (MINCRM-568)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/.output"
mkdir -p "$OUTPUT_DIR"

SUITES=(nli-intent nli-semantic nli-rbac nli-pii)
FAILED=()

for suite in "${SUITES[@]}"; do
  echo "==> Running $suite"
  # promptfoo eval's exit code is ignored here — see header comment. `|| true`
  # prevents `set -e` from aborting the script; the real pass/fail check runs
  # after, on the JSON output.
  promptfoo eval \
      -c "$SCRIPT_DIR/$suite.yaml" \
      -o "$OUTPUT_DIR/$suite.json" \
      --no-progress-bar || true

  # judge_suite.py always exits 0 and prints one line: "PASS|FAIL <message>".
  # Doing the pass/fail branch in bash (not via the script's own exit code)
  # avoids `set -e` aborting this loop on a genuine below-threshold failure —
  # command substitution assignment does NOT get the same `if`/`||` exemption
  # a directly-invoked command gets.
  JUDGMENT=$(python3 "$SCRIPT_DIR/judge_suite.py" "$SCRIPT_DIR/$suite.yaml" "$OUTPUT_DIR/$suite.json")
  VERDICT="${JUDGMENT%% *}"
  MESSAGE="${JUDGMENT#* }"

  if [ "$VERDICT" = "PASS" ]; then
    echo "    $suite PASSED ($MESSAGE)"
  else
    echo "    $suite FAILED ($MESSAGE)"
    FAILED+=("$suite")
  fi
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo ""
  echo "FAILED suites: ${FAILED[*]}"
  exit 1
fi

echo ""
echo "All eval suites passed."
