#!/usr/bin/env bash
# Run each NLI eval suite independently so prompts and vars don't cross-contaminate.
# Exits non-zero if any suite fails. Results written per-suite to .output/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/.output"
mkdir -p "$OUTPUT_DIR"

SUITES=(nli-intent nli-semantic nli-rbac nli-pii)
FAILED=()

for suite in "${SUITES[@]}"; do
  echo "==> Running $suite"
  if promptfoo eval \
      -c "$SCRIPT_DIR/$suite.yaml" \
      -o "$OUTPUT_DIR/$suite.json" \
      --no-progress-bar; then
    echo "    $suite PASSED"
  else
    echo "    $suite FAILED"
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
