#!/usr/bin/env bash
# ===========================================================================
# check-e2e-beforeall.sh  (MINCRM-368)
#
# CI lint step — fail if any spec file under qa/e2e/tests/ calls loginAsAdmin
# inside a test.beforeAll block.
#
# WHY THIS EXISTS
# ---------------
# test.beforeAll runs once per worker. The restClient fixture is per-test, so
# any loginAsAdmin call in beforeAll only authenticates the fixture instance
# that exists at beforeAll time — subsequent per-test instances are unaffected.
# This makes the call a silent no-op that creates a false sense of security and
# introduces session-bleed risk when tests later switch to a rep session.
#
# The global storageState in playwright.config.ts (MINCRM-192) pre-authenticates
# the browser context for all tests. Tests that need an authenticated restClient
# must call loginAsAdmin(restClient) at the start of their own body, or restore
# admin auth in a finally block after switching to a non-admin session.
#
# ESCAPE HATCH
# ------------
# If a file genuinely needs loginAsAdmin in beforeAll (e.g. because storageState
# is insufficient and the rationale is documented), add the comment:
#   // MINCRM-368-ok: <reason>
# on the same line as the loginAsAdmin call and this script will allow it.
#
# HOW IT WORKS
# ------------
# The script scans each spec file for a multi-line pattern: a beforeAll block
# containing a loginAsAdmin call. It uses awk to track whether execution is
# currently inside a beforeAll block and flags loginAsAdmin calls within one.
# ===========================================================================

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/tests"

if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

FOUND=0

while IFS= read -r file; do
  # Use awk to detect loginAsAdmin calls inside beforeAll blocks.
  # Tracks brace depth from the opening of beforeAll to find its closing brace.
  result=$(awk '
    BEGIN { in_beforeall=0; depth=0; found=0 }
    /test\.beforeAll[[:space:]]*\(/ {
      in_beforeall=1
      depth=0
    }
    in_beforeall && /loginAsAdmin/ && !/MINCRM-368-ok/ {
      found=1
      print FILENAME ":" NR ": loginAsAdmin inside test.beforeAll"
    }
    in_beforeall {
      # Count opening and closing braces to track block depth.
      # Checked AFTER the loginAsAdmin test so single-line blocks are caught.
      for (i=1; i<=length($0); i++) {
        c = substr($0, i, 1)
        if (c == "{") depth++
        if (c == "}") {
          depth--
          if (depth == 0) { in_beforeall=0 }
        }
      }
    }
    END { exit found }
  ' "$file" 2>&1) || {
    echo "$result"
    FOUND=1
  }
done < <(find "$TESTS_DIR" -name "*.spec.ts" | sort)

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "FAIL: loginAsAdmin called inside test.beforeAll in the above files."
  echo ""
  echo "The restClient fixture is per-test — loginAsAdmin in beforeAll is a no-op"
  echo "for subsequent tests and risks session pollution across parallel workers."
  echo ""
  echo "Options:"
  echo "  1. Remove the beforeAll block (admin auth is already set via storageState)."
  echo "  2. Call loginAsAdmin(restClient) at the start of each test body that needs it."
  echo "  3. If beforeAll is genuinely required, add '// MINCRM-368-ok: <reason>' to"
  echo "     the same line as the loginAsAdmin call to suppress this check."
  echo ""
  echo "See qa/e2e/behaviors/README.md for full guidance."
  exit 1
fi

echo "OK: no loginAsAdmin calls found inside test.beforeAll blocks."
