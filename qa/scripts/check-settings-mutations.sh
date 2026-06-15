#!/usr/bin/env bash
# ===========================================================================
# check-settings-mutations.sh  (MINCRM-358, MINCRM-552)
#
# CI lint step — fail if any *.spec.ts file mutates global system settings
# without (a) a corresponding ensureSystemDefaults() call and (b) a @serial
# tag on the mutating tests.
#
# WHAT THIS CHECKS
# ----------------
# Scans every *.spec.ts file under qa/e2e/tests/ for calls to settings
# mutation endpoints or behavior helpers:
#   Direct API mutations:
#     - restClient.patch(.*settings
#     - restClient.put(.*settings/currencies
#     - restClient.put(.*settings/onboarding
#     - restClient.put(.*settings/sso
#     - restClient.put(.*settings/branding
#     - restClient.delete(.*settings/sso
#   Behavior-layer mutations (non-default values only) (MINCRM-552):
#     - setNavLayoutViaAPI.*'left'
#     - setNavLayoutViaAPI.*'hamburger'
#     - setNavLayoutViaUI
#     - setCurrencySettings
#
# Note: setNavLayoutViaAPI('top'), setSystemDefaultLanguage('en'), and
# setUserLanguage(null) are resets to the default state — they are NOT
# mutations requiring @serial and are intentionally excluded from the
# patterns below.
#
# For each file that contains a mutation, the script checks:
#   1. Whether it also calls ensureSystemDefaults() — required for cleanup.
#      Exception: visual-regression.spec.ts manages cleanup via afterEach.
#   2. Whether it also uses @serial — required so these tests run in the
#      e2e-serial CI job (--workers=1) rather than the parallel shard job.
#      This check only applies when the file has ensureSystemDefaults(),
#      since cleanup-only mutation calls (e.g., resetting state in beforeEach)
#      do not require serial isolation.
#
# WHY THIS EXISTS
# ---------------
# Settings mutations left behind by a failing test contaminate the next
# test's environment, causing flakiness unrelated to the code under test.
# Adding @serial without ensureSystemDefaults (or vice versa) still allows
# race conditions — both are required for intentional settings mutations.
# (MINCRM-355, MINCRM-552)
#
# HOW TO FIX A FAILURE
# --------------------
# Cleanup missing:
#   1. Import ensureSystemDefaults from @behaviors/minicrm/settings.behaviors.js.
#   2. Add test.beforeEach and test.afterEach calling ensureSystemDefaults(restClient).
#   3. Ensure restClient is authenticated as admin before the call.
#
# @serial missing:
#   1. Add @serial to the tag string of every test in the file that mutates
#      settings, e.g. test('@functional @serial F9-L1: ...').
#   2. For parameterised tests using { tag: ['@functional'] }, add '@serial':
#      { tag: ['@functional', '@serial'] }.
# ===========================================================================

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/tests"

if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

# Mutation patterns to scan for — extended-regex passed to grep -E.
# These patterns match only intentional non-default mutations, not resets.
# setNavLayoutViaAPI('top') is a reset-to-default and is excluded.
MUTATION_PATTERNS=(
  "restClient\.patch\(.*settings"
  "restClient\.put\(.*settings/currencies"
  "restClient\.put\(.*settings/onboarding"
  "restClient\.put\(.*settings/sso"
  "restClient\.put\(.*settings/branding"
  "restClient\.delete\(.*settings/sso"
  "setNavLayoutViaAPI\([^)]*'left'"
  "setNavLayoutViaAPI\([^)]*'hamburger'"
  "setNavLayoutViaUI"
  "setCurrencySettings"
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

  # visual-regression.spec.ts: tests are tagged @visual (not @functional)
  # and run in a separate visual regression pipeline that handles its own
  # concurrency. It manages nav-layout cleanup via afterEach. No
  # ensureSystemDefaults or @serial check needed.
  file_basename="$(basename "$spec_file")"
  if [ "$file_basename" = "visual-regression.spec.ts" ]; then
    continue
  fi

  has_ensure_defaults=false
  # Check for actual code call (not just import or comment) by requiring
  # the call to appear on its own outside of a comment.
  if grep -qP "(?<!//)\bensureSystemDefaults\s*\(" "$spec_file" 2>/dev/null || \
     grep -qE "^\s+await ensureSystemDefaults" "$spec_file" 2>/dev/null; then
    has_ensure_defaults=true
  fi

  # Check 1: file must call ensureSystemDefaults for cleanup.
  if [ "$has_ensure_defaults" = false ]; then
    echo "ERROR: $spec_file mutates system settings but has no ensureSystemDefaults() call."
    echo "  Mutations found:"
    for m in "${file_mutations[@]}"; do
      echo "    - pattern: $m"
      grep -nE "$m" "$spec_file" | sed 's/^/      /' || true
    done
    echo "  Fix: add beforeEach/afterEach calling ensureSystemDefaults(restClient)."
    echo ""
    FOUND=1
  fi

  # Check 2: file must use @serial so mutating tests run in the dedicated
  # single-worker e2e-serial CI job rather than in the parallel shard job.
  # Only applied when the file has ensureSystemDefaults() — files that call
  # mutation behavior names only as defensive resets (not as intentional
  # test-specific mutations) do not require @serial isolation.
  if [ "$has_ensure_defaults" = true ]; then
    if ! grep -q "@serial" "$spec_file" 2>/dev/null; then
      echo "ERROR: $spec_file mutates system settings but has no @serial tag."
      echo "  Mutations found:"
      for m in "${file_mutations[@]}"; do
        echo "    - pattern: $m"
        grep -nE "$m" "$spec_file" | sed 's/^/      /' || true
      done
      echo "  Fix: add @serial to the tag string of every test that mutates settings."
      echo "  See MINCRM-552 and docs/dev/e2e-authoring.md for the required pattern."
      echo ""
      FOUND=1
    fi
  fi
done < <(find "$TESTS_DIR" -name "*.spec.ts" -print0)

if [ "$FOUND" -eq 1 ]; then
  echo "FAIL: one or more spec files mutate system settings without ensureSystemDefaults() or @serial."
  echo "See MINCRM-358 and MINCRM-552 for the required patterns."
  exit 1
fi

echo "OK: all spec files that mutate settings call ensureSystemDefaults()."
