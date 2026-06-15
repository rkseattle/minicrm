#!/usr/bin/env bash
# ===========================================================================
# check-networkidle.sh  (MINCRM-551)
#
# CI lint step — fail if any *.spec.ts file uses
# page.waitForLoadState('networkidle').
#
# WHAT THIS CHECKS
# ----------------
# Scans every *.spec.ts file under qa/e2e/tests/ for the pattern
#   waitForLoadState('networkidle')
# and fails if any matches are found.
#
# WHY THIS EXISTS
# ---------------
# networkidle resolves as soon as the browser sees no in-flight network
# requests for 500 ms. Under CI load, React Query's optimistic updates and
# refetch cycles can start after that window, causing a test to proceed before
# the UI has settled. Each call site should instead target exactly the DOM
# condition the test needs to be true (e.g. locator.waitFor({ state:
# 'visible' }), expect(locator).toBeVisible(), page.waitForFunction()).
#
# HOW TO FIX A FAILURE
# --------------------
# Replace the failing call with a specific Playwright wait appropriate to
# what the test actually needs to be true at that point:
#   - expect(page.getByTestId('some-element')).toBeVisible()
#   - locator.waitFor({ state: 'visible' })
#   - page.waitForFunction(() => document.querySelector('[data-foo]') !== null)
# No shared wait abstraction should be introduced — keep each replacement
# inline and specific to the spec.
# ===========================================================================

set -euo pipefail

# shellcheck source=spec-files.sh
source "$(dirname "$0")/spec-files.sh"
resolve_tests_dir

FOUND=0

while IFS= read -r -d '' spec_file; do
  if grep -qE "waitForLoadState\(['\"]networkidle['\"]" "$spec_file" 2>/dev/null; then
    echo "ERROR: $spec_file uses waitForLoadState('networkidle')."
    echo "  Matching lines:"
    grep -nE "waitForLoadState\(['\"]networkidle['\"]" "$spec_file" | sed 's/^/    /' || true
    echo "  Fix: replace with a specific Playwright wait targeting what the test needs."
    echo "  See MINCRM-551 and docs/dev/e2e-authoring.md for guidance."
    echo ""
    FOUND=1
  fi
done < <(find_spec_files)

if [ "$FOUND" -eq 1 ]; then
  echo "FAIL: one or more spec files use waitForLoadState('networkidle')."
  echo "See MINCRM-551 for the required replacement pattern."
  exit 1
fi

echo "OK: no spec files use waitForLoadState('networkidle')."
