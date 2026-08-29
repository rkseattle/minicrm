#!/usr/bin/env bash
# ===========================================================================
# check-behavior-layer.sh  (MINCRM-367, MINCRM-564)
#
# CI lint step — fail if any spec file under qa/e2e/tests/ imports directly
# from the @pages/* layer, OR if any behavior file exports a get*Locator
# function (which hands raw DOM handles to callers instead of expressing
# intent).
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
# get*Locator exports in behavior files are a second class of violation: they
# return raw locator handles to callers, letting specs drive locators directly
# instead of expressing user intent through named action/assertion behaviors.
#
# WHAT THIS CHECKS
# ----------------
# Check 1 — @pages/* imports in specs:
#   Greps for any line matching `from '@pages/` inside all spec files under
#   qa/e2e/tests/apps/.  The pattern captures both static and dynamic imports:
#     import { Foo } from '@pages/minicrm/FooPage.js';
#     const { Foo } = await import('@pages/minicrm/FooPage.js');
#
# Check 2 — get*Locator exports in behavior files (MINCRM-564):
#   Greps for `export (async )?function get\w*Locator` in behavior files
#   under qa/e2e/behaviors/.  Legitimate data-fetch helpers (getAiConfig,
#   getAiModelOptionCount, etc.) do not match because they don't end in
#   "Locator".  The sole intentional exception is getLanguageSelectLocator
#   in nav.behaviors.ts, which must be passed as a raw locator to
#   selectLanguageAndWaitForPatch.  All others must be replaced with intent-
#   bearing click*/fill*/expect*/wait* behavior functions.
#
# HOW TO FIX A VIOLATION
# -----------------------
# For @pages/* in specs:
# 1. Find the PO method used in the spec.
# 2. Add a behavior wrapper in qa/e2e/behaviors/minicrm/<domain>.behaviors.ts
#    that calls the PO method and exports it with a clear, intent-bearing name.
# 3. Import the behavior in the spec instead of the PO.
# 4. Remove the @pages/* import.
#
# For get*Locator in behaviors:
# 1. Identify every call site of the locator in spec files.
# 2. Replace each usage pattern (click, expect, fill, etc.) with a dedicated
#    intent-bearing behavior function that encapsulates the entire operation.
# 3. Delete the get*Locator function from the behavior file and its export from
#    index.ts.
#
# See MINCRM-367, MINCRM-564 for full background and migration guides.
# ===========================================================================

set -euo pipefail

TESTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/tests"
BEHAVIORS_DIR="$(cd "$(dirname "$0")/.." && pwd)/e2e/behaviors"

if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR"
  exit 1
fi

if [ ! -d "$BEHAVIORS_DIR" ]; then
  echo "behaviors directory not found: $BEHAVIORS_DIR"
  exit 1
fi

FAIL=0

# ---------------------------------------------------------------------------
# Check 1: no @pages/* imports in spec files
# ---------------------------------------------------------------------------
PAGES_VIOLATIONS=$(grep -rn \
  --include="*.spec.ts" \
  "from '@pages/" \
  "$TESTS_DIR" 2>/dev/null || true)

if [ -n "$PAGES_VIOLATIONS" ]; then
  echo ""
  echo "FAIL: spec files must not import directly from \`@pages/*\`."
  echo "Move page-object interactions into a behavior function in"
  echo "qa/e2e/behaviors/minicrm/ and import from \`@behaviors/*\` instead."
  echo ""
  echo "Violations found:"
  echo "$PAGES_VIOLATIONS"
  echo ""
  FAIL=1
fi

# ---------------------------------------------------------------------------
# Check 2: no get*Locator exports in behavior files (MINCRM-564)
# The one intentional exception is getLanguageSelectLocator in
# nav.behaviors.ts — it must be passed as a raw locator to
# selectLanguageAndWaitForPatch, so it is allowlisted here.
# ---------------------------------------------------------------------------
LOCATOR_VIOLATIONS=$(grep -rn \
  --include="*.behaviors.ts" \
  -E "^export (async )?function get[A-Za-z]+Locator" \
  "$BEHAVIORS_DIR" 2>/dev/null \
  | grep -v "getLanguageSelectLocator" \
  || true)

if [ -n "$LOCATOR_VIOLATIONS" ]; then
  echo ""
  echo "FAIL: behavior files must not export get*Locator functions."
  echo "Replace each with an intent-bearing click*/fill*/expect*/wait* behavior"
  echo "that encapsulates the full interaction. Raw locator handles must not"
  echo "cross the behavior→spec boundary."
  echo ""
  echo "Violations found:"
  echo "$LOCATOR_VIOLATIONS"
  echo ""
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  exit 1
fi

echo "OK: no @pages/* imports in specs; no get*Locator exports in behaviors."
