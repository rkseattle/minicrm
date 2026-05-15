#!/usr/bin/env bash
# ===========================================================================
# check-behavior-layer.sh  (MINCRM-367)
#
# CI lint step — fail if any spec file under qa/e2e/tests/ imports directly
# from the @pages/* layer.
#
# WHY THIS EXISTS
# ---------------
# The three-layer architecture requires:
#   specs  →  behaviors  →  page objects  →  HealingLocator
#
# Spec files must only import from:
#   @behaviors/*     — named async behavior functions (composed PO interactions)
#   @apps/*          — test fixtures, helpers, TestDataManager
#   @framework/*     — fixtures, clients, healing utilities
#
# Direct @pages/* imports in specs violate the contract: they couple test
# assertions to raw PO methods, bypassing the behavior layer that provides
# named intent and locator fallback strategies.
#
# WHAT THIS CHECKS
# ----------------
# Greps for any line matching `from '@pages/` inside all spec files under
# qa/e2e/tests/apps/.  The pattern captures both static and dynamic imports:
#   import { Foo } from '@pages/minicrm/FooPage.js';
#   const { Foo } = await import('@pages/minicrm/FooPage.js');
#
# HOW TO FIX A VIOLATION
# -----------------------
# 1. Find the PO method used in the spec.
# 2. Add a behavior wrapper in qa/e2e/behaviors/minicrm/<domain>.behaviors.ts
#    that calls the PO method and exports it with a clear, intent-bearing name.
# 3. Import the behavior in the spec instead of the PO.
# 4. Remove the @pages/* import.
#
# See MINCRM-367 for full background and the migration guide.
# ===========================================================================

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/tests"

if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

# Grep for any import from @pages/ in spec files.
# -r  recursive
# -n  print line numbers
# -l  only print filenames (used to count violations)
# --include  restrict to TypeScript spec files
VIOLATIONS=$(grep -rn \
  --include="*.spec.ts" \
  "from '@pages/" \
  "$TESTS_DIR" 2>/dev/null || true)

if [ -n "$VIOLATIONS" ]; then
  echo ""
  echo "FAIL: spec files must not import directly from \`@pages/*\`."
  echo "Move page-object interactions into a behavior function in"
  echo "qa/e2e/behaviors/minicrm/ and import from \`@behaviors/*\` instead."
  echo ""
  echo "Violations found:"
  echo "$VIOLATIONS"
  echo ""
  exit 1
fi

echo "OK: no spec files import directly from @pages/."
