#!/usr/bin/env bash
# ===========================================================================
# check-settings-mutations.sh  (MINCRM-358)
#
# CI lint step — fail if any *.spec.ts file mutates global system settings
# without a corresponding ensureSystemDefaults() call.
#
# WHAT THIS CHECKS
# ----------------
# Scans every *.spec.ts file under qa/e2e/tests/ for calls to settings
# mutation endpoints:
#   - restClient.patch(.*settings
#   - restClient.put(.*settings/currencies
#   - restClient.put(.*settings/onboarding
#
# For each file that contains a mutation, the script checks whether it also
# calls ensureSystemDefaults(). Files that mutate settings without cleanup
# exit with code 1 and a message naming the file and the mutation found.
#
# WHY THIS EXISTS
# ---------------
# Settings mutations left behind by a failing test contaminate the next test's
# environment, causing flakiness unrelated to the code under test. This check
# makes the pattern self-enforcing: a new spec that forgets ensureSystemDefaults
# fails CI immediately rather than being discovered as a flaky test days later.
# (Confirmed source of flakiness documented in MINCRM-355.)
#
# HOW TO FIX A FAILURE
# --------------------
# 1. Import ensureSystemDefaults from @behaviors/minicrm/settings.behaviors.js.
# 2. Add test.beforeEach and test.afterEach that call ensureSystemDefaults(restClient).
# 3. Ensure the restClient is authenticated as admin before the call.
# ===========================================================================

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/tests"

if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

# Mutation patterns to scan for.
# Each entry is an extended-regex pattern passed to grep -E.
MUTATION_PATTERNS=(
  "restClient\.patch\(.*settings"
  "restClient\.put\(.*settings/currencies"
  "restClient\.put\(.*settings/onboarding"
)

FOUND=0

# Collect all spec files.
while IFS= read -r -d '' spec_file; do
  file_mutations=()

  # Check each mutation pattern against the file.
  for pattern in "${MUTATION_PATTERNS[@]}"; do
    if grep -qE "$pattern" "$spec_file" 2>/dev/null; then
      file_mutations+=("$pattern")
    fi
  done

  # Skip files with no mutations.
  if [ "${#file_mutations[@]}" -eq 0 ]; then
    continue
  fi

  # File has at least one mutation — check for ensureSystemDefaults.
  if ! grep -q "ensureSystemDefaults" "$spec_file" 2>/dev/null; then
    echo "ERROR: $spec_file mutates system settings but has no ensureSystemDefaults() call."
    echo "  Mutations found:"
    for m in "${file_mutations[@]}"; do
      echo "    - pattern: $m"
      # Print matching lines for context.
      grep -nE "$m" "$spec_file" | sed 's/^/      /' || true
    done
    echo "  Fix: add beforeEach/afterEach calling ensureSystemDefaults(restClient)."
    echo ""
    FOUND=1
  fi
done < <(find "$TESTS_DIR" -name "*.spec.ts" -print0)

if [ "$FOUND" -eq 1 ]; then
  echo "FAIL: one or more spec files mutate system settings without ensureSystemDefaults()."
  echo "See MINCRM-358 for the required pattern."
  exit 1
fi

echo "OK: all spec files that mutate settings call ensureSystemDefaults()."
